/**
 * Expanded QA smoke — name validation (Zod), Unicode round-trip, and concurrent
 * deletion, against in-process PGlite. Complements the offline-autosave unit
 * test that lives in apps/web (Vitest).
 *
 * Run: npm run smoke:qa --workspace apps/server
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";
import { createBoardSchema, createWorkspaceSchema } from "@plane-and-curves/shared";

process.env.NODE_ENV ||= "test";
process.env.SERVER_URL ||= "http://localhost:4000";
process.env.WEB_URL ||= "http://localhost:5173";
process.env.DATABASE_URL ||= "postgresql://smoke:smoke@localhost:5432/smoke";
process.env.GOOGLE_CLIENT_ID ||= "smoke-client-id";
process.env.GOOGLE_CLIENT_SECRET ||= "smoke-secret";
process.env.GOOGLE_OAUTH_REDIRECT_URI ||= "http://localhost:4000/auth/google/callback";
process.env.GOOGLE_DRIVE_REDIRECT_URI ||= "http://localhost:4000/auth/google/drive/callback";
process.env.ENCRYPTION_KEY ||= "0".repeat(64);

const here = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

async function main(): Promise<void> {
  const db = new PGlite();
  const ddl = readFileSync(join(here, "..", "prisma", "smoke-schema.sql"), "utf8");
  await db.exec(ddl);
  const prisma = new PrismaClient({ adapter: new PrismaPGlite(db) });

  const { createGuestUser } = await import("../src/lib/users.js");
  const { listWorkspaces, createWorkspace, getOwnedWorkspace, deleteWorkspace } =
    await import("../src/lib/workspaces.js");
  const { createBoard, listBoards, getBoard, deleteBoard } = await import("../src/lib/boards.js");

  console.log("\nWorkspace/board name validation (Zod):");
  const okName = (n: string) => createWorkspaceSchema.safeParse({ name: n }).success;
  check("rejects empty name", !okName(""));
  check("rejects whitespace-only name", !okName("   "));
  check("rejects name over 100 chars", !okName("a".repeat(101)));
  check("accepts a 100-char name", okName("a".repeat(100)));
  check("trims surrounding whitespace", createWorkspaceSchema.parse({ name: "  Hi  " }).name === "Hi");
  check("board name schema rejects empty", !createBoardSchema.safeParse({ name: "" }).success);

  console.log("\nUnicode handling (stored and returned intact):");
  const alice = await createGuestUser(prisma);
  const uni = "café ☕ 日本語 🌍 مرحبا 👩‍💻 é"; // accents, CJK, emoji, RTL, ZWJ, combining
  const ws = await createWorkspace(prisma, alice.id, uni);
  const wsBack = await getOwnedWorkspace(prisma, alice.id, ws.id);
  check("workspace name preserved byte-for-byte", wsBack?.name === uni);
  const board = await createBoard(prisma, ws.id, uni);
  check("board name preserved byte-for-byte", (await listBoards(prisma, ws.id))[0]!.name === uni);
  const fullBoard = await getBoard(prisma, ws.id, board.id);
  check("board round-trips (fetched by id)", fullBoard.name === uni);

  console.log("\nConcurrent deletion (exactly one winner, no crash):");
  const doomed = await createWorkspace(prisma, alice.id, "doomed");
  const dupBoard = await createBoard(prisma, ws.id, "dupdel");

  const wsResults = await Promise.allSettled([
    deleteWorkspace(prisma, alice.id, doomed.id),
    deleteWorkspace(prisma, alice.id, doomed.id),
  ]);
  const wsWinners = wsResults.filter((r) => r.status === "fulfilled").length;
  const wsLoserCode = wsResults.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  check("workspace: exactly one delete succeeds", wsWinners === 1);
  check("workspace: loser gets WORKSPACE_NOT_FOUND", wsLoserCode?.reason?.code === "WORKSPACE_NOT_FOUND");
  check("workspace: actually gone", (await getOwnedWorkspace(prisma, alice.id, doomed.id)) === null);

  const boardResults = await Promise.allSettled([
    deleteBoard(prisma, ws.id, dupBoard.id),
    deleteBoard(prisma, ws.id, dupBoard.id),
  ]);
  const boardWinners = boardResults.filter((r) => r.status === "fulfilled").length;
  const boardLoserCode = boardResults.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  check("board: exactly one delete succeeds", boardWinners === 1);
  check("board: loser gets BOARD_NOT_FOUND", boardLoserCode?.reason?.code === "BOARD_NOT_FOUND");

  console.log("\nAccount integrity after churn:");
  check("owner still has workspaces", (await listWorkspaces(prisma, alice.id)).length >= 1);

  await prisma.$disconnect();
  await db.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
