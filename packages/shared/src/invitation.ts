import { z } from "zod";
import { assignableWorkspaceRoleSchema } from "./membership.js";

export const createWorkspaceInvitationSchema = z.object({
  email: z.string().trim().email().max(320),
  role: assignableWorkspaceRoleSchema,
});
export type CreateWorkspaceInvitationInput = z.infer<typeof createWorkspaceInvitationSchema>;

export const invitationParamsSchema = z.object({
  workspaceId: z.string().min(1),
  invitationId: z.string().min(1),
});

export const invitationTokenParamsSchema = z.object({
  token: z.string().min(32).max(256),
});

export const workspaceInvitationDtoSchema = z.object({
  id: z.string(),
  emailMasked: z.string(),
  role: assignableWorkspaceRoleSchema,
  expiresAt: z.string(),
  createdAt: z.string(),
  expired: z.boolean(),
});
export type WorkspaceInvitationDto = z.infer<typeof workspaceInvitationDtoSchema>;

export const invitationPreviewDtoSchema = z.object({
  workspaceName: z.string(),
  inviterName: z.string(),
  role: assignableWorkspaceRoleSchema,
  emailMasked: z.string(),
  expiresAt: z.string(),
  expired: z.boolean(),
});
export type InvitationPreviewDto = z.infer<typeof invitationPreviewDtoSchema>;
