import { z } from "zod";

/**
 * Board scene persistence is a TRANSPARENT store for Excalidraw data. Schemas
 * here validate SHAPE only (an array of elements, an object app-state) and never
 * pick, rename, or drop fields — unknown fields pass through unchanged so we stay
 * forward-compatible with future Excalidraw versions.
 */

const boardName = z.string().trim().min(1, "Name is required").max(100, "Name is too long");

export const createBoardSchema = z.object({ name: boardName });
export type CreateBoardInput = z.infer<typeof createBoardSchema>;

export const renameBoardSchema = z.object({ name: boardName });
export type RenameBoardInput = z.infer<typeof renameBoardSchema>;

/**
 * Scene payload sent on autosave. Permissive by design — no stripping.
 * `files` carries Excalidraw image binaries (data URLs) keyed by fileId; without
 * it images become broken placeholders on reload.
 */
export const saveSceneSchema = z.object({
  elements: z.array(z.unknown()),
  appState: z.record(z.string(), z.unknown()),
  files: z.record(z.string(), z.unknown()).optional().default({}),
});
export type SaveSceneInput = z.infer<typeof saveSceneSchema>;

export const boardParamsSchema = z.object({
  workspaceId: z.string().min(1),
  boardId: z.string().min(1),
});

/** Lightweight list item — deliberately WITHOUT the scene JSON. */
export const boardSummaryDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  updatedAt: z.string(),
});
export type BoardSummaryDto = z.infer<typeof boardSummaryDtoSchema>;

/** Full board including the scene. Fetched only when a board is opened. */
export const boardDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  elements: z.array(z.unknown()),
  appState: z.record(z.string(), z.unknown()),
  files: z.record(z.string(), z.unknown()),
  updatedAt: z.string(),
});
export type BoardDto = z.infer<typeof boardDtoSchema>;
