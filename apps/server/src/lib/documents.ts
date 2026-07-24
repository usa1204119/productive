import { Readable } from "node:stream";
import type { Document, PrismaClient } from "@prisma/client";
import { type DocumentDto, MAX_UPLOAD_BYTES } from "@plane-and-curves/shared";
import { AppError } from "../errors.js";
import type { DriveClient } from "./driveClient.js";

const ROOT_FOLDER_NAME = "Plane and Curves";
const ROOT_PROPERTY = { key: "pacRoot", value: "v1" } as const;
const FOLDER_CHECK_CONCURRENCY = 5;

const documentNotFound = () =>
  new AppError(404, "DOCUMENT_NOT_FOUND", "Document not found");

export function toDocumentDto(doc: Document, missing: boolean): DocumentDto {
  return {
    id: doc.id,
    name: doc.name,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    webViewLink: doc.webViewLink,
    iconLink: doc.iconLink,
    taskId: doc.taskId,
    missing,
    createdAt: doc.createdAt.toISOString(),
  };
}

/**
 * A small keyed single-flight lock. The deployment target is one server, so
 * this prevents concurrent first uploads from creating duplicate Drive folders.
 * Drive appProperties provide idempotency even if database folder metadata is
 * lost and later rebuilt.
 */
const folderLocks = new Map<string, Promise<void>>();

async function withFolderLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = folderLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  folderLocks.set(key, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (folderLocks.get(key) === tail) folderLocks.delete(key);
  }
}

/** Lazy, idempotent root-folder creation with deleted-folder recovery. */
export async function ensureRootFolder(
  db: PrismaClient,
  drive: DriveClient,
  userId: string,
): Promise<string> {
  return withFolderLock(`root:${userId}`, async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.driveRootFolderId && (await drive.folderExists(user.driveRootFolderId))) {
      return user.driveRootFolderId;
    }

    const existing = await drive.findFolder(ROOT_PROPERTY, null);
    const id =
      existing ??
      (await drive.createFolder(ROOT_FOLDER_NAME, null, {
        [ROOT_PROPERTY.key]: ROOT_PROPERTY.value,
      }));

    await db.user.update({
      where: { id: userId },
      data: { driveRootFolderId: id },
    });
    return id;
  });
}

/** Lazy, idempotent workspace-folder creation with deleted-folder recovery. */
export async function ensureWorkspaceFolder(
  db: PrismaClient,
  drive: DriveClient,
  workspaceId: string,
  rootId: string,
): Promise<string> {
  return withFolderLock(`workspace:${workspaceId}`, async () => {
    const workspace = await db.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
    });
    if (workspace.driveFolderId && (await drive.folderExists(workspace.driveFolderId))) {
      return workspace.driveFolderId;
    }

    const property = { key: "pacWorkspaceId", value: workspaceId };
    const existing = await drive.findFolder(property, rootId);
    const id =
      existing ??
      (await drive.createFolder(workspace.name, rootId, {
        [property.key]: property.value,
      }));

    await db.workspace.update({
      where: { id: workspaceId },
      data: { driveFolderId: id },
    });
    return id;
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(items[index]!, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

/**
 * List documents and flag Drive references that are missing. Metadata checks
 * are concurrency-limited so a large workspace cannot burst the Drive quota.
 */
export async function listDocuments(
  db: PrismaClient,
  drive: DriveClient,
  workspaceId: string,
): Promise<DocumentDto[]> {
  const docs = await db.document.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
  });
  const metas = await mapWithConcurrency(docs, FOLDER_CHECK_CONCURRENCY, (doc) =>
    drive.getFileMeta(doc.driveFileId),
  );
  return docs.map((doc, index) => toDocumentDto(doc, metas[index] === null));
}

export interface UploadInput {
  userId: string;
  workspaceId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  body: Readable;
  signal?: AbortSignal;
  onProgress?: (bytesSent: number) => void;
}

