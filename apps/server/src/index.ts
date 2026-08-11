import "dotenv/config";
import { createServer } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import pinoHttp from "pino-http";
import { env, isProd } from "./env.js";
import { logger } from "./logger.js";
import { initDb, prisma } from "./db.js";
import { serveWeb } from "./serveWeb.js";
import { authRouter } from "./routes/auth.js";
import { workspacesRouter } from "./routes/workspaces.js";
import { boardsRouter } from "./routes/boards.js";
import { tasksRouter } from "./routes/tasks.js";
import { documentsRouter } from "./routes/documents.js";
import { membersRouter } from "./routes/members.js";
import { invitationsRouter } from "./routes/invitations.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { ok } from "./lib/respond.js";
import {
  permissionsPolicy,
  protectUnsafeRequests,
  redactRequestUrl,
  requestId,
  securityHeaders,
} from "./middleware/security.js";
import {
  closeRateLimitStore,
  generalRateLimit,
  guestRateLimit,
  oauthRateLimit,
  uploadRateLimit,
} from "./middleware/rateLimit.js";
import {
  closeCollaborationServer,
  createCollaborationServer,
} from "./collaboration/server.js";
import { startDriveAclWorker, stopDriveAclWorker } from "./lib/driveAcl/worker.js";

export const app = express();

if (isProd) app.set("trust proxy", 1);

app.use(requestId);
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.requestId!,
    serializers: {
      req: (req) => ({ ...req, url: redactRequestUrl(req.url) }),
    },
  }),
);
app.use(securityHeaders, permissionsPolicy);
// Allow both the web and server origins (they coincide under single-origin
// prod). Matches the socket CORS and protectUnsafeRequests allowlists.
app.use(
  cors({
    origin: [...new Set([new URL(env.WEB_URL).origin, new URL(env.SERVER_URL).origin])],
    credentials: true,
  }),
);
app.use(protectUnsafeRequests);
app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => ok(res, { status: "ok" }));

app.use("/auth/guest", guestRateLimit);
app.use("/auth/google", oauthRateLimit);
app.use(["/auth", "/workspaces", "/workspace-invitations"], generalRateLimit);
app.post("/workspaces/:workspaceId/documents", uploadRateLimit);

app.use("/auth", authRouter);
app.use("/workspaces", workspacesRouter);
// Specific sub-routers MUST be registered before membersRouter. membersRouter is
// mounted on the broad "/workspaces/:workspaceId" prefix and applies an
// owner-only guard at the router level (requireWorkspaceOwner); if it were
// registered first, that guard would run for /boards, /tasks and /documents too
// and 403 every non-owner member before their request reached the right router.
app.use("/workspaces/:workspaceId/boards", boardsRouter);
app.use("/workspaces/:workspaceId/tasks", tasksRouter);
app.use("/workspaces/:workspaceId/documents", documentsRouter);
app.use("/workspaces/:workspaceId", membersRouter);
app.use("/workspace-invitations", invitationsRouter);

if (env.NODE_ENV === "test" && env.E2E_TEST_MODE) {
  const { e2eRouter } = await import("./routes/e2e.js");
  app.use("/__e2e", e2eRouter);
}

if (isProd) serveWeb(app);

app.use(notFoundHandler);
app.use(errorHandler);

async function start(): Promise<void> {
  await initDb();
  if (process.env.USE_PGLITE === "true") {
    logger.warn("Using in-memory PGlite demo database — data is ephemeral (DEV ONLY)");
  }

  const httpServer = createServer(app);
  // Live sync is best-effort: if it can't initialise, the server must still come
  // up (HTTP is what the health check probes), so never let it block startup.
  let io: Awaited<ReturnType<typeof createCollaborationServer>> | null = null;
  try {
    io = await createCollaborationServer(httpServer);
  } catch (error) {
    logger.error({ err: error }, "Collaboration server failed to start; continuing without live sync");
  }
  startDriveAclWorker();
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Graceful shutdown started");
    stopDriveAclWorker();
    const forceTimer = setTimeout(() => {
      logger.error("Graceful shutdown timed out");
      process.exit(1);
    }, 25_000);
    forceTimer.unref();

    if (io) await closeCollaborationServer(io);
    await new Promise<void>((resolve, reject) =>
      httpServer.close((error) => (error ? reject(error) : resolve())),
    );
    await Promise.all([prisma.$disconnect(), closeRateLimitStore()]);
    clearTimeout(forceTimer);
    logger.info("Graceful shutdown complete");
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  httpServer.listen(env.PORT, () => {
    logger.info({ port: env.PORT, serverUrl: env.SERVER_URL }, "Server listening");
  });
}

void start().catch((error: unknown) => {
  logger.fatal({ err: error }, "Server failed to start");
  process.exitCode = 1;
});
