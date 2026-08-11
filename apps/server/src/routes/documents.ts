import { Router, type RequestHandler } from "express";
import { z } from "zod";
import {
  attachDocumentSchema,
  deleteDocumentQuerySchema,
  documentParamsSchema,
  MAX_DOCUMENT_NAME_LENGTH,
  MAX_MIME_TYPE_LENGTH,
  MAX_UPLOAD_BYTES,
  uploadProgressParamsSchema,
} from "@plane-and-curves/shared";
import { prisma } from "../db.js";
import { AppError, forbidden } from "../errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requireWorkspaceAccess, requireWorkspaceRole } from "../middleware/workspace.js";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../middleware/validate.js";
import { getUserDriveClient, withDriveErrors } from "../lib/driveCredentials.js";
import {
  attachDocument,
  deleteDocument,
  listDocuments,
  uploadDocument,
} from "../lib/documents.js";
import { ok } from "../lib/respond.js";
import {
  publishUploadProgress,
  subscribeUploadProgress,
  uploadProgressKey,
} from "../lib/uploadProgress.js";
import { emitWorkspaceEvent } from "../collaboration/hub.js";

// Mounted at /workspaces/:workspaceId/documents.
export const documentsRouter = Router({ mergeParams: true });

const requireNonGuest: RequestHandler = (req, _res, next) => {
  if (req.user!.isGuest) {
    next(
      new AppError(
        403,
        "GUEST_FORBIDDEN",
        "Sign in with Google to use Documents",
      ),
    );
    return;
  }
  next();
};

documentsRouter.use(requireAuth, requireWorkspaceAccess, requireNonGuest);

const uploadMetadataSchema = z.object({
  name: z.string().trim().min(1).max(MAX_DOCUMENT_NAME_LENGTH),
  mimeType: z.string().trim().min(1).max(MAX_MIME_TYPE_LENGTH),
  sizeBytes: z.coerce.number().int().nonnegative().max(MAX_UPLOAD_BYTES),
  uploadId: z.string().uuid(),
});

function singleHeader(req: Parameters<RequestHandler>[0], name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function uploadMetadata(req: Parameters<RequestHandler>[0]) {
  const rawName = singleHeader(req, "x-file-name") ?? "";
  let decodedName: string;
  try {
    decodedName = decodeURIComponent(rawName);
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid encoded file name");
  }
  return uploadMetadataSchema.parse({
    name: decodedName,
    mimeType: singleHeader(req, "x-file-type") || "application/octet-stream",
    sizeBytes: singleHeader(req, "x-file-size"),
    uploadId: singleHeader(req, "x-upload-id"),
  });
}

/** Ordered Drive-side progress stream for one upload. */
documentsRouter.get(
  "/uploads/:uploadId/events",
  validateParams(uploadProgressParamsSchema),
  requireWorkspaceRole("EDITOR"),
  (req, res) => {
    const key = uploadProgressKey(
      req.user!.id,
      req.workspace!.id,
      req.params.uploadId!,
    );

    res.status(200);
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 2000\n\n");

    const unsubscribe = subscribeUploadProgress(key, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.phase === "complete" || event.phase === "error") {
        setImmediate(() => res.end());
      }
    });
    const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15_000);
    heartbeat.unref();

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  },
);

/** List documents and surface Drive-deleted files as missing records. */
documentsRouter.get("/", async (req, res, next) => {
  try {
    const driveOwnerId = req.workspace!.userId;
    const drive = await getUserDriveClient(prisma, driveOwnerId);
    const documents = await withDriveErrors(
      prisma,
      driveOwnerId,
      drive,
      (client) => listDocuments(prisma, client, req.workspace!.id),
    );
    ok(res, documents);
  } catch (err) {
    next(err);
  }
});

/**
 * Stream a single raw file body. Metadata lives in bounded headers so the
 * server can reject oversize uploads before initiating a Drive upload.
 */
