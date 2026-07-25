import type { Prisma, PrismaClient, Task } from "@prisma/client";
import type { TaskDto, UpdateTaskInput } from "@plane-and-curves/shared";
import { AppError } from "../errors.js";

const taskNotFound = () => new AppError(404, "TASK_NOT_FOUND", "Task not found");

const ORDER_STEP = 1000;
// If two neighbours are closer than this, float precision is running out — rebalance.
const MIN_GAP = 0.0001;

type Tx = Prisma.TransactionClient;

export function toTaskDto(t: Task): TaskDto {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    completed: t.completed,
    completedAt: t.completedAt?.toISOString() ?? null,
    order: t.order,
    dueAt: t.dueAt?.toISOString() ?? null,
    sourceBoardId: t.sourceBoardId,
    sourceElementId: t.sourceElementId,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** All tasks in a workspace, in list order (ties broken by creation time). */
export function listTasks(db: PrismaClient, workspaceId: string): Promise<Task[]> {
  return db.task.findMany({
    where: { workspaceId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
}

/** Create a task appended to the end: order = max(order) + 1000. */
export async function createTask(
  db: PrismaClient,
  workspaceId: string,
  title: string,
): Promise<Task> {
  const agg = await db.task.aggregate({ where: { workspaceId }, _max: { order: true } });
  const order = (agg._max.order ?? 0) + ORDER_STEP;
  return db.task.create({ data: { workspaceId, title, order } });
}

/** A task to create in bulk. `source*` back-links are optional (set by the bridge). */
export interface TaskDraft {
  title: string;
  sourceBoardId?: string | null;
  sourceElementId?: string | null;
}

/**
 * Create many tasks in ONE transaction (all-or-nothing), each appended in order.
 * Excalidraw-agnostic on purpose: the board->tasks bridge builds the drafts and
 * calls this; the task layer never knows where the drafts came from.
 */
export async function createManyTasks(
  db: PrismaClient,
  workspaceId: string,
  drafts: TaskDraft[],
): Promise<Task[]> {
  if (drafts.length === 0) return [];
  return db.$transaction(async (tx) => {
    const agg = await tx.task.aggregate({ where: { workspaceId }, _max: { order: true } });
    let order = agg._max.order ?? 0;
    const created: Task[] = [];
    for (const draft of drafts) {
      order += ORDER_STEP;
      created.push(
        await tx.task.create({
          data: {
            workspaceId,
            title: draft.title,
            order,
            sourceBoardId: draft.sourceBoardId ?? null,
            sourceElementId: draft.sourceElementId ?? null,
          },
        }),
      );
    }
    return created;
  });
}

/**
 * Patch a task. Completion is a transition: completedAt is set only when going
 * incomplete -> complete, and cleared when reopening; an unchanged `completed`
 * never touches it.
 */
export async function updateTask(
  db: PrismaClient,
  workspaceId: string,
  taskId: string,
  patch: UpdateTaskInput,
): Promise<Task> {
  const current = await db.task.findFirst({ where: { id: taskId, workspaceId } });
  if (!current) throw taskNotFound();

  const data: Prisma.TaskUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.dueAt !== undefined) data.dueAt = patch.dueAt === null ? null : new Date(patch.dueAt);

  if (patch.completed !== undefined && patch.completed !== current.completed) {
    data.completed = patch.completed;
    data.completedAt = patch.completed ? new Date() : null;
  }

  return db.task.update({ where: { id: taskId }, data });
}

/** Reorder a task between two neighbours; rebalances if precision runs out. */
export async function reorderTask(
  db: PrismaClient,
  workspaceId: string,
  taskId: string,
  prevId: string | null,
  nextId: string | null,
): Promise<Task> {
  return db.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: { id: taskId, workspaceId } });
    if (!task) throw taskNotFound();
    const order = await computePlacement(tx, workspaceId, prevId, nextId);
    return tx.task.update({ where: { id: taskId }, data: { order } });
  });
}

async function readNeighbours(
  tx: Tx,
  workspaceId: string,
  prevId: string | null,
  nextId: string | null,
): Promise<[number | null, number | null]> {
  const prev = prevId
    ? await tx.task.findFirst({ where: { id: prevId, workspaceId }, select: { order: true } })
    : null;
  const next = nextId
    ? await tx.task.findFirst({ where: { id: nextId, workspaceId }, select: { order: true } })
    : null;
  return [prev?.order ?? null, next?.order ?? null];
}

async function computePlacement(
  tx: Tx,
  workspaceId: string,
  prevId: string | null,
  nextId: string | null,
): Promise<number> {
  let [prevOrder, nextOrder] = await readNeighbours(tx, workspaceId, prevId, nextId);

  if (prevOrder !== null && nextOrder !== null && nextOrder - prevOrder < MIN_GAP) {
    await rebalance(tx, workspaceId);
    [prevOrder, nextOrder] = await readNeighbours(tx, workspaceId, prevId, nextId);
  }

  if (prevOrder !== null && nextOrder !== null) return (prevOrder + nextOrder) / 2;
  if (nextOrder !== null) return nextOrder - ORDER_STEP; // dropped at the top
  if (prevOrder !== null) return prevOrder + ORDER_STEP; // dropped at the bottom
  return ORDER_STEP; // empty list
}

/** Reassign every task's order to clean multiples of 1000, preserving sequence. */
async function rebalance(tx: Tx, workspaceId: string): Promise<void> {
  const tasks = await tx.task.findMany({
    where: { workspaceId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  let i = 1;
  for (const t of tasks) {
    await tx.task.update({ where: { id: t.id }, data: { order: i * ORDER_STEP } });
    i += 1;
  }
}

/**
 * Delete a task. Per the delete rules this must NOT delete its documents —
 * detach them (set Document.taskId to null) so they stay in the workspace.
 */
export async function deleteTask(
  db: PrismaClient,
  workspaceId: string,
  taskId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: { id: taskId, workspaceId } });
    if (!task) throw taskNotFound();
    await tx.document.updateMany({ where: { taskId }, data: { taskId: null } });
    await tx.task.delete({ where: { id: taskId } });
  });
}
