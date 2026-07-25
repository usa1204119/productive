import { z } from "zod";

/** Max task title length (shared by the add form and the board→tasks bridge). */
export const MAX_TASK_TITLE_LENGTH = 500;

const title = z
  .string()
  .trim()
  .min(1, "Title is required")
  .max(MAX_TASK_TITLE_LENGTH, "Title is too long");
// Nullable, trimmable free text; empty string normalises to null.
const description = z
  .string()
  .max(10_000, "Description is too long")
  .transform((s) => {
    const t = s.trim();
    return t.length === 0 ? null : t;
  })
  .nullable();
// Due date is exchanged as an ISO-8601 UTC instant (or null to clear).
const dueAt = z.string().datetime({ offset: true }).nullable();

/** Add a task — just a title; it is appended to the end of the list. */
export const createTaskSchema = z.object({ title });
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/**
 * Partial update. Each field is optional; only provided fields change.
 * `completed` toggles completion (the server manages completedAt).
 */
export const updateTaskSchema = z
  .object({
    title: title.optional(),
    description: description.optional(),
    dueAt: dueAt.optional(),
    completed: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "No fields to update" });
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/**
 * Reorder: place the task between two neighbours (either may be null for the
 * top/bottom of the active list). The server computes the new float order.
 */
export const reorderTaskSchema = z.object({
  prevId: z.string().nullable(), // task immediately ABOVE (smaller order), or null = top
  nextId: z.string().nullable(), // task immediately BELOW (larger order), or null = bottom
});
export type ReorderTaskInput = z.infer<typeof reorderTaskSchema>;

export const taskParamsSchema = z.object({
  workspaceId: z.string().min(1),
  taskId: z.string().min(1),
});

export const taskDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  completed: z.boolean(),
  completedAt: z.string().nullable(),
  order: z.number(),
  dueAt: z.string().nullable(),
  sourceBoardId: z.string().nullable(),
  sourceElementId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TaskDto = z.infer<typeof taskDtoSchema>;
