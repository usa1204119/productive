import { z } from "zod";
import { taskDtoSchema } from "./task.js";

/** Max elements accepted in one "Add to tasks" request (keeps batches bounded). */
export const MAX_SELECTION_ELEMENTS = 1000;

/**
 * Minimal projection of a selected Excalidraw element sent to the bridge. Only
 * these fields cross the wire; the server-side BoardSelectionProcessor is the
 * one place that interprets them (text -> task). `text` is whatever the element
 * carries (null for shapes/arrows without text).
 */
export const boardElementInputSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  text: z.string().nullable().optional(),
});
export type BoardElementInput = z.infer<typeof boardElementInputSchema>;

export const createTasksFromSelectionSchema = z.object({
  elements: z.array(boardElementInputSchema).min(1).max(MAX_SELECTION_ELEMENTS),
});
export type CreateTasksFromSelectionInput = z.infer<typeof createTasksFromSelectionSchema>;

/** Result of an "Add to tasks" action — drives the "Created N, skipped M" toast. */
export const bridgeResultDtoSchema = z.object({
  created: z.array(taskDtoSchema),
  skipped: z.number(), // selected elements that had no text
  trimmed: z.number(), // titles trimmed to the max length
});
export type BridgeResultDto = z.infer<typeof bridgeResultDtoSchema>;
