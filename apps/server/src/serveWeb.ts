import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { logger } from "./logger.js";

// Paths handled by the API — these must 404 as JSON, not fall through to the SPA.
const API_PREFIXES = ["/auth", "/workspaces", "/health"];

/**
 * In production the Express server also serves the built web app, so the whole
 * product runs on ONE origin (no cross-site cookies, no CORS). The frontend
 * already uses relative API paths, so this "just works". No-op if the web build
 * isn't present (API-only deploys).
 */
export function serveWeb(app: Express): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const dist = process.env.WEB_DIST_PATH
    ? resolve(process.env.WEB_DIST_PATH)
    : join(here, "..", "..", "web", "dist");

  if (!existsSync(join(dist, "index.html"))) {
    logger.warn(`Web build not found at ${dist}; serving API only`);
    return;
  }

  app.use(express.static(dist));

  // SPA fallback: any non-API GET returns index.html so client routing works.
  app.get("*", (req, res, next) => {
    if (API_PREFIXES.some((p) => req.path === p || req.path.startsWith(`${p}/`))) return next();
    res.sendFile(join(dist, "index.html"));
  });

  logger.info(`Serving web build from ${dist}`);
}
