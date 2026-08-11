import { Router } from "express";
import { invitationTokenParamsSchema } from "@plane-and-curves/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { validateParams } from "../middleware/validate.js";
import { acceptInvitation, previewInvitation } from "../lib/invitations/service.js";
import { ok } from "../lib/respond.js";
import { invitationAcceptRateLimit } from "../middleware/rateLimit.js";

export const invitationsRouter = Router();

invitationsRouter.get("/:token", validateParams(invitationTokenParamsSchema), async (req, res, next) => {
  try {
    ok(res, await previewInvitation(prisma, req.params.token!));
  } catch (error) {
    next(error);
  }
});

invitationsRouter.post(
  "/:token/accept",
  invitationAcceptRateLimit,
  validateParams(invitationTokenParamsSchema),
  requireAuth,
  async (req, res, next) => {
    try {
      ok(res, await acceptInvitation(prisma, req.params.token!, req.user!));
    } catch (error) {
      next(error);
    }
  },
);
