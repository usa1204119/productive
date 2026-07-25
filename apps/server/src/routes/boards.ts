import { Router } from "express";
import {
  boardParamsSchema,
  createBoardSchema,
  createTasksFromSelectionSchema,
  renameBoardSchema,
  saveSceneSchema,
} from "@plane-and-curves/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requireWorkspace } from "../middleware/workspace.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { ok } from "../lib/respond.js";
import {
  createBoard,
  deleteBoard,
  getBoard,
  listBoards,
  renameBoard,
  saveScene,
  toBoardDto,
  toBoardSummaryDto,
} from "../lib/boards.js";
import { createTasksFromSelection } from "../lib/bridge/index.js";

// Mounted at /workspaces/:workspaceId/boards — mergeParams exposes :workspaceId.
export const boardsRouter = Router({ mergeParams: true });

// Session + workspace ownership guard the entire board surface.
boardsRouter.use(requireAuth, requireWorkspace);

/** List boards (summaries only — no scene JSON). */
boardsRouter.get("/", async (req, res, next) => {
  try {
    ok(res, await listBoards(prisma, req.workspace!.id));
  } catch (err) {
    next(err);
  }
});

/** Create an empty board. */
boardsRouter.post("/", validateBody(createBoardSchema), async (req, res, next) => {
  try {
    const { name } = req.body as { name: string };
    const board = await createBoard(prisma, req.workspace!.id, name);
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
  validateBody(renameBoardSchema),
  async (req, res, next) => {
    try {
      const { name } = req.body as { name: string };
      ok(res, await renameBoard(prisma, req.workspace!.id, req.params.boardId!, name));
    } catch (err) {
      next(err);
    }
  },
);

/** Persist the Excalidraw scene verbatim (autosave target). */
boardsRouter.put(
  "/:boardId/scene",
  validateParams(boardParamsSchema),
  validateBody(saveSceneSchema),
  async (req, res, next) => {
    try {
      const { elements, appState } = req.body as {
        elements: unknown[];
        appState: Record<string, unknown>;
      };
      ok(res, await saveScene(prisma, req.workspace!.id, req.params.boardId!, elements, appState));
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
boardsRouter.delete("/:boardId", validateParams(boardParamsSchema), async (req, res, next) => {
  try {
    await deleteBoard(prisma, req.workspace!.id, req.params.boardId!);
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});
