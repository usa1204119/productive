import type { PrismaClient } from "@prisma/client";
import type { BoardElementInput, BridgeResultDto } from "@plane-and-curves/shared";
import { AppError } from "../../errors.js";
import { createManyTasks, toTaskDto } from "../tasks.js";
import { getBoardSelectionProcessor } from "./index.js";

/**
 * Board -> tasks bridge orchestration. Verifies the board belongs to the
 * workspace, runs the current BoardSelectionProcessor to turn the selection into
 * task drafts, then creates them transactionally with their board/element
 * back-links. This is the composition point: bridge -> task service -> DB. The
 * task service stays unaware of Excalidraw.
 */
export async function createTasksFromSelection(
  db: PrismaClient,
  workspaceId: string,
  boardId: string,
  elements: BoardElementInput[],
): Promise<BridgeResultDto> {
  const board = await db.board.findFirst({ where: { id: boardId, workspaceId } });
  if (!board) throw new AppError(404, "BOARD_NOT_FOUND", "Board not found");

  const processor = getBoardSelectionProcessor();
  const { drafts, skipped, trimmed } = await processor.process(
    elements.map((e) => ({ id: e.id, type: e.type, text: e.text ?? null })),
    { boardId, workspaceId },
  );

  const created = await createManyTasks(
    db,
    workspaceId,
    drafts.map((d) => ({
      title: d.title,
      sourceBoardId: boardId,
      sourceElementId: d.sourceElementId,
    })),
  );

  return { created: created.map(toTaskDto), skipped, trimmed };
}
