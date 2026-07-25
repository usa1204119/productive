import type { BoardSelectionProcessor } from "./types.js";
import { TextElementsToTasks } from "./textElementsToTasks.js";

export * from "./types.js";
export { createTasksFromSelection } from "./service.js";

/**
 * The single point that decides which processor is in use. Nothing else may
 * assume the concrete implementation — swap this to change the bridge behaviour.
 */
export function getBoardSelectionProcessor(): BoardSelectionProcessor {
  return new TextElementsToTasks();
}
