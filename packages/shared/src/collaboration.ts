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
