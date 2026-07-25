/**
 * DB smoke test for the board -> tasks bridge (Step 7). Covers the processor
 * rules and the transactional creation of sourced tasks. Real lib vs PGlite.
 *
 * Run: npm run smoke:bridge --workspace apps/server
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";
import { MAX_TASK_TITLE_LENGTH } from "@plane-and-curves/shared";

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

const el = (id: string, type: string, text?: string | null) => ({ id, type, text: text ?? null });

async function main(): Promise<void> {
  const db = new PGlite();
  const ddl = readFileSync(join(here, "..", "prisma", "smoke-schema.sql"), "utf8");
  await db.exec(ddl);
  const prisma = new PrismaClient({ adapter: new PrismaPGlite(db) });

  const { getBoardSelectionProcessor, createTasksFromSelection } =
    await import("../src/lib/bridge/index.js");
  const { createGuestUser } = await import("../src/lib/users.js");
  const { listWorkspaces, createWorkspace } = await import("../src/lib/workspaces.js");
  const { createBoard, deleteBoard } = await import("../src/lib/boards.js");
  const { createTask, listTasks } = await import("../src/lib/tasks.js");

  const ctx = { boardId: "b", workspaceId: "w" };
  const proc = getBoardSelectionProcessor();

  console.log("\nProcessor rules (TextElementsToTasks):");
  {
    const r = await proc.process([el("1", "text", "Research")], ctx);
    check("single text -> 1 draft", r.drafts.length === 1 && r.drafts[0]!.title === "Research");
    check("draft carries sourceElementId", r.drafts[0]!.sourceElementId === "1");
  }
  {
    const r = await proc.process(
      [el("1", "text", "Research"), el("2", "rectangle", null), el("3", "arrow"), el("4", "text", "Write docs")],
      ctx,
    );
    check("mixed selection -> only text converted", r.drafts.length === 2);
    check("skipped counts non-text elements", r.skipped === 2);
    check("titles are the text values", r.drafts.map((d) => d.title).join(",") === "Research,Write docs");
  }
  {
    const r = await proc.process([el("1", "rectangle"), el("2", "ellipse")], ctx);
    check("no text -> 0 drafts", r.drafts.length === 0 && r.skipped === 2);
  }
  {
    const r = await proc.process(
      [el("1", "text", "🚀 launch"), el("2", "text", "日本語"), el("3", "text", "مرحبا")],
      ctx,
    );
    check("unicode titles preserved", r.drafts.map((d) => d.title).join("|") === "🚀 launch|日本語|مرحبا");
  }
  {
    const r = await proc.process([el("1", "text", "Line 1\nLine 2\n\tLine 3")], ctx);
    check("multiline flattened to a single line", r.drafts[0]!.title === "Line 1 Line 2 Line 3");
  }
  {
    const r = await proc.process([el("1", "text", "   \n  \t "), el("2", "text", "")], ctx);
    check("whitespace-only / empty are skipped", r.drafts.length === 0 && r.skipped === 2);
  }
  {
    const long = "x".repeat(MAX_TASK_TITLE_LENGTH + 50);
    const r = await proc.process([el("1", "text", long)], ctx);
    check("over-long title trimmed to the max", Array.from(r.drafts[0]!.title).length === MAX_TASK_TITLE_LENGTH);
    check("trimmed count reported", r.trimmed === 1);
  }
  {
    const emoji = "😀".repeat(MAX_TASK_TITLE_LENGTH + 10);
    const r = await proc.process([el("1", "text", emoji)], ctx);
    check("unicode trim never splits a surrogate pair", Array.from(r.drafts[0]!.title).every((c) => c === "😀"));
  }

  console.log("\nTransactional creation with back-links:");
  const user = await createGuestUser(prisma);
  const ws = (await listWorkspaces(prisma, user.id))[0]!;
  const other = await createWorkspace(prisma, user.id, "Other");
  const board = await createBoard(prisma, ws.id, "Plan");
  await createTask(prisma, ws.id, "pre-existing"); // order 1000

  const selection = [el("e1", "text", "Research"), el("e2", "rectangle"), el("e3", "text", "Ship")];
  const res = await createTasksFromSelection(prisma, ws.id, board.id, selection);
  check("created 2 tasks", res.created.length === 2);
  check("skipped 1 non-text", res.skipped === 1);
  check("each created task links the board", res.created.every((t) => t.sourceBoardId === board.id));
  check(
    "created tasks carry their element ids",
    res.created.map((t) => t.sourceElementId).join(",") === "e1,e3",
  );
  const afterFirst = await listTasks(prisma, ws.id);
  check("appended after existing task", afterFirst.length === 3 && afterFirst[0]!.title === "pre-existing");
  check("created tasks are ordered after the existing one", res.created.every((t) => t.order > 1000));

  console.log("\nDuplicate clicks create independent sets (no dedup):");
  const res2 = await createTasksFromSelection(prisma, ws.id, board.id, selection);
  check("second click creates another 2 tasks", res2.created.length === 2);
  const distinctIds = new Set([...res.created, ...res2.created].map((t) => t.id)).size === 4;
  check("the two sets are independent (distinct ids)", distinctIds);
  check("total sourced tasks is now 4", (await listTasks(prisma, ws.id)).filter((t) => t.sourceBoardId === board.id).length === 4);

  console.log("\nScoping & empty selection:");
  await expectCode("board from wrong workspace", "BOARD_NOT_FOUND", () =>
    createTasksFromSelection(prisma, other.id, board.id, selection),
  );
  const none = await createTasksFromSelection(prisma, ws.id, board.id, [el("x", "rectangle")]);
  check("all-non-text selection creates nothing", none.created.length === 0 && none.skipped === 1);

  console.log("\nDeleting the board clears back-links (icon disables, task survives):");
  const sourced = res.created[0]!;
  await deleteBoard(prisma, ws.id, board.id);
  const afterDelete = (await listTasks(prisma, ws.id)).find((t) => t.id === sourced.id)!;
  check("sourced task survives board deletion", afterDelete !== undefined);
  check("sourceBoardId cleared", afterDelete.sourceBoardId === null);
  check("sourceElementId cleared", afterDelete.sourceElementId === null);

  await prisma.$disconnect();
  await db.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
