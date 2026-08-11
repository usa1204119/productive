import { Router } from "express";
import {
  boardParamsSchema,
  createBoardSchema,
  createTasksFromSelectionSchema,
  renameBoardSchema,
  reorderBoardSchema,
  saveSceneSchema,
} from "@plane-and-curves/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requireWorkspaceAccess, requireWorkspaceRole } from "../middleware/workspace.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { ok } from "../lib/respond.js";
import {
  createBoard,
  deleteBoard,
  getBoard,
  listBoards,
  renameBoard,
  reorderBoard,
  saveScene,
  toBoardDto,
  toBoardSummaryDto,
} from "../lib/boards.js";
import { createTasksFromSelection } from "../lib/bridge/index.js";
import { emitWorkspaceEvent } from "../collaboration/hub.js";

// Mounted at /workspaces/:workspaceId/boards — mergeParams exposes :workspaceId.
export const boardsRouter = Router({ mergeParams: true });

// Session + workspace ownership guard the entire board surface.
boardsRouter.use(requireAuth, requireWorkspaceAccess);

/** List boards (summaries only — no scene JSON). */
boardsRouter.get("/", async (req, res, next) => {
  try {
    ok(res, await listBoards(prisma, req.workspace!.id));
  } catch (err) {
    next(err);
  }
});

/** Create an empty board. */
boardsRouter.post("/", requireWorkspaceRole("EDITOR"), validateBody(createBoardSchema), async (req, res, next) => {
  try {
    const { name } = req.body as { name: string };
    const board = await createBoard(prisma, req.workspace!.id, name);
    emitWorkspaceEvent(req.workspace!.id, { type: "board.created", entityId: board.id, revision: board.revision, actorUserId: req.user!.id });
    ok(res, toBoardSummaryDto(board), 201);
  } catch (err) {
    next(err);
  }
});

/** Fetch one full board (scene included). */
boardsRouter.get("/:boardId", validateParams(boardParamsSchema), async (req, res, next) => {
  try {
    const board = await getBoard(prisma, req.workspace!.id, req.params.boardId!);
    ok(res, toBoardDto(board));
  } catch (err) {
    next(err);
  }
});

/** Rename a board. */
boardsRouter.patch(
  "/:boardId",
  validateParams(boardParamsSchema),
  requireWorkspaceRole("EDITOR"),
  validateBody(renameBoardSchema),
  async (req, res, next) => {
    try {
      const { name } = req.body as { name: string };
      const board = await renameBoard(prisma, req.workspace!.id, req.params.boardId!, name);
      emitWorkspaceEvent(req.workspace!.id, { type: "board.updated", entityId: board.id, revision: board.revision, actorUserId: req.user!.id });
      ok(res, board);
    } catch (err) {
      next(err);
    }
  },
);

/** Persist the Excalidraw scene verbatim (autosave target). */
boardsRouter.put(
  "/:boardId/scene",
  validateParams(boardParamsSchema),
  requireWorkspaceRole("EDITOR"),
  validateBody(saveSceneSchema),
  async (req, res, next) => {
    try {
      const { elements, appState, files, baseRevision, force } = req.body as {
        elements: unknown[];
        appState: Record<string, unknown>;
        files?: Record<string, unknown>;
        baseRevision: number;
        force?: boolean;
      };
      const board = await saveScene(
        prisma,
        req.workspace!.id,
        req.params.boardId!,
        elements,
        appState,
        files,
        baseRevision,
        force,
      );
      emitWorkspaceEvent(req.workspace!.id, { type: "board.updated", entityId: board.id, revision: board.revision, actorUserId: req.user!.id });
      ok(res, board);
    } catch (err) {
      next(err);
    }
  },
);

/** Reorder a slide between two neighbours. */
boardsRouter.post(
  "/:boardId/reorder",
  validateParams(boardParamsSchema),
  requireWorkspaceRole("EDITOR"),
  validateBody(reorderBoardSchema),
  async (req, res, next) => {
    try {
      const { prevId, nextId } = req.body as { prevId: string | null; nextId: string | null };
      const board = await reorderBoard(prisma, req.workspace!.id, req.params.boardId!, prevId, nextId);
      emitWorkspaceEvent(req.workspace!.id, {
        type: "board.updated",
        entityId: board.id,
        revision: board.revision,
        actorUserId: req.user!.id,
      });
      ok(res, board);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Board -> tasks bridge: turn a selection of Excalidraw elements into tasks.
 * The processor decides which elements become tasks; creation is transactional.
 */
boardsRouter.post(
  "/:boardId/tasks-from-selection",
  validateParams(boardParamsSchema),
  requireWorkspaceRole("EDITOR"),
  validateBody(createTasksFromSelectionSchema),
  async (req, res, next) => {
    try {
      const { elements } = req.body as {
        elements: { id: string; type: string; text?: string | null }[];
      };
      const result = await createTasksFromSelection(
        prisma,
        req.workspace!.id,
        req.params.boardId!,
        elements,
      );
      ok(res, result, 201);
    } catch (err) {
      next(err);
    }
  },
);

/** Delete a board (does not delete tasks; clears their back-links). */
boardsRouter.delete("/:boardId", validateParams(boardParamsSchema), requireWorkspaceRole("EDITOR"), async (req, res, next) => {
  try {
    await deleteBoard(prisma, req.workspace!.id, req.params.boardId!);
    emitWorkspaceEvent(req.workspace!.id, { type: "board.deleted", entityId: req.params.boardId, actorUserId: req.user!.id });
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});
