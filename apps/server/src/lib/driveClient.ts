import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import type { OAuth2Client } from "google-auth-library";
import { AppError } from "../errors.js";

/**
 * Port for Google Drive I/O. Business logic depends on this interface rather
 * than googleapis so the complete Documents lifecycle can use a deterministic
 * fake Drive in tests.
 */
export interface DriveClient {
  createFolder(
    name: string,
    parentId: string | null,
    appProperties: Record<string, string>,
  ): Promise<string>;
  findFolder(
    appProperty: { key: string; value: string },
    parentId: string | null,
  ): Promise<string | null>;
  folderExists(folderId: string): Promise<boolean>;
  uploadFile(params: UploadParams): Promise<UploadResult>;
  getFileMeta(fileId: string): Promise<FileMeta | null>;
  deleteFile(fileId: string): Promise<void>;
  findPermission?(folderId: string, email: string): Promise<string | null>;
  createPermission?(folderId: string, email: string, role: "reader" | "writer"): Promise<string>;
  updatePermission?(folderId: string, permissionId: string, role: "reader" | "writer"): Promise<void>;
  deletePermission?(folderId: string, permissionId: string): Promise<void>;
}

export interface UploadParams {
  name: string;
  mimeType: string;
  sizeBytes: number;
  folderId: string;
  body: Readable;
  signal?: AbortSignal;
  onProgress?: (bytesSent: number) => void;
}

export interface UploadResult {
  fileId: string;
  webViewLink: string;
  iconLink: string | null;
}

export interface FileMeta {
  webViewLink: string;
  iconLink: string | null;
}

interface DriveApiFile {
  id?: string | null;
  webViewLink?: string | null;
  iconLink?: string | null;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";
const RESUMABLE_THRESHOLD_BYTES = 5 * 1024 * 1024;
const RESUMABLE_CHUNK_BYTES = 8 * 1024 * 1024; // 32 × Drive's required 256 KiB unit
const MAX_CHUNK_RETRIES = 4;

function statusOf(err: unknown): number | undefined {
  const e = err as { code?: number | string; response?: { status?: number } };
  const value = e?.response?.status ?? e?.code;
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function errorText(err: unknown): string {
  const e = err as {
    code?: string;
    message?: string;
    response?: { data?: { error?: string; error_description?: string } };
    cause?: { message?: string };
  };
  return [
    e?.code,
    e?.message,
    e?.response?.data?.error,
    e?.response?.data?.error_description,
    e?.cause?.message,
  ]
    .filter(Boolean)
    .join(" ");
}

/** True when Google reports the refresh token is no longer valid. */
export function isInvalidGrant(err: unknown): boolean {
  return /\binvalid_grant\b/i.test(errorText(err));
}

function isMissing(err: unknown): boolean {
  const status = statusOf(err);
  return status === 404 || status === 410;
}

function isTransientStatus(status: number | undefined): boolean {
  return status === 408 || status === 429 || (status !== undefined && status >= 500);
}

function isRetryableTransportError(err: unknown): boolean {
  const status = statusOf(err);
  // Network resets/timeouts commonly have no HTTP status. Bound retries keep
  // this from masking persistent programming or configuration errors forever.
  return status === undefined || isTransientStatus(status);
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  const name = (err as { name?: string })?.name;
  return signal?.aborted === true || name === "AbortError";
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== "object") return null;
  const getter = (headers as { get?: (headerName: string) => unknown }).get;
  if (typeof getter === "function") {
    const value = getter.call(headers, name);
    return value == null ? null : String(value);
  }
  const record = headers as Record<string, unknown>;
  const value =
    record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];
  if (Array.isArray(value)) return value[0] == null ? null : String(value[0]);
  return value == null ? null : String(value);
}

function parseAcceptedBytes(headers: unknown, fallback: number): number {
  const range = headerValue(headers, "range");
  const match = range?.match(/bytes=0-(\d+)/i);
  return match?.[1] ? Number(match[1]) + 1 : fallback;
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function toUploadResult(file: DriveApiFile): UploadResult {
  if (!file.id || !file.webViewLink) {
    throw new Error("Drive did not return a file id and webViewLink");
  }
  return {
    fileId: file.id,
    webViewLink: file.webViewLink,
    iconLink: file.iconLink ?? null,
  };
}

async function* chunks(body: Readable, totalBytes: number): AsyncGenerator<Buffer> {
  let parts: Buffer[] = [];
  let bufferedBytes = 0;
  let received = 0;

  for await (const raw of body) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
    received += chunk.length;
    if (received > totalBytes) {
      throw new AppError(400, "VALIDATION_ERROR", "Uploaded data exceeds the declared file size");
    }
    let cursor = 0;
    while (cursor < chunk.length) {
      const take = Math.min(
        RESUMABLE_CHUNK_BYTES - bufferedBytes,
        chunk.length - cursor,
      );
      parts.push(chunk.subarray(cursor, cursor + take));
      bufferedBytes += take;
      cursor += take;

      if (bufferedBytes === RESUMABLE_CHUNK_BYTES) {
        yield Buffer.concat(parts, bufferedBytes);
        parts = [];
        bufferedBytes = 0;
      }
    }
  }

  if (bufferedBytes > 0) yield Buffer.concat(parts, bufferedBytes);
  if (received !== totalBytes) {
    throw new AppError(400, "VALIDATION_ERROR", "Uploaded data does not match the declared file size");
  }
}

