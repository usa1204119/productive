import { Router } from "express";
import {
  createWorkspaceInvitationSchema,
  invitationParamsSchema,
  updateWorkspaceMemberSchema,
  workspaceMemberParamsSchema,
} from "@plane-and-curves/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requireWorkspaceAccess, requireWorkspaceOwner } from "../middleware/workspace.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { ok } from "../lib/respond.js";
import { mailProvider } from "../lib/mail/index.js";
import {
  createInvitation,
  listPendingInvitations,
  resendInvitation,
  revokeInvitation,
} from "../lib/invitations/service.js";
import { listMembers, removeMember, updateMemberRole } from "../lib/memberships/service.js";
import { emitWorkspaceEvent, disconnectWorkspaceUser } from "../collaboration/hub.js";
import { invitationRateLimit } from "../middleware/rateLimit.js";

export const membersRouter = Router({ mergeParams: true });
membersRouter.use(requireAuth, requireWorkspaceAccess, requireWorkspaceOwner);

membersRouter.get("/members", async (req, res, next) => {
  try {
    ok(res, await listMembers(prisma, req.workspace!.id));
  } catch (error) {
    next(error);
  }
});

membersRouter.get("/invitations", async (req, res, next) => {
  try {
    ok(res, await listPendingInvitations(prisma, req.workspace!.id));
  } catch (error) {
    next(error);
  }
});

membersRouter.post(
  "/invitations",
  invitationRateLimit,
  validateBody(createWorkspaceInvitationSchema),
  async (req, res, next) => {
    try {
      const invitation = await createInvitation(
        prisma,
        mailProvider,
        req.workspace!.id,
        req.user!,
        req.body.email,
        req.body.role,
      );
      ok(res, invitation, 201);
    } catch (error) {
      next(error);
    }
  },
);

membersRouter.post(
  "/invitations/:invitationId/resend",
  invitationRateLimit,
  validateParams(invitationParamsSchema),
  async (req, res, next) => {
    try {
      ok(
        res,
        await resendInvitation(
          prisma,
          mailProvider,
          req.workspace!.id,
          req.params.invitationId!,
          req.user!,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

membersRouter.delete(
  "/invitations/:invitationId",
  validateParams(invitationParamsSchema),
  async (req, res, next) => {
    try {
      await revokeInvitation(
        prisma,
        req.workspace!.id,
        req.params.invitationId!,
        req.user!.id,
      );
      ok(res, { revoked: true });
    } catch (error) {
      next(error);
    }
  },
);

membersRouter.patch(
  "/members/:memberId",
  validateParams(workspaceMemberParamsSchema),
  validateBody(updateWorkspaceMemberSchema),
  async (req, res, next) => {
    try {
      await updateMemberRole(
        prisma,
        req.workspace!.id,
        req.params.memberId!,
        req.body.role,
        req.user!.id,
      );
      emitWorkspaceEvent(req.workspace!.id, {
        type: "workspace.member.updated",
        entityId: req.params.memberId,
        actorUserId: req.user!.id,
      });
      ok(res, { updated: true });
    } catch (error) {
      next(error);
    }
  },
);

membersRouter.delete(
  "/members/:memberId",
  validateParams(workspaceMemberParamsSchema),
  async (req, res, next) => {
    try {
      const removed = await removeMember(
        prisma,
        req.workspace!.id,
        req.params.memberId!,
        req.user!.id,
      );
      disconnectWorkspaceUser(req.workspace!.id, removed.userId);
      emitWorkspaceEvent(req.workspace!.id, {
        type: "workspace.member.updated",
        entityId: req.params.memberId,
        actorUserId: req.user!.id,
      });
      ok(res, { removed: true });
    } catch (error) {
      next(error);
    }
  },
);
