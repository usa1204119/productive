import type { ErrorCode } from "@plane-and-curves/shared";

/**
 * Application error carrying a canonical code + HTTP status. Throw these from
 * business logic; the central error middleware renders them in the exact API
 * error shape. Never leak stack traces or Prisma errors to the client.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export const unauthenticated = (message = "Not signed in") =>
  new AppError(401, "UNAUTHENTICATED", message);

export const forbidden = (message = "Not allowed") =>
  new AppError(403, "FORBIDDEN", message);

export const notFound = (message = "Not found") =>
  new AppError(404, "NOT_FOUND", message);

export const validationError = (message = "Invalid request") =>
  new AppError(400, "VALIDATION_ERROR", message);
