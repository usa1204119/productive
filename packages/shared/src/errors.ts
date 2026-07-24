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
  "TASK_NOT_FOUND",
  "GOOGLE_ACCOUNT_ALREADY_LINKED",
  "ALREADY_SIGNED_IN",
  "NOT_A_GUEST",
  "OAUTH_ERROR",
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
