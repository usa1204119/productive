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

/**
 * Returned when an invitation is created (or resent). Carries the shareable
 * `inviteUrl` (only available at creation time — the token is never stored in
 * the clear) so the inviter can copy the link even if the email couldn't be
 * delivered. `emailDelivered` reflects whether the invite email actually sent.
 */
export const createdInvitationDtoSchema = workspaceInvitationDtoSchema.extend({
  inviteUrl: z.string(),
  emailDelivered: z.boolean(),
});
export type CreatedInvitationDto = z.infer<typeof createdInvitationDtoSchema>;

export const invitationPreviewDtoSchema = z.object({
  workspaceName: z.string(),
  inviterName: z.string(),
  role: assignableWorkspaceRoleSchema,
  emailMasked: z.string(),
  expiresAt: z.string(),
  expired: z.boolean(),
});
export type InvitationPreviewDto = z.infer<typeof invitationPreviewDtoSchema>;
