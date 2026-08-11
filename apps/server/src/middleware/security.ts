import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import helmet from "helmet";
import { env, isProd } from "../env.js";
import { AppError } from "../errors.js";

export const requestId: RequestHandler = (req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
};

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'", "data:"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.googleusercontent.com"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'", "blob:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      workerSrc: ["'self'", "blob:"],
      formAction: ["'self'"],
      upgradeInsecureRequests: isProd ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  crossOriginResourcePolicy: { policy: "same-origin" },
  hsts: isProd ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
  referrerPolicy: { policy: "no-referrer" },
});

export const permissionsPolicy: RequestHandler = (_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  );
  next();
};

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const allowedOrigins = new Set([new URL(env.WEB_URL).origin, new URL(env.SERVER_URL).origin]);

/** Reject cross-site cookie-authenticated mutations before route handling. */
export const protectUnsafeRequests: RequestHandler = (req, _res, next) => {
  if (!unsafeMethods.has(req.method)) return next();
  const fetchSite = req.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    next(new AppError(403, "ORIGIN_NOT_ALLOWED", "Cross-site request rejected"));
    return;
  }
  const origin = req.get("origin");
  if (origin && !allowedOrigins.has(origin)) {
    next(new AppError(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed"));
    return;
  }
  next();
};

export function redactRequestUrl(url: string | undefined): string | undefined {
  return url?.replace(/(\/workspace-invitations\/|\/invite\/)[^/?#]+/g, "$1[REDACTED]");
}
