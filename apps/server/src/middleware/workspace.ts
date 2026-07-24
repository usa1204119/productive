import type { RequestHandler } from "express";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { getOwnedWorkspace } from "../lib/workspaces.js";

/**
 * Shared ownership guard for workspace-scoped routes. Runs after requireAuth,
 * resolves :workspaceId with a SINGLE query scoped to the authenticated user,
 * and attaches the workspace. Anything the user doesn't own is indistinguishable
 * from a missing workspace (404 WORKSPACE_NOT_FOUND) — no ownership leak.
 *
 * This lives here, once, so no route re-implements the check.
 */
export const requireWorkspace: RequestHandler = async (req, _res, next) => {
  try {
    const workspaceId = req.params.workspaceId;
    if (!workspaceId) throw new AppError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");

    const workspace = await getOwnedWorkspace(prisma, req.user!.id, workspaceId);
    if (!workspace) throw new AppError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");

    req.workspace = workspace;
    next();
  } catch (err) {
    next(err);
  }
};
