import type { RequestHandler } from "express";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "../db.js";
import { AppError, forbidden } from "../errors.js";
import { getWorkspaceAccess } from "../authorization/workspaceAccess.js";

const rank: Record<WorkspaceRole, number> = { VIEWER: 0, EDITOR: 1, OWNER: 2 };

/** Resolve a workspace and the caller's membership in one scoped query. */
export const requireWorkspaceAccess: RequestHandler = async (req, _res, next) => {
  try {
    const workspaceId = req.params.workspaceId;
    if (!workspaceId) throw new AppError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");

    const access = await getWorkspaceAccess(prisma, req.user!.id, workspaceId);
    if (!access) throw new AppError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");

    req.workspace = access.workspace;
    req.workspaceAccess = { role: access.role, isOwner: access.isOwner };
    next();
  } catch (error) {
    next(error);
  }
};

/** Require at least the supplied role; use after requireWorkspaceAccess. */
export function requireWorkspaceRole(minimumRole: WorkspaceRole): RequestHandler {
  return (req, _res, next) => {
    if (!req.workspaceAccess) {
      next(new AppError(500, "INTERNAL_ERROR", "Workspace authorization was not initialized"));
      return;
    }
    if (rank[req.workspaceAccess.role] < rank[minimumRole]) {
      next(forbidden("Your workspace role does not allow this action"));
      return;
    }
    next();
  };
}

/** Canonical-owner-only operations: sharing, workspace lifecycle and Drive deletion. */
export const requireWorkspaceOwner: RequestHandler = (req, _res, next) => {
  if (!req.workspaceAccess?.isOwner) {
    next(forbidden("Only the workspace owner can perform this action"));
    return;
  }
  next();
};

/** Backward-compatible name while route modules migrate to explicit policies. */
export const requireWorkspace = requireWorkspaceAccess;
