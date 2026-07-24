import "dotenv/config"; // load apps/server/.env before anything reads process.env
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import pinoHttp from "pino-http";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { initDb } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { workspacesRouter } from "./routes/workspaces.js";
import { boardsRouter } from "./routes/boards.js";
import { tasksRouter } from "./routes/tasks.js";
import { documentsRouter } from "./routes/documents.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { ok } from "./lib/respond.js";

const app = express();

app.use(pinoHttp({ logger }));
app.use(
  cors({
    origin: env.WEB_URL,
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => ok(res, { status: "ok" }));

app.use("/auth", authRouter);
app.use("/workspaces", workspacesRouter);
app.use("/workspaces/:workspaceId/boards", boardsRouter);
app.use("/workspaces/:workspaceId/tasks", tasksRouter);
app.use("/workspaces/:workspaceId/documents", documentsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

async function start(): Promise<void> {
  await initDb();
  if (process.env.USE_PGLITE === "true") {
    logger.warn("Using in-memory PGlite demo database — data is ephemeral (DEV ONLY)");
  }
  app.listen(env.PORT, () => {
    logger.info(`Server listening on ${env.SERVER_URL} (port ${env.PORT})`);
  });
}

void start();
