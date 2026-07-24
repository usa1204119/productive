import { Router } from "express";
import {
  createTaskSchema,
  reorderTaskSchema,
  taskParamsSchema,
  updateTaskSchema,
} from "@plane-and-curves/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requireWorkspace } from "../middleware/workspace.js";
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

// Mounted at /workspaces/:workspaceId/tasks — mergeParams exposes :workspaceId.
export const tasksRouter = Router({ mergeParams: true });

tasksRouter.use(requireAuth, requireWorkspace);

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
tasksRouter.post("/", validateBody(createTaskSchema), async (req, res, next) => {
  try {
    const { title } = req.body as { title: string };
    const task = await createTask(prisma, req.workspace!.id, title);
    ok(res, toTaskDto(task), 201);
  } catch (err) {
    next(err);
  }
});

/** Patch a task (title/description/dueAt/completed). */
tasksRouter.patch(
  "/:taskId",
  validateParams(taskParamsSchema),
  validateBody(updateTaskSchema),
  async (req, res, next) => {
    try {
      const task = await updateTask(prisma, req.workspace!.id, req.params.taskId!, req.body);
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
  validateBody(reorderTaskSchema),
  async (req, res, next) => {
    try {
      const { prevId, nextId } = req.body as { prevId: string | null; nextId: string | null };
      const task = await reorderTask(prisma, req.workspace!.id, req.params.taskId!, prevId, nextId);
      ok(res, toTaskDto(task));
    } catch (err) {
      next(err);
    }
  },
);

/** Delete a task (detaches its documents; does not delete them). */
tasksRouter.delete("/:taskId", validateParams(taskParamsSchema), async (req, res, next) => {
  try {
    await deleteTask(prisma, req.workspace!.id, req.params.taskId!);
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});
