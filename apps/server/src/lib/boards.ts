import type { Board, Prisma, PrismaClient } from "@prisma/client";
import type { BoardDto, BoardSummaryDto } from "@plane-and-curves/shared";
import { AppError } from "../errors.js";

const boardNotFound = () => new AppError(404, "BOARD_NOT_FOUND", "Board not found");

/** JSON value stored/returned verbatim — cast only to satisfy Prisma's typing. */
type Json = Prisma.InputJsonValue;

export function toBoardSummaryDto(b: {
  id: string;
  name: string;
  updatedAt: Date;
}): BoardSummaryDto {
  return { id: b.id, name: b.name, updatedAt: b.updatedAt.toISOString() };
}

export function toBoardDto(b: Board): BoardDto {
  return {
    id: b.id,
    name: b.name,
    // Returned exactly as stored — no transformation.
    elements: b.elements as unknown as unknown[],
    appState: b.appState as unknown as Record<string, unknown>,
    files: (b.files ?? {}) as unknown as Record<string, unknown>,
    updatedAt: b.updatedAt.toISOString(),
  };
}

/** List a workspace's boards WITHOUT the scene JSON — keeps the list fast. */
export function listBoards(
  db: PrismaClient,
  workspaceId: string,
): Promise<BoardSummaryDto[]> {
  return db.board
    .findMany({
      where: { workspaceId },
      select: { id: true, name: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    })
    .then((rows) => rows.map(toBoardSummaryDto));
}

/** Fetch a full board (scene included), scoped to the workspace. */
export async function getBoard(
  db: PrismaClient,
  workspaceId: string,
  boardId: string,
): Promise<Board> {
  const board = await db.board.findFirst({ where: { id: boardId, workspaceId } });
  if (!board) throw boardNotFound();
  return board;
}

/** Create an empty board in the workspace. */
export function createBoard(
  db: PrismaClient,
  workspaceId: string,
  name: string,
): Promise<Board> {
  return db.board.create({
    data: { workspaceId, name, elements: [], appState: {}, files: {} },
  });
}

export async function renameBoard(
  db: PrismaClient,
  workspaceId: string,
  boardId: string,
  name: string,
): Promise<BoardSummaryDto> {
  const result = await db.board.updateMany({ where: { id: boardId, workspaceId }, data: { name } });
  if (result.count === 0) throw boardNotFound();
  const board = await db.board.findFirstOrThrow({
    where: { id: boardId, workspaceId },
    select: { id: true, name: true, updatedAt: true },
  });
  return toBoardSummaryDto(board);
}

/**
 * Persist the Excalidraw scene verbatim. Stored as received — no normalisation
 * or field-picking. Scoped to the workspace; 404 if the board is gone (e.g. it
 * was deleted while a save was in flight).
 */
export async function saveScene(
  db: PrismaClient,
  workspaceId: string,
  boardId: string,
  elements: unknown[],
  appState: Record<string, unknown>,
  files: Record<string, unknown> = {},
): Promise<BoardSummaryDto> {
  const result = await db.board.updateMany({
    where: { id: boardId, workspaceId },
    data: { elements: elements as Json, appState: appState as Json, files: files as Json },
  });
  if (result.count === 0) throw boardNotFound();
  const board = await db.board.findFirstOrThrow({
    where: { id: boardId, workspaceId },
    select: { id: true, name: true, updatedAt: true },
  });
  return toBoardSummaryDto(board);
}

/**
 * Delete a board. Per the product's delete rules this must NOT delete tasks:
 * the schema nulls Task.sourceBoardId (onDelete: SetNull); here we also null the
 * non-FK sourceElementId so no dangling element reference remains. One
 * transaction. This lib knows nothing about the board->tasks bridge otherwise.
 */
export async function deleteBoard(
  db: PrismaClient,
  workspaceId: string,
  boardId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const board = await tx.board.findFirst({ where: { id: boardId, workspaceId } });
    if (!board) throw boardNotFound();
    await tx.task.updateMany({
      where: { sourceBoardId: boardId },
      data: { sourceElementId: null },
    });
    await tx.board.delete({ where: { id: boardId } });
  });
}
