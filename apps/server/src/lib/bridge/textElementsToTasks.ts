import { MAX_TASK_TITLE_LENGTH } from "@plane-and-curves/shared";
import type { BoardElement, BoardSelectionProcessor, BoardSelectionResult } from "./types.js";

/**
 * The current, intentionally simple processor: each selected element that
 * contains text becomes one task, that text as the title. No AI, no NLP, no
 * grouping, no duplicate detection — deterministic behaviour by design.
 *
 * Rules (product decisions):
 * - Whitespace is collapsed and multi-line text is flattened to a single line,
 *   so task rows stay compact ("Line 1\nLine 2" -> "Line 1 Line 2").
 * - Whitespace-only / textless elements are skipped and counted.
 * - Over-long titles are trimmed to the max length (counted), never silently
 *   dropped; trimming is unicode-safe (never splits a surrogate pair).
 */
export class TextElementsToTasks implements BoardSelectionProcessor {
  async process(elements: readonly BoardElement[]): Promise<BoardSelectionResult> {
    const drafts: BoardSelectionResult["drafts"] = [];
    let skipped = 0;
    let trimmed = 0;

    for (const element of elements) {
      const normalized = normalizeTitle(element.text);
      if (normalized === null) {
        skipped += 1;
        continue;
      }
      const codePoints = Array.from(normalized);
      let title = normalized;
      if (codePoints.length > MAX_TASK_TITLE_LENGTH) {
        title = codePoints.slice(0, MAX_TASK_TITLE_LENGTH).join("");
        trimmed += 1;
      }
      drafts.push({ title, sourceElementId: element.id });
    }

    return { drafts, skipped, trimmed };
  }
}

/** Collapse all whitespace to single spaces and trim; null if nothing remains. */
function normalizeTitle(text: string | null | undefined): string | null {
  if (!text) return null;
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length === 0 ? null : collapsed;
}
