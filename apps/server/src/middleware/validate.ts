import type { RequestHandler } from "express";
import type { ZodTypeAny } from "zod";

/**
 * Validate part of the request against a Zod schema BEFORE business logic runs.
 * On success the parsed (and coerced/trimmed) value replaces the raw one.
 * On failure the ZodError bubbles to the central error handler, which renders
 * it as a VALIDATION_ERROR.
 */
function validate(target: "body" | "params" | "query"): (schema: ZodTypeAny) => RequestHandler {
  return (schema) => (req, _res, next) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) return next(result.error);
    // params/query are read-only getters on some Express versions; assign safely.
    Object.defineProperty(req, target, { value: result.data, configurable: true, writable: true });
    next();
  };
}

export const validateBody = validate("body");
export const validateParams = validate("params");
export const validateQuery = validate("query");
