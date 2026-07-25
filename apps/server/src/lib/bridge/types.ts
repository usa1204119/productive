/**
 * The board -> tasks bridge seam. Everything outside this module depends only on
 * the BoardSelectionProcessor interface, never on a concrete implementation or
 * on Excalidraw. Swapping TextElementsToTasks for a future AITaskGenerator
 * changes only the factory in ./index.ts.
 */

/** Minimal element shape the bridge understands. */
export interface BoardElement {
  id: string;
  type: string;
  text?: string | null;
}

/** A task to be created from one element. */
export interface NewTaskDraft {
  title: string;
  sourceElementId: string;
}

export interface BoardSelectionResult {
  drafts: NewTaskDraft[];
  /** Selected elements that produced no task (no usable text). */
  skipped: number;
  /** Titles that were trimmed to the max length. */
  trimmed: number;
}

export interface BoardSelectionProcessor {
  process(
    elements: readonly BoardElement[],
    ctx: { boardId: string; workspaceId: string },
  ): Promise<BoardSelectionResult>;
}
