import { z } from "zod";

/** Max upload size per file: 100 MB. Enforced before streaming to Drive. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_DOCUMENT_NAME_LENGTH = 500;
export const MAX_MIME_TYPE_LENGTH = 255;

/** A document record. `missing` = the underlying Drive file is unreachable. */
export const documentDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  webViewLink: z.string(),
  iconLink: z.string().nullable(),
  taskId: z.string().nullable(),
  missing: z.boolean(),
  createdAt: z.string(),
});
export type DocumentDto = z.infer<typeof documentDtoSchema>;

/** Attach/detach a document to a task (null detaches). */
export const attachDocumentSchema = z.object({
  taskId: z.string().min(1).nullable(),
});
export type AttachDocumentInput = z.infer<typeof attachDocumentSchema>;

/**
 * Delete a document. By default only the record is removed; the caller must opt
 * in explicitly to also delete the file from Google Drive (unchecked by default
 * in the UI).
 */
export const deleteDocumentQuerySchema = z.object({
  deleteFromDrive: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((v) => v === "true"),
});

export const documentParamsSchema = z.object({
  workspaceId: z.string().min(1),
  documentId: z.string().min(1),
});

export const uploadProgressParamsSchema = z.object({
  workspaceId: z.string().min(1),
  uploadId: z.string().uuid(),
});

export const uploadProgressEventSchema = z.object({
  sequence: z.number().int().positive(),
  phase: z.enum(["waiting", "uploading", "complete", "error"]),
  bytesSent: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
});
export type UploadProgressEvent = z.infer<typeof uploadProgressEventSchema>;

/** Drive connection status for the current user. */
export const driveStatusSchema = z.object({
  connected: z.boolean(),
});
export type DriveStatus = z.infer<typeof driveStatusSchema>;