documentsRouter.post("/", requireWorkspaceRole("EDITOR"), async (req, res, next) => {
  let key: string | null = null;
  const abortController = new AbortController();
  const onAborted = () => abortController.abort();
  req.once("aborted", onAborted);

  try {
    if (!req.is("application/octet-stream")) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "Uploads must use application/octet-stream",
      );
    }
    const metadata = uploadMetadata(req);
    key = uploadProgressKey(
      req.user!.id,
      req.workspace!.id,
      metadata.uploadId,
    );
    publishUploadProgress(key, {
      phase: "waiting",
      bytesSent: 0,
      totalBytes: metadata.sizeBytes,
      errorCode: null,
    });

    const driveOwnerId = req.workspace!.userId;
    const drive = await getUserDriveClient(prisma, driveOwnerId);
    const document = await withDriveErrors(
      prisma,
      driveOwnerId,
      drive,
      (client) =>
        uploadDocument(prisma, client, {
          userId: req.user!.id,
          driveOwnerId,
          workspaceId: req.workspace!.id,
          name: metadata.name,
          mimeType: metadata.mimeType,
          sizeBytes: metadata.sizeBytes,
          body: req,
          signal: abortController.signal,
          onProgress: (bytesSent) => {
            publishUploadProgress(key!, {
              phase: "uploading",
              bytesSent,
              totalBytes: metadata.sizeBytes,
              errorCode: null,
            });
          },
        }),
    );

    publishUploadProgress(key, {
      phase: "complete",
      bytesSent: metadata.sizeBytes,
      totalBytes: metadata.sizeBytes,
      errorCode: null,
    });
    emitWorkspaceEvent(req.workspace!.id, { type: "document.created", entityId: document.id, actorUserId: req.user!.id });
    ok(res, document, 201);
  } catch (err) {
    if (key) {
      publishUploadProgress(key, {
        phase: "error",
        bytesSent: 0,
        totalBytes: Number(singleHeader(req, "x-file-size")) || 0,
        errorCode: err instanceof AppError ? err.code : "DRIVE_ERROR",
      });
    }
    if (!req.destroyed && !res.headersSent) next(err);
  } finally {
    req.off("aborted", onAborted);
  }
});

/** Attach a document to a task, or detach it with taskId:null. */
documentsRouter.patch(
  "/:documentId",
  validateParams(documentParamsSchema),
  requireWorkspaceRole("EDITOR"),
  validateBody(attachDocumentSchema),
  async (req, res, next) => {
    try {
      const document = await attachDocument(
        prisma,
        req.workspace!.id,
        req.params.documentId!,
        (req.body as { taskId: string | null }).taskId,
      );
      emitWorkspaceEvent(req.workspace!.id, { type: "document.updated", entityId: document.id, actorUserId: req.user!.id });
      ok(res, document);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Remove the database record. deleteFromDrive is false by default and must be
 * explicitly opted into by the user.
 */
documentsRouter.delete(
  "/:documentId",
  validateParams(documentParamsSchema),
  validateQuery(deleteDocumentQuerySchema),
  requireWorkspaceRole("EDITOR"),
  async (req, res, next) => {
    try {
      const deleteFromDrive = (req.query as unknown as { deleteFromDrive: boolean })
        .deleteFromDrive;
      if (deleteFromDrive && !req.workspaceAccess!.isOwner) {
        throw forbidden("Only the workspace owner can permanently delete a Drive file");
      }
      const drive = deleteFromDrive
        ? await getUserDriveClient(prisma, req.workspace!.userId)
        : null;
      if (drive) {
        await withDriveErrors(prisma, req.workspace!.userId, drive, (client) =>
          deleteDocument(
            prisma,
            client,
            req.workspace!.id,
            req.params.documentId!,
            true,
          ),
        );
      } else {
        await deleteDocument(
          prisma,
          null,
          req.workspace!.id,
          req.params.documentId!,
          false,
        );
      }
      emitWorkspaceEvent(req.workspace!.id, { type: "document.deleted", entityId: req.params.documentId, actorUserId: req.user!.id });
      ok(res, { deleted: true });
    } catch (err) {
      next(err);
    }
  },
);
