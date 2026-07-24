/**
 * DB smoke test for Boards (Whiteboard persistence) — real lib functions vs
 * in-process PGlite. Proves scene JSON is stored transparently (unknown fields
 * preserved), list summaries omit the scene, scoping holds, and deleting a board
 * clears task back-links without deleting the tasks.
 *
 * Run: npm run smoke:boards --workspace apps/server
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";

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
async function expectCode(name: string, code: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check(`${name} (threw ${code})`, false);
  } catch (err) {
    const actual = (err as { code?: string }).code;
    check(`${name} (threw ${code})`, actual === code);
    if (actual !== code) console.error(`      got: ${actual ?? String(err)}`);
  }
}

async function main(): Promise<void> {
  const db = new PGlite();
  const ddl = readFileSync(join(here, "..", "prisma", "smoke-schema.sql"), "utf8");
  await db.exec(ddl);
  const prisma = new PrismaClient({ adapter: new PrismaPGlite(db) });

  const { createGuestUser } = await import("../src/lib/users.js");
  const { listWorkspaces, createWorkspace } = await import("../src/lib/workspaces.js");
  const { createBoard, listBoards, getBoard, renameBoard, saveScene, deleteBoard } =
    await import("../src/lib/boards.js");

  const alice = await createGuestUser(prisma);
  const ws = (await listWorkspaces(prisma, alice.id))[0]!;
  const otherWs = await createWorkspace(prisma, alice.id, "Other");

  console.log("\nCreate & list (summaries omit the scene):");
  const board = await createBoard(prisma, ws.id, "Plan A");
  check("create returns the new board name", board.name === "Plan A");
  const list = await listBoards(prisma, ws.id);
  check("board appears in list", list.length === 1 && list[0]!.id === board.id);
  const summaryKeys = Object.keys(list[0]!).sort().join(",");
  check("summary has only id,name,updatedAt", summaryKeys === "id,name,updatedAt");
  check("summary carries no scene JSON", !("elements" in list[0]!) && !("appState" in list[0]!));

  console.log("\nTransparent storage — scene round-trips with unknown fields intact:");
  const elements = [
    { id: "e1", type: "rectangle", x: 1, y: 2, futureField: "keep-me", nested: { deep: [1, 2, { a: true }] } },
    { id: "e2", type: "text", text: "héllo 🌍", boundElements: null },
  ];
  const appState = { viewBackgroundColor: "#ffffff", unknownAppField: 42, gridSize: null, zoom: { value: 1 } };
  await saveScene(prisma, ws.id, board.id, elements, appState);
  const full = await getBoard(prisma, ws.id, board.id);
  check(
    "elements returned exactly as stored",
    JSON.stringify(full.elements) === JSON.stringify(elements),
  );
  check(
    "appState returned exactly as stored",
    JSON.stringify(full.appState) === JSON.stringify(appState),
  );

  console.log("\nRename:");
  const renamed = await renameBoard(prisma, ws.id, board.id, "Plan B");
  check("rename succeeds", renamed.name === "Plan B");

  console.log("\nScoping (wrong workspace is indistinguishable from missing):");
  await expectCode("get from wrong workspace", "BOARD_NOT_FOUND", () =>
    getBoard(prisma, otherWs.id, board.id),
  );
  await expectCode("save to wrong workspace", "BOARD_NOT_FOUND", () =>
    saveScene(prisma, otherWs.id, board.id, [], {}),
  );
  await expectCode("delete from wrong workspace", "BOARD_NOT_FOUND", () =>
    deleteBoard(prisma, otherWs.id, board.id),
  );

  console.log("\nDelete clears task back-links but keeps the tasks:");
  const task = await prisma.task.create({
    data: {
      workspaceId: ws.id,
      title: "Do the thing",
      order: 1000,
      sourceBoardId: board.id,
      sourceElementId: "e1",
    },
  });
  await deleteBoard(prisma, ws.id, board.id);
  const taskAfter = await prisma.task.findUnique({ where: { id: task.id } });
  check("task still exists after board delete", taskAfter !== null);
  check("task keeps its title", taskAfter?.title === "Do the thing");
  check("sourceBoardId cleared", taskAfter?.sourceBoardId === null);
  check("sourceElementId cleared", taskAfter?.sourceElementId === null);
  check("board is gone from list", (await listBoards(prisma, ws.id)).length === 0);

  console.log("\nSave after delete (deleted while a save was in flight):");
  await expectCode("save to a deleted board", "BOARD_NOT_FOUND", () =>
    saveScene(prisma, ws.id, board.id, elements, appState),
  );

  await prisma.$disconnect();
  await db.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
