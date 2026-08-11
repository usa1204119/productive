import type { Server as SocketServer } from "socket.io";
import type { WorkspaceEvent, WorkspaceEventType } from "@plane-and-curves/shared";

let io: SocketServer | null = null;

export function registerCollaborationServer(server: SocketServer): void {
  io = server;
}

export function emitWorkspaceEvent(
  workspaceId: string,
  event: {
    type: WorkspaceEventType;
    entityId?: string;
    revision?: number;
    actorUserId?: string;
  },
): void {
  const payload: WorkspaceEvent = {
    ...event,
    workspaceId,
    occurredAt: new Date().toISOString(),
  };
  io?.to(`workspace:${workspaceId}`).emit("workspace:event", payload);
}

export function disconnectWorkspaceUser(workspaceId: string, userId: string): void {
  if (!io) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.userId === userId && socket.rooms.has(`workspace:${workspaceId}`)) {
      socket.emit("workspace:access-revoked", { workspaceId });
      socket.leave(`workspace:${workspaceId}`);
    }
  }
}
