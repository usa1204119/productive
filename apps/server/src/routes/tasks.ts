import { Router } from "express";
import {
  createTaskSchema,
  reorderTaskSchema,
  taskParamsSchema,
  updateTaskSchema,
} from "@plane-and-curves/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requireWorkspaceAccess, requireWorkspaceRole } from "../middleware/workspace.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { ok } from "../lib/respond.js";
import {
  createTask,
  deleteTask,
  listTasks,
  reorderTask,
  toTaskDto,
  updateTask,
} from "../lib/tasks.js";
import { emitWorkspaceEvent } from "../collaboration/hub.js";

// Mounted at /workspaces/:workspaceId/tasks — mergeParams exposes :workspaceId.
export const tasksRouter = Router({ mergeParams: true });

tasksRouter.use(requireAuth, requireWorkspaceAccess);

/** List all tasks in the workspace, in list order. */
tasksRouter.get("/", async (req, res, next) => {
  try {
    const tasks = await listTasks(prisma, req.workspace!.id);
    ok(res, tasks.map(toTaskDto));
  } catch (err) {
    next(err);
  }
});

/** Add a task (appended to the end). */
tasksRouter.post("/", requireWorkspaceRole("EDITOR"), validateBody(createTaskSchema), async (req, res, next) => {
  try {
    const { title } = req.body as { title: string };
    const task = await createTask(prisma, req.workspace!.id, title);
    emitWorkspaceEvent(req.workspace!.id, { type: "task.created", entityId: task.id, actorUserId: req.user!.id });
    ok(res, toTaskDto(task), 201);
  } catch (err) {
    next(err);
  }
});

/** Patch a task (title/description/dueAt/completed). */
tasksRouter.patch(
  "/:taskId",
  validateParams(taskParamsSchema),
  requireWorkspaceRole("EDITOR"),
  validateBody(updateTaskSchema),
  async (req, res, next) => {
    try {
      const task = await updateTask(prisma, req.workspace!.id, req.params.taskId!, req.body);
      emitWorkspaceEvent(req.workspace!.id, { type: "task.updated", entityId: task.id, actorUserId: req.user!.id });
      ok(res, toTaskDto(task));
    } catch (err) {
      next(err);
    }
  },
);

/** Reorder a task between two neighbours. */
tasksRouter.post(
  "/:taskId/reorder",
  validateParams(taskParamsSchema),
  requireWorkspaceRole("EDITOR"),
  validateBody(reorderTaskSchema),
  async (req, res, next) => {
    try {
      const { prevId, nextId } = req.body as { prevId: string | null; nextId: string | null };
      const task = await reorderTask(prisma, req.workspace!.id, req.params.taskId!, prevId, nextId);
      emitWorkspaceEvent(req.workspace!.id, { type: "task.reordered", entityId: task.id, actorUserId: req.user!.id });
      ok(res, toTaskDto(task));
    } catch (err) {
      next(err);
    }
  },
);

/** Delete a task (detaches its documents; does not delete them). */
tasksRouter.delete("/:taskId", validateParams(taskParamsSchema), requireWorkspaceRole("EDITOR"), async (req, res, next) => {
  try {
    await deleteTask(prisma, req.workspace!.id, req.params.taskId!);
    emitWorkspaceEvent(req.workspace!.id, { type: "task.deleted", entityId: req.params.taskId, actorUserId: req.user!.id });
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});