function sizeGuardedBody(
  body: Readable,
  declaredBytes: number,
  maxBytes: number,
): { stream: Readable; bytesRead: () => number } {
  let bytes = 0;
  const stream = Readable.from(
    (async function* () {
      for await (const raw of body) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
        bytes += chunk.length;
        if (bytes > maxBytes) {
          throw new AppError(413, "FILE_TOO_LARGE", "File exceeds the 100 MB limit");
        }
        if (bytes > declaredBytes) {
          throw new AppError(
            400,
            "VALIDATION_ERROR",
            "Uploaded data exceeds the declared file size",
          );
        }
        yield chunk;
      }
      if (bytes !== declaredBytes) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Uploaded data does not match the declared file size",
        );
      }
    })(),
  );
  return { stream, bytesRead: () => bytes };
}

/**
 * Stream a file to Drive, then create its database record.
 *
 * The declared size is rejected before any Drive call and independently
 * enforced while streaming. A failed/cancelled upload creates no database row.
 * If Drive succeeds but the database write fails, the new Drive file is deleted
 * as a compensating action so the operation does not leave an orphan.
 */
export async function uploadDocument(
  db: PrismaClient,
  drive: DriveClient,
  input: UploadInput,
  maxBytes: number = MAX_UPLOAD_BYTES,
): Promise<DocumentDto> {
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid file size");
  }
  if (input.sizeBytes > maxBytes) {
    throw new AppError(413, "FILE_TOO_LARGE", "File exceeds the 100 MB limit");
  }
  if (input.signal?.aborted) {
    throw new DOMException("Upload cancelled", "AbortError");
  }

  const rootId = await ensureRootFolder(db, drive, input.userId);
  const folderId = await ensureWorkspaceFolder(db, drive, input.workspaceId, rootId);
  const guarded = sizeGuardedBody(input.body, input.sizeBytes, maxBytes);

  let lastProgress = 0;
  const uploaded = await drive.uploadFile({
    name: input.name,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    folderId,
    body: guarded.stream,
    signal: input.signal,
    onProgress: (value) => {
      const next = Math.max(lastProgress, Math.min(Math.floor(value), input.sizeBytes));
      if (next === lastProgress && next !== input.sizeBytes) return;
      lastProgress = next;
      input.onProgress?.(next);
    },
  });

  if (guarded.bytesRead() !== input.sizeBytes) {
    await drive.deleteFile(uploaded.fileId).catch(() => undefined);
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Uploaded data does not match the declared file size",
    );
  }

  try {
    const doc = await db.document.create({
      data: {
        workspaceId: input.workspaceId,
        driveFileId: uploaded.fileId,
        name: input.name,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        webViewLink: uploaded.webViewLink,
        iconLink: uploaded.iconLink,
        uploadedById: input.userId,
      },
    });
    return toDocumentDto(doc, false);
  } catch (err) {
    await drive.deleteFile(uploaded.fileId).catch(() => undefined);
    throw err;
  }
}

/** Attach a document to a task (or detach with null), scoped to one workspace. */
export async function attachDocument(
  db: PrismaClient,
  workspaceId: string,
  documentId: string,
  taskId: string | null,
): Promise<DocumentDto> {
  const doc = await db.document.findFirst({
    where: { id: documentId, workspaceId },
  });
  if (!doc) throw documentNotFound();
  if (taskId) {
    const task = await db.task.findFirst({
      where: { id: taskId, workspaceId },
    });
    if (!task) throw new AppError(404, "TASK_NOT_FOUND", "Task not found");
  }
  const updated = await db.document.update({
    where: { id: documentId },
    data: { taskId },
  });
  return toDocumentDto(updated, false);
}

/**
 * Delete a document record. Drive deletion is an explicit opt-in. Record-only
 * cleanup deliberately works while Drive is disconnected or the file is gone.
 */
export async function deleteDocument(
  db: PrismaClient,
  drive: DriveClient | null,
  workspaceId: string,
  documentId: string,
  deleteFromDrive: boolean,
): Promise<void> {
  const doc = await db.document.findFirst({
    where: { id: documentId, workspaceId },
  });
  if (!doc) throw documentNotFound();

  if (deleteFromDrive) {
    if (!drive) {
      throw new AppError(409, "DRIVE_NOT_CONNECTED", "Google Drive is not connected");
    }
    await drive.deleteFile(doc.driveFileId);
  }
  await db.document.delete({ where: { id: documentId } });
}
