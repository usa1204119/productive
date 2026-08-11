import type { Server as HttpServer } from "node:http";
import { Server as SocketServer, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient, type RedisClientType } from "redis";
import type { PresenceEntry } from "@plane-and-curves/shared";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { prisma } from "../db.js";
import { getWorkspaceAccess } from "../authorization/workspaceAccess.js";
import { getUserFromSessionToken } from "../lib/session.js";
import { registerCollaborationServer } from "./hub.js";

interface JoinPayload {
  workspaceId?: unknown;
  activeSection?: unknown;
}

const sections = new Set(["whiteboard", "tasks", "documents"]);
const presence = new Map<string, Map<string, PresenceEntry>>();
let pubClient: RedisClientType | null = null;
let subClient: RedisClientType | null = null;

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

function publishPresence(io: SocketServer, workspaceId: string): void {
  io.to(`workspace:${workspaceId}`).emit(
    "workspace:presence",
    [...(presence.get(workspaceId)?.values() ?? [])],
  );
}

function removePresence(io: SocketServer, socket: Socket): void {
  const workspaceId = socket.data.activeWorkspaceId as string | undefined;
  const userId = socket.data.userId as string | undefined;
  if (!workspaceId || !userId) return;
  const remainingSocket = [...io.sockets.sockets.values()].some(
    (candidate) =>
      candidate.id !== socket.id &&
      candidate.data.userId === userId &&
      candidate.rooms.has(`workspace:${workspaceId}`),
  );
  if (!remainingSocket) {
    presence.get(workspaceId)?.delete(userId);
    if (presence.get(workspaceId)?.size === 0) presence.delete(workspaceId);
  }
  publishPresence(io, workspaceId);
}

export async function createCollaborationServer(httpServer: HttpServer): Promise<SocketServer> {
  const io = new SocketServer(httpServer, {
    path: "/socket.io",
    cors: { origin: env.WEB_URL, credentials: true },
    maxHttpBufferSize: 64 * 1024,
    transports: ["websocket", "polling"],
  });

  if (env.REDIS_URL) {
    try {
      pubClient = createClient({ url: env.REDIS_URL });
      subClient = pubClient.duplicate();
      await Promise.all([pubClient.connect(), subClient.connect()]);
      io.adapter(createAdapter(pubClient, subClient));
    } catch (error) {
      logger.error({ err: error }, "Redis collaboration adapter unavailable; using in-memory adapter");
      await Promise.allSettled([pubClient?.quit(), subClient?.quit()]);
      pubClient = null;
      subClient = null;
    }
  }

  io.use(async (socket, next) => {
    try {
      const token = cookieValue(socket.handshake.headers.cookie, env.SESSION_COOKIE_NAME);
      const user = await getUserFromSessionToken(token);
      if (!user) return next(new Error("UNAUTHENTICATED"));
      socket.data.userId = user.id;
      socket.data.displayName = user.name;
      socket.data.avatarUrl = user.avatarUrl;
      next();
    } catch {
      next(new Error("UNAUTHENTICATED"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("workspace:join", async (payload: JoinPayload, acknowledge?: (result: object) => void) => {
      const workspaceId = typeof payload?.workspaceId === "string" ? payload.workspaceId : "";
      const activeSection =
        typeof payload?.activeSection === "string" && sections.has(payload.activeSection)
          ? (payload.activeSection as PresenceEntry["activeSection"])
          : "whiteboard";
      if (!workspaceId) return acknowledge?.({ ok: false, code: "WORKSPACE_NOT_FOUND" });
      const access = await getWorkspaceAccess(prisma, socket.data.userId as string, workspaceId);
      if (!access) return acknowledge?.({ ok: false, code: "WORKSPACE_NOT_FOUND" });

      const previousWorkspace = socket.data.activeWorkspaceId as string | undefined;
      if (previousWorkspace && previousWorkspace !== workspaceId) {
        socket.leave(`workspace:${previousWorkspace}`);
        removePresence(io, socket);
      }
      socket.data.activeWorkspaceId = workspaceId;
      await socket.join(`workspace:${workspaceId}`);
      const entry: PresenceEntry = {
        userId: socket.data.userId as string,
        displayName: socket.data.displayName as string,
        avatarUrl: (socket.data.avatarUrl as string | null) ?? null,
        activeWorkspaceId: workspaceId,
        activeSection,
        lastSeenAt: new Date().toISOString(),
      };
      const roomPresence = presence.get(workspaceId) ?? new Map<string, PresenceEntry>();
      roomPresence.set(entry.userId, entry);
      presence.set(workspaceId, roomPresence);
      publishPresence(io, workspaceId);
      acknowledge?.({ ok: true, role: access.role });
    });

    socket.on("disconnect", () => removePresence(io, socket));
  });

  registerCollaborationServer(io);
  return io;
}

export async function closeCollaborationServer(io: SocketServer): Promise<void> {
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await Promise.allSettled([pubClient?.quit(), subClient?.quit()]);
  pubClient = null;
  subClient = null;
}
