import type { Server as HttpServer } from "node:http";
import { Server as SocketServer, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient, type RedisClientType } from "redis";
import {
  boardCursorInputSchema,
  boardFilesInputSchema,
  boardSubscribeSchema,
  boardUnsubscribeSchema,
  boardUpdateInputSchema,
  type PresenceEntry,
} from "@plane-and-curves/shared";
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

// Live whiteboard co-editing state (per board). `boardEditors` keeps the ordered
// list of editor sockets in each board room; the first is the "save leader" that
// persists the merged scene so N editors never fight the board revision.
const boardEditors = new Map<string, string[]>();
const boardLeaders = new Map<string, string>();

let pubClient: RedisClientType | null = null;
let subClient: RedisClientType | null = null;

/** Recompute a board's leader and notify sockets whose leadership changed. */
function refreshLeader(io: SocketServer, boardId: string, joiningSocketId?: string): void {
  const newLeader = (boardEditors.get(boardId) ?? [])[0];
  const oldLeader = boardLeaders.get(boardId);
  if (newLeader !== oldLeader) {
    if (oldLeader) io.to(oldLeader).emit("board:role", { boardId, isLeader: false });
    if (newLeader) {
      boardLeaders.set(boardId, newLeader);
      io.to(newLeader).emit("board:role", { boardId, isLeader: true });
    } else {
      boardLeaders.delete(boardId);
    }
  }
  // A newly-joined follower/viewer would otherwise never learn its (non-)leader
  // status, so always tell the joiner explicitly.
  if (joiningSocketId) {
    io.to(joiningSocketId).emit("board:role", {
      boardId,
      isLeader: boardLeaders.get(boardId) === joiningSocketId,
    });
  }
}

/** Remove a socket from a board room, promote a new leader, and clear its cursor. */
function leaveBoard(io: SocketServer, socket: Socket, boardId: string): void {
  const boards = socket.data.boards as Set<string> | undefined;
  if (!boards?.has(boardId)) return;
  boards.delete(boardId);
  (socket.data.canEditBoard as Set<string> | undefined)?.delete(boardId);
  void socket.leave(`board:${boardId}`);
  const editors = boardEditors.get(boardId);
  if (editors) {
    const next = editors.filter((id) => id !== socket.id);
    if (next.length) boardEditors.set(boardId, next);
    else boardEditors.delete(boardId);
  }
  socket.to(`board:${boardId}`).emit("board:cursor-gone", { boardId, socketId: socket.id });
  refreshLeader(io, boardId);
}

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
  // Allow both the web origin and the server's own origin. Under single-origin
  // production these can coincide, but if WEB_URL drifts (stale localhost, http
  // vs https, trailing slash) an origin-only allowlist silently rejects EVERY
  // socket handshake — killing presence and live updates — while plain HTTP
  // (same-origin, CORS-exempt) keeps working. Accepting both keeps the socket
  // alive as long as either env var matches the browser's real origin.
  const allowedOrigins = [...new Set([new URL(env.WEB_URL).origin, new URL(env.SERVER_URL).origin])];
  const io = new SocketServer(httpServer, {
    path: "/socket.io",
    cors: { origin: allowedOrigins, credentials: true },
    maxHttpBufferSize: 64 * 1024,
    transports: ["websocket", "polling"],
  });

  if (env.REDIS_URL) {
    try {
      pubClient = createClient({ url: env.REDIS_URL });
      subClient = pubClient.duplicate();
      // Time-box the connect: an unreachable Redis must NOT hang startup, or the
      // server never reaches listen() and the deploy health check times out.
      // A single instance is correct with the in-memory adapter, so falling back
      // is safe. (Mirrors the guard in middleware/rateLimit.ts.)
      await Promise.race([
        Promise.all([pubClient.connect(), subClient.connect()]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Redis connect timeout")), 5_000),
        ),
      ]);
      io.adapter(createAdapter(pubClient, subClient));
    } catch (error) {
      logger.error({ err: error }, "Redis collaboration adapter unavailable; using in-memory adapter");
      await Promise.allSettled([pubClient?.disconnect(), subClient?.disconnect()]);
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

    // --- Live whiteboard co-editing (per board room) ---------------------------
    socket.on("board:subscribe", async (raw: unknown, ack?: (result: object) => void) => {
      const parsed = boardSubscribeSchema.safeParse(raw);
      if (!parsed.success) return ack?.({ ok: false });
      const { workspaceId, boardId } = parsed.data;
      const access = await getWorkspaceAccess(prisma, socket.data.userId as string, workspaceId);
      if (!access) return ack?.({ ok: false });

      const boards = (socket.data.boards as Set<string> | undefined) ?? new Set<string>();
      socket.data.boards = boards;
      if (boards.has(boardId)) return ack?.({ ok: true });
      boards.add(boardId);
      await socket.join(`board:${boardId}`);

      const canEdit = access.role === "EDITOR" || access.role === "OWNER";
      const canEditBoard =
        (socket.data.canEditBoard as Set<string> | undefined) ?? new Set<string>();
      socket.data.canEditBoard = canEditBoard;
      if (canEdit) {
        canEditBoard.add(boardId);
        const editors = boardEditors.get(boardId) ?? [];
        if (!editors.includes(socket.id)) editors.push(socket.id);
        boardEditors.set(boardId, editors);
      }
      refreshLeader(io, boardId, socket.id);
      ack?.({ ok: true, role: access.role });
    });

    socket.on("board:unsubscribe", (raw: unknown) => {
      const parsed = boardUnsubscribeSchema.safeParse(raw);
      if (parsed.success) leaveBoard(io, socket, parsed.data.boardId);
    });

    socket.on("board:update", (raw: unknown) => {
      const parsed = boardUpdateInputSchema.safeParse(raw);
      if (!parsed.success) return;
      const { boardId, elements } = parsed.data;
      if (!(socket.data.canEditBoard as Set<string> | undefined)?.has(boardId)) return;
      socket.to(`board:${boardId}`).emit("board:update", { boardId, elements, senderId: socket.id });
    });

    socket.on("board:files", (raw: unknown) => {
      const parsed = boardFilesInputSchema.safeParse(raw);
      if (!parsed.success) return;
      const { boardId, files } = parsed.data;
      if (!(socket.data.canEditBoard as Set<string> | undefined)?.has(boardId)) return;
      socket.to(`board:${boardId}`).emit("board:files", { boardId, files });
    });

    socket.on("board:cursor", (raw: unknown) => {
      const parsed = boardCursorInputSchema.safeParse(raw);
      if (!parsed.success) return;
      const { boardId, x, y, selectedIds } = parsed.data;
      if (!(socket.data.boards as Set<string> | undefined)?.has(boardId)) return;
      socket.to(`board:${boardId}`).emit("board:cursor", {
        boardId,
        socketId: socket.id,
        userId: socket.data.userId as string,
        displayName: socket.data.displayName as string,
        avatarUrl: (socket.data.avatarUrl as string | null) ?? null,
        x,
        y,
        selectedIds: selectedIds ?? [],
      });
    });

    socket.on("disconnect", () => {
      for (const boardId of [...((socket.data.boards as Set<string> | undefined) ?? [])]) {
        leaveBoard(io, socket, boardId);
      }
      removePresence(io, socket);
    });
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
