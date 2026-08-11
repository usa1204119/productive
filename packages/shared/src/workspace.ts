import { z } from "zod";

/** Maximum workspaces a single user may own. Enforced atomically on create. */
export const MAX_WORKSPACES_PER_USER = 50;

const workspaceName = z.string().trim().min(1, "Name is required").max(100, "Name is too long");

/** Body for creating a workspace. */
export const createWorkspaceSchema = z.object({
  name: workspaceName,
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

/** Body for renaming a workspace. */
export const renameWorkspaceSchema = z.object({
  name: workspaceName,
});
export type RenameWorkspaceInput = z.infer<typeof renameWorkspaceSchema>;

/** Route param carrying a workspace id. */
export const workspaceParamsSchema = z.object({
  workspaceId: z.string().min(1),
});

/** Workspace as exposed to the client. */
export const workspaceDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  driveFolderId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  currentRole: z.enum(["OWNER", "EDITOR", "VIEWER"]),
  isOwner: z.boolean(),
});
export type WorkspaceDto = z.infer<typeof workspaceDtoSchema>;
