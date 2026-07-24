/**
 * DB smoke test for Tasks — float ordering + rebalance, completion transitions,
 * delete-detaches-documents, and scoping. Real lib functions vs PGlite.
 *
 * Run: npm run smoke:tasks --workspace apps/server
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";
import { updateTaskSchema } from "@plane-and-curves/shared";

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
  const { createTask, updateTask, reorderTask, deleteTask, listTasks } =
    await import("../src/lib/tasks.js");

  const user = await createGuestUser(prisma);
  const ws = (await listWorkspaces(prisma, user.id))[0]!;
  const other = await createWorkspace(prisma, user.id, "Other");

  console.log("\nAppend order = max + 1000:");
  const a = await createTask(prisma, ws.id, "A");
  const b = await createTask(prisma, ws.id, "B");
  const c = await createTask(prisma, ws.id, "C");
  check("first task order 1000", a.order === 1000);
  check("second task order 2000", b.order === 2000);
  check("third task order 3000", c.order === 3000);

  console.log("\nCompletion is a transition (completedAt set once, cleared on reopen):");
  const done1 = await updateTask(prisma, ws.id, a.id, { completed: true });
  check("completing sets completedAt", done1.completed && done1.completedAt !== null);
  const stamp = done1.completedAt!.toISOString();
  const done2 = await updateTask(prisma, ws.id, a.id, { completed: true }); // no transition
  check("re-completing keeps the same completedAt", done2.completedAt?.toISOString() === stamp);
  const reopened = await updateTask(prisma, ws.id, a.id, { completed: false });
  check("reopening clears completedAt", !reopened.completed && reopened.completedAt === null);

  console.log("\nField edits (title/description/dueAt as UTC):");
  const due = "2026-08-01T09:30:00.000Z";
  const edited = await updateTask(prisma, ws.id, b.id, { title: "B2", description: "note", dueAt: due });
  check("title updated", edited.title === "B2");
  check("description updated", edited.description === "note");
  check("dueAt stored as the same UTC instant", edited.dueAt?.toISOString() === due);
  // Normalisation (blank -> null) is the validation layer's job; mirror the
  // route by parsing through the schema before the lib call.
  const cleared = await updateTask(
    prisma,
    ws.id,
    b.id,
    updateTaskSchema.parse({ dueAt: null, description: "  " }),
  );
  check("dueAt cleared", cleared.dueAt === null);
  check("blank description normalises to null (via schema)", cleared.description === null);

  console.log("\nReorder to top (prevId null):");
  const movedTop = await reorderTask(prisma, ws.id, c.id, null, a.id);
  check("dropped above the first task", movedTop.order < a.order);

  console.log("\nReorder between neighbours = average:");
  // Reset to clean 1000/2000/3000 by moving c back to the bottom, then place b between a and c.
  await reorderTask(prisma, ws.id, c.id, b.id, null);
  const between = await reorderTask(prisma, ws.id, a.id, b.id, c.id);
  const bOrder = (await listTasks(prisma, ws.id)).find((t) => t.id === b.id)!.order;
  const cOrder = (await listTasks(prisma, ws.id)).find((t) => t.id === c.id)!.order;
  check("placed strictly between the two neighbours", between.order > bOrder && between.order < cOrder);

  console.log("\nRebalance when the gap is below 0.0001:");
  const ws2 = await createWorkspace(prisma, user.id, "rebalance");
  const x = await createTask(prisma, ws2.id, "X");
  const y = await createTask(prisma, ws2.id, "Y");
  const z = await createTask(prisma, ws2.id, "Z");
  // Force X and Y to be adjacent with a sub-threshold gap.
  await prisma.task.update({ where: { id: x.id }, data: { order: 1000 } });
  await prisma.task.update({ where: { id: y.id }, data: { order: 1000.00005 } });
  await prisma.task.update({ where: { id: z.id }, data: { order: 3000 } });
  await reorderTask(prisma, ws2.id, z.id, x.id, y.id); // gap < MIN_GAP → rebalance then place
  const seq = await listTasks(prisma, ws2.id);
  const orders = seq.map((t) => t.order);
  const distinct = new Set(orders).size === orders.length;
  check("all orders distinct after rebalance", distinct);
  check("X and Y separated by a clean 1000 gap", seq[0]!.title === "X" && seq[0]!.order === 1000 && seq[2]!.title === "Y" && seq[2]!.order === 2000);
  check("Z placed between X and Y", seq[1]!.title === "Z" && seq[1]!.order > 1000 && seq[1]!.order < 2000);

  console.log("\nDelete detaches documents (does not delete them):");
  const withDoc = await createTask(prisma, ws.id, "has doc");
  const doc = await prisma.document.create({
    data: {
      workspaceId: ws.id,
      taskId: withDoc.id,
      driveFileId: "drive-1",
      name: "file.pdf",
      mimeType: "application/pdf",
      sizeBytes: 123,
      webViewLink: "https://drive.example/file",
      uploadedById: user.id,
    },
  });
  await deleteTask(prisma, ws.id, withDoc.id);
  const docAfter = await prisma.document.findUnique({ where: { id: doc.id } });
  check("document survives task deletion", docAfter !== null);
  check("document detached (taskId null)", docAfter?.taskId === null);

  console.log("\nScoping (other workspace is indistinguishable from missing):");
  await expectCode("update cross-workspace", "TASK_NOT_FOUND", () =>
    updateTask(prisma, other.id, b.id, { title: "hax" }),
  );
  await expectCode("reorder cross-workspace", "TASK_NOT_FOUND", () =>
    reorderTask(prisma, other.id, b.id, null, null),
  );
  await expectCode("delete cross-workspace", "TASK_NOT_FOUND", () =>
    deleteTask(prisma, other.id, b.id),
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
