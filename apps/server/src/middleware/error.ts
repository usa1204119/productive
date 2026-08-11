import type { ErrorRequestHandler, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import type { ApiError } from "@plane-and-curves/shared";
import { AppError } from "../errors.js";
import { logger } from "../logger.js";

function send(res: Response, status: number, body: ApiError): void {
  res.status(status).json(body);
}

/** 404 for unmatched routes, in the standard error shape. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  send(res, 404, {
    success: false,
    error: { code: "NOT_FOUND", message: "Route not found" },
  });
};

/**
 * Central error handler. The ONLY place that turns thrown errors into HTTP
 * responses. Everything not explicitly modelled becomes an opaque 500 —
 * no stack traces, no Prisma internals, ever reach the client.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    send(res, err.status, {
      success: false,
      error: { code: err.code, message: err.message },
    });
    return;
  }

  if (err instanceof ZodError) {
    send(res, 400, {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      },
    });
    return;
  }

  if (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    err.type === "entity.too.large"
  ) {
    send(res, 413, {
      success: false,
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request payload is too large" },
    });
    return;
  }

  logger.error({ err }, "Unhandled error");
  send(res, 500, {
    success: false,
    error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
  });
};
