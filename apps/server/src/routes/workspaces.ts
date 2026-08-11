import { Router } from "express";
import {
  createWorkspaceSchema,
  renameWorkspaceSchema,
  workspaceParamsSchema,
} from "@plane-and-curves/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import {
  requireWorkspaceAccess,
  requireWorkspaceOwner,
} from "../middleware/workspace.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { ok } from "../lib/respond.js";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  renameWorkspace,
  toWorkspaceDto,
} from "../lib/workspaces.js";
import { emitWorkspaceEvent } from "../collaboration/hub.js";

export const workspacesRouter = Router();

// Every workspace route requires a session.
workspacesRouter.use(requireAuth);

/** List the current user's workspaces. */
workspacesRouter.get("/", async (req, res, next) => {
  try {
    const workspaces = await listWorkspaces(prisma, req.user!.id);
    ok(res, workspaces.map((workspace) => toWorkspaceDto(workspace, workspace.currentRole)));
  } catch (err) {
    next(err);
  }
});

/** Create a workspace (per-user limit enforced atomically). */
workspacesRouter.post("/", validateBody(createWorkspaceSchema), async (req, res, next) => {
  try {
    const { name } = req.body as { name: string };
    const workspace = await createWorkspace(prisma, req.user!.id, name);
    ok(res, toWorkspaceDto(workspace), 201);
  } catch (err) {
    next(err);
  }
});

/** Rename a workspace the user owns. */
workspacesRouter.patch(
  "/:workspaceId",
  validateParams(workspaceParamsSchema),
  requireWorkspaceAccess,
  requireWorkspaceOwner,
  validateBody(renameWorkspaceSchema),
  async (req, res, next) => {
    try {
      const { name } = req.body as { name: string };
      const workspace = await renameWorkspace(prisma, req.user!.id, req.workspace!.id, name);
      emitWorkspaceEvent(req.workspace!.id, { type: "workspace.updated", entityId: req.workspace!.id, actorUserId: req.user!.id });
      ok(res, toWorkspaceDto(workspace));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Delete a workspace the user owns. Cascades to boards, tasks and document
 * records; never touches the user's Google Drive files (the client shows that
 * in the confirmation dialog).
 */
workspacesRouter.delete(
  "/:workspaceId",
  validateParams(workspaceParamsSchema),
  requireWorkspaceAccess,
  requireWorkspaceOwner,
  async (req, res, next) => {
    try {
      await deleteWorkspace(prisma, req.user!.id, req.workspace!.id);
      ok(res, { deleted: true });
    } catch (err) {
      next(err);
    }
  },
);