async function queryResumableOffset(
  auth: OAuth2Client,
  sessionUrl: string,
  totalBytes: number,
  fallback: number,
  signal?: AbortSignal,
): Promise<{ accepted: number; file: DriveApiFile | null }> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await auth.request<DriveApiFile>({
        url: sessionUrl,
        method: "PUT",
        headers: {
          "Content-Length": "0",
          "Content-Range": `bytes */${totalBytes}`,
        },
        data: Buffer.alloc(0),
        signal,
        validateStatus: (status) =>
          status === 308 ||
          (status >= 200 && status < 300) ||
          isTransientStatus(status),
      });

      if (response.status >= 200 && response.status < 300) {
        return { accepted: totalBytes, file: response.data };
      }
      if (isTransientStatus(response.status)) {
        throw Object.assign(new Error("Drive resumable status query failed"), {
          response: { status: response.status },
        });
      }
      return {
        accepted: parseAcceptedBytes(response.headers, fallback),
        file: null,
      };
    } catch (err) {
      if (
        isAbort(err, signal) ||
        isInvalidGrant(err) ||
        !isRetryableTransportError(err) ||
        attempt >= MAX_CHUNK_RETRIES
      ) {
        throw err;
      }
      await delay(Math.min(250 * 2 ** attempt, 2_000), undefined, { signal });
    }
  }
}

async function sendResumableChunk(
  auth: OAuth2Client,
  sessionUrl: string,
  chunk: Buffer,
  start: number,
  totalBytes: number,
  signal?: AbortSignal,
): Promise<{ accepted: number; file: DriveApiFile | null }> {
  const endExclusive = start + chunk.length;
  let cursor = start;
  let retries = 0;

  while (cursor < endExclusive) {
    try {
      const payload = chunk.subarray(cursor - start);
      const response = await auth.request<DriveApiFile>({
        url: sessionUrl,
        method: "PUT",
        headers: {
          "Content-Length": String(payload.length),
          "Content-Range": `bytes ${cursor}-${endExclusive - 1}/${totalBytes}`,
        },
        data: payload,
        signal,
        validateStatus: (status) =>
          status === 308 || (status >= 200 && status < 300) || isTransientStatus(status),
      });

      if (response.status >= 200 && response.status < 300) {
        return { accepted: totalBytes, file: response.data };
      }
      if (response.status === 308) {
        const accepted = parseAcceptedBytes(response.headers, cursor);
        if (accepted <= cursor) {
          retries += 1;
          if (retries > MAX_CHUNK_RETRIES) {
            throw new Error("Drive resumable upload made no progress");
          }
          await delay(Math.min(250 * 2 ** (retries - 1), 2_000), undefined, {
            signal,
          });
          continue;
        }
        cursor = accepted;
        retries = 0;
        if (cursor >= endExclusive) return { accepted: cursor, file: null };
        continue;
      }
      throw Object.assign(new Error("Transient Drive upload response"), {
        response: { status: response.status },
      });
    } catch (err) {
      if (
        isAbort(err, signal) ||
        isInvalidGrant(err) ||
        !isRetryableTransportError(err)
      ) {
        throw err;
      }
      retries += 1;
      if (retries > MAX_CHUNK_RETRIES) throw err;

      await delay(Math.min(250 * 2 ** (retries - 1), 2_000), undefined, { signal });
      const state = await queryResumableOffset(
        auth,
        sessionUrl,
        totalBytes,
        cursor,
        signal,
      );
      if (state.file) return state;
      cursor = Math.max(cursor, state.accepted);
      if (cursor >= endExclusive) return { accepted: cursor, file: null };
    }
  }

  return { accepted: endExclusive, file: null };
}

async function resumableUpload(auth: OAuth2Client, params: UploadParams): Promise<UploadResult> {
  const initiated = await auth.request<unknown>({
    url: "https://www.googleapis.com/upload/drive/v3/files",
    method: "POST",
    params: {
      uploadType: "resumable",
      fields: "id,webViewLink,iconLink",
    },
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": params.mimeType,
      "X-Upload-Content-Length": String(params.sizeBytes),
    },
    data: {
      name: params.name,
      parents: [params.folderId],
    },
    signal: params.signal,
  });

  const sessionUrl = headerValue(initiated.headers, "location");
  if (!sessionUrl) throw new Error("Drive did not return a resumable upload session");

  let offset = 0;
  for await (const chunk of chunks(params.body, params.sizeBytes)) {
    const outcome = await sendResumableChunk(
      auth,
      sessionUrl,
      chunk,
      offset,
      params.sizeBytes,
      params.signal,
    );
    offset = outcome.accepted;
    params.onProgress?.(Math.min(offset, params.sizeBytes));
    if (outcome.file) return toUploadResult(outcome.file);
  }

  throw new Error("Drive resumable upload ended without final file metadata");
}

