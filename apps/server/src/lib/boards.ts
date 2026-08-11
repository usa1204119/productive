import type { Board, Prisma, PrismaClient } from "@prisma/client";
import type { BoardDto, BoardSummaryDto } from "@plane-and-curves/shared";
import { AppError } from "../errors.js";

const boardNotFound = () => new AppError(404, "BOARD_NOT_FOUND", "Board not found");

/** JSON value stored/returned verbatim — cast only to satisfy Prisma's typing. */
type Json = Prisma.InputJsonValue;

const ORDER_STEP = 1000;
// If two neighbouring slides are closer than this, float precision is running out.
const MIN_GAP = 0.0001;
type Tx = Prisma.TransactionClient;

export function toBoardSummaryDto(b: {
  id: string;
  name: string;
  order: number;
  updatedAt: Date;
  revision: number;
}): BoardSummaryDto {
  return {
    id: b.id,
    name: b.name,
    order: b.order,
    updatedAt: b.updatedAt.toISOString(),
    revision: b.revision,
  };
}

export function toBoardDto(b: Board): BoardDto {
  return {
    id: b.id,
    name: b.name,
    // Returned exactly as stored — no transformation.
    elements: b.elements as unknown as unknown[],
    appState: b.appState as unknown as Record<string, unknown>,
    files: (b.files ?? {}) as unknown as Record<string, unknown>,
    order: b.order,
    updatedAt: b.updatedAt.toISOString(),
    revision: b.revision,
  };
}

/** List a workspace's slides (boards) in slide order, WITHOUT the scene JSON. */
export function listBoards(
  db: PrismaClient,
  workspaceId: string,
): Promise<BoardSummaryDto[]> {
  return db.board
    .findMany({
      where: { workspaceId },
      select: { id: true, name: true, order: true, updatedAt: true, revision: true },
      orderBy: [{ order: "asc" }, { updatedAt: "asc" }],
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

/** Create an empty slide, appended to the end of the deck (order = max + 1000). */
export async function createBoard(
  db: PrismaClient,
  workspaceId: string,
  name: string,
): Promise<Board> {
  const agg = await db.board.aggregate({ where: { workspaceId }, _max: { order: true } });
  const order = (agg._max.order ?? 0) + ORDER_STEP;
  return db.board.create({
    data: { workspaceId, name, order, elements: [], appState: {}, files: {} },
  });
}

/** Reorder a slide between two neighbours; rebalances if precision runs out. */
export async function reorderBoard(
  db: PrismaClient,
  workspaceId: string,
  boardId: string,
  prevId: string | null,
  nextId: string | null,
): Promise<BoardSummaryDto> {
  return db.$transaction(async (tx) => {
    const board = await tx.board.findFirst({ where: { id: boardId, workspaceId } });
    if (!board) throw boardNotFound();
    const order = await computePlacement(tx, workspaceId, prevId, nextId);
    const updated = await tx.board.update({
      where: { id: boardId },
      data: { order },
      select: { id: true, name: true, order: true, updatedAt: true, revision: true },
    });
    return toBoardSummaryDto(updated);
  });
}

async function readNeighbours(
  tx: Tx,
  workspaceId: string,
  prevId: string | null,
  nextId: string | null,
): Promise<[number | null, number | null]> {
  const prev = prevId
    ? await tx.board.findFirst({ where: { id: prevId, workspaceId }, select: { order: true } })
    : null;
  const next = nextId
    ? await tx.board.findFirst({ where: { id: nextId, workspaceId }, select: { order: true } })
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
  return ORDER_STEP; // only slide
}

/** Reassign every slide's order to clean multiples of 1000, preserving sequence. */
async function rebalance(tx: Tx, workspaceId: string): Promise<void> {
  const boards = await tx.board.findMany({
    where: { workspaceId },
    orderBy: [{ order: "asc" }, { updatedAt: "asc" }],
    select: { id: true },
  });
  let i = 1;
  for (const b of boards) {
    await tx.board.update({ where: { id: b.id }, data: { order: i * ORDER_STEP } });
    i += 1;
  }
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
    select: { id: true, name: true, order: true, updatedAt: true, revision: true },
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
  baseRevision = 0,
  force = false,
): Promise<BoardSummaryDto> {
  const result = await db.board.updateMany({
    where: { id: boardId, workspaceId, ...(force ? {} : { revision: baseRevision }) },
    data: {
      elements: elements as Json,
      appState: appState as Json,
      files: files as Json,
      revision: { increment: 1 },
    },
  });
  if (result.count === 0) {
    const exists = await db.board.count({ where: { id: boardId, workspaceId } });
    if (!exists) throw boardNotFound();
    throw new AppError(409, "BOARD_CONFLICT", "Another collaborator saved a newer board version");
  }
  const board = await db.board.findFirstOrThrow({
    where: { id: boardId, workspaceId },
    select: { id: true, name: true, order: true, updatedAt: true, revision: true },
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
