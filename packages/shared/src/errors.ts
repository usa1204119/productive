import { z } from "zod";

/**
 * Canonical API error codes. Shared so the frontend can switch on them
 * without matching on human-readable messages.
 */
export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "WORKSPACE_NOT_FOUND",
  "WORKSPACE_LIMIT_REACHED",
  "BOARD_NOT_FOUND",
  "BOARD_CONFLICT",
  "TASK_NOT_FOUND",
  "DOCUMENT_NOT_FOUND",
  "DRIVE_NOT_CONNECTED",
  "DRIVE_DISCONNECTED",
  "DRIVE_ERROR",
  "FILE_TOO_LARGE",
  "GUEST_FORBIDDEN",
  "GOOGLE_ACCOUNT_ALREADY_LINKED",
  "ALREADY_SIGNED_IN",
  "NOT_A_GUEST",
  "OAUTH_ERROR",
  "INVITATION_NOT_FOUND",
  "INVITATION_EXPIRED",
  "INVITATION_ALREADY_USED",
  "INVITATION_EMAIL_MISMATCH",
  "MEMBER_ALREADY_EXISTS",
  "CANNOT_MODIFY_OWNER",
  "SHARING_DISABLED",
  "MAIL_DELIVERY_FAILED",
  "RATE_LIMITED",
  "PAYLOAD_TOO_LARGE",
  "ORIGIN_NOT_ALLOWED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const apiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export type ApiSuccess<T> = { success: true; data: T };
export type ApiResponse<T> = ApiSuccess<T> | ApiError;