/** Real Drive adapter over googleapis, bound to one user's OAuth client. */
export function makeGoogleDriveClient(auth: OAuth2Client): DriveClient {
  const filesUrl = "https://www.googleapis.com/drive/v3/files";
  const uploadUrl = "https://www.googleapis.com/upload/drive/v3/files";

  return {
    async createFolder(name, parentId, appProperties) {
      const res = await auth.request<DriveApiFile>({
        url: filesUrl,
        method: "POST",
        params: { fields: "id" },
        data: {
          name,
          mimeType: FOLDER_MIME,
          parents: parentId ? [parentId] : undefined,
          appProperties,
        },
      });
      const id = res.data.id;
      if (!id) throw new Error("Drive did not return a folder id");
      return id;
    },

    async findFolder(appProperty, parentId) {
      const key = escapeDriveQuery(appProperty.key);
      const value = escapeDriveQuery(appProperty.value);
      const clauses = [
        `mimeType = '${FOLDER_MIME}'`,
        "trashed = false",
        `appProperties has { key='${key}' and value='${value}' }`,
      ];
      if (parentId) clauses.push(`'${escapeDriveQuery(parentId)}' in parents`);

      const res = await auth.request<{ files?: DriveApiFile[] }>({
        url: filesUrl,
        method: "GET",
        params: {
          q: clauses.join(" and "),
          spaces: "drive",
          pageSize: 1,
          fields: "files(id)",
        },
      });
      return res.data.files?.[0]?.id ?? null;
    },

    async folderExists(folderId) {
      try {
        const res = await auth.request<DriveApiFile & { trashed?: boolean }>({
          url: `${filesUrl}/${encodeURIComponent(folderId)}`,
          method: "GET",
          params: { fields: "id,trashed" },
        });
        return res.data.trashed !== true;
      } catch (err) {
        if (isMissing(err)) return false;
        throw err;
      }
    },

    async uploadFile(params) {
      if (params.sizeBytes >= RESUMABLE_THRESHOLD_BYTES) {
        return resumableUpload(auth, params);
      }

      const bodyParts: Buffer[] = [];
      for await (const raw of params.body) {
        bodyParts.push(Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array));
      }
      const file = Buffer.concat(bodyParts);
      const boundary = `pac_${Date.now().toString(36)}`;
      const metadata = JSON.stringify({ name: params.name, parents: [params.folderId] });
      const multipart = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${params.mimeType}\r\n\r\n`),
        file,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const res = await auth.request<DriveApiFile>({
        url: uploadUrl,
        method: "POST",
        params: { uploadType: "multipart", fields: "id,webViewLink,iconLink" },
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        data: multipart,
        signal: params.signal,
      });
      params.onProgress?.(params.sizeBytes);
      return toUploadResult(res.data);
    },

    async getFileMeta(fileId) {
      try {
        const res = await auth.request<DriveApiFile & { trashed?: boolean }>({
          url: `${filesUrl}/${encodeURIComponent(fileId)}`,
          method: "GET",
          params: { fields: "webViewLink,iconLink,trashed" },
        });
        if (res.data.trashed === true || !res.data.webViewLink) return null;
        return {
          webViewLink: res.data.webViewLink,
          iconLink: res.data.iconLink ?? null,
        };
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },

    async deleteFile(fileId) {
      try {
        await auth.request({ url: `${filesUrl}/${encodeURIComponent(fileId)}`, method: "DELETE" });
      } catch (err) {
        if (isMissing(err)) return;
        throw err;
      }
    },

    async findPermission(folderId, email) {
      const res = await auth.request<{ permissions?: Array<{ id?: string; emailAddress?: string }> }>({
        url: `${filesUrl}/${encodeURIComponent(folderId)}/permissions`,
        method: "GET",
        params: { fields: "permissions(id,emailAddress)" },
      });
      return res.data.permissions?.find(
        (permission) => permission.emailAddress?.toLowerCase() === email.toLowerCase(),
      )?.id ?? null;
    },

    async createPermission(folderId, email, role) {
      const res = await auth.request<{ id?: string }>({
        url: `${filesUrl}/${encodeURIComponent(folderId)}/permissions`,
        method: "POST",
        params: { sendNotificationEmail: false, fields: "id" },
        data: { type: "user", role, emailAddress: email },
      });
      if (!res.data.id) throw new Error("Drive did not return a permission id");
      return res.data.id;
    },

    async updatePermission(folderId, permissionId, role) {
      await auth.request({
        url: `${filesUrl}/${encodeURIComponent(folderId)}/permissions/${encodeURIComponent(permissionId)}`,
        method: "PATCH",
        data: { role },
      });
    },

    async deletePermission(folderId, permissionId) {
      try {
        await auth.request({
          url: `${filesUrl}/${encodeURIComponent(folderId)}/permissions/${encodeURIComponent(permissionId)}`,
          method: "DELETE",
        });
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    },
  };
}
