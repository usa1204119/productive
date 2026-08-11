import { z } from "zod";

export const workspaceRoleSchema = z.enum(["OWNER", "EDITOR", "VIEWER"]);
export type WorkspaceRoleDto = z.infer<typeof workspaceRoleSchema>;

export const assignableWorkspaceRoleSchema = z.enum(["EDITOR", "VIEWER"]);
export type AssignableWorkspaceRole = z.infer<typeof assignableWorkspaceRoleSchema>;

export const workspaceMemberParamsSchema = z.object({
  workspaceId: z.string().min(1),
  memberId: z.string().min(1),
});

export const updateWorkspaceMemberSchema = z.object({
  role: assignableWorkspaceRoleSchema,
});

export const workspaceMemberDtoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  displayName: z.string(),
  email: z.string().email().nullable(),
  avatarUrl: z.string().nullable(),
  role: workspaceRoleSchema,
  isOwner: z.boolean(),
  joinedAt: z.string(),
  aclSyncStatus: z.enum(["PENDING", "PROCESSING", "SUCCEEDED", "FAILED"]).nullable(),
  aclSyncError: z.string().nullable(),
});
export type WorkspaceMemberDto = z.infer<typeof workspaceMemberDtoSchema>;
