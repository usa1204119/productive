import { z } from "zod";

export const workspaceEventTypeSchema = z.enum([
  "workspace.member.updated",
  "workspace.updated",
  "board.created",
  "board.updated",
  "board.deleted",
  "task.created",
  "task.updated",
  "task.reordered",
  "task.deleted",
  "document.created",
  "document.updated",
  "document.deleted",
]);
export type WorkspaceEventType = z.infer<typeof workspaceEventTypeSchema>;

export const workspaceEventSchema = z.object({
  type: workspaceEventTypeSchema,
  workspaceId: z.string(),
  entityId: z.string().optional(),
  revision: z.number().int().nonnegative().optional(),
  actorUserId: z.string().optional(),
  occurredAt: z.string(),
});
export type WorkspaceEvent = z.infer<typeof workspaceEventSchema>;

export const presenceEntrySchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  activeWorkspaceId: z.string(),
  activeSection: z.enum(["whiteboard", "tasks", "documents"]),
  lastSeenAt: z.string(),
});
export type PresenceEntry = z.infer<typeof presenceEntrySchema>;

/* ----------------------------------------------------------------------------
 * Live whiteboard co-editing (per-board room). The server relays element and
 * cursor updates between subscribers of the same board; it does not interpret
 * the Excalidraw payload. A single "leader" (the first editor to subscribe)
 * persists the merged scene so N editors never fight the board revision.
 * ------------------------------------------------------------------------- */

/** Minimal element shape the server needs; every other field is preserved. */
export const liveElementSchema = z
  .object({
    id: z.string(),
    version: z.number(),
    versionNonce: z.number().optional(),
  })
  .passthrough();
export type LiveElement = z.infer<typeof liveElementSchema>;

export const MAX_LIVE_ELEMENTS = 20000;

export const boardSubscribeSchema = z.object({
  workspaceId: z.string().min(1),
  boardId: z.string().min(1),
});
export type BoardSubscribeInput = z.infer<typeof boardSubscribeSchema>;

export const boardUnsubscribeSchema = z.object({ boardId: z.string().min(1) });

/** Client -> server: elements this editor just changed (deltas, not full scene). */
export const boardUpdateInputSchema = z.object({
  boardId: z.string().min(1),
  elements: z.array(liveElementSchema).max(MAX_LIVE_ELEMENTS),
});
export type BoardUpdateInput = z.infer<typeof boardUpdateInputSchema>;
/** Server -> client: relayed deltas, stamped with the origin socket id. */
export interface BoardUpdateMessage {
  boardId: string;
  elements: LiveElement[];
  senderId: string;
}

/** Client -> server / server -> client: newly-added image files (by id). */
export const boardFilesInputSchema = z.object({
  boardId: z.string().min(1),
  files: z.record(z.unknown()),
});
export interface BoardFilesMessage {
  boardId: string;
  files: Record<string, unknown>;
}

/** Client -> server: live pointer (scene coords) + current selection. */
export const boardCursorInputSchema = z.object({
  boardId: z.string().min(1),
  x: z.number().nullable(),
  y: z.number().nullable(),
  selectedIds: z.array(z.string()).max(1000).optional(),
});
/** Server -> client: a peer's pointer, stamped with identity. */
export interface BoardCursorMessage {
  boardId: string;
  socketId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  x: number | null;
  y: number | null;
  selectedIds: string[];
}
export interface BoardCursorGoneMessage {
  boardId: string;
  socketId: string;
}

/** Server -> client: whether this socket is the board's save leader. */
export interface BoardRoleMessage {
  boardId: string;
  isLeader: boolean;
}
