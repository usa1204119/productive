/**
 * DB smoke test for Workspaces CRUD — runs the REAL scoped lib functions
 * (ownership, atomic limit, cascade) against in-process PGlite. No server/Docker.
 *
 * Run: npm run smoke:workspaces --workspace apps/server
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";
import { MAX_WORKSPACES_PER_USER } from "@plane-and-curves/shared";

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
  const {
    listWorkspaces,
    createWorkspace,
    getOwnedWorkspace,
    renameWorkspace,
    deleteWorkspace,
  } = await import("../src/lib/workspaces.js");

  const alice = await createGuestUser(prisma);
  const bob = await createGuestUser(prisma);

  console.log("\nCreate & list (scoped to the user):");
  const aliceStarter = (await listWorkspaces(prisma, alice.id))[0]!;
  const second = await createWorkspace(prisma, alice.id, "Second");
  const aliceList = await listWorkspaces(prisma, alice.id);
  check("create returns the new workspace", second.name === "Second");
  check("owner sees both workspaces", aliceList.length === 2);
  const bobList = await listWorkspaces(prisma, bob.id);
  check("list is scoped — bob sees only his own", bobList.length === 1 && bobList[0]!.userId === bob.id);

  console.log("\nOwnership guard (a single scoped query, no leak):");
  check("getOwnedWorkspace returns null for a non-owner", (await getOwnedWorkspace(prisma, bob.id, second.id)) === null);
  await expectCode("rename by non-owner", "WORKSPACE_NOT_FOUND", () =>
    renameWorkspace(prisma, bob.id, second.id, "hax"),
  );
  await expectCode("delete by non-owner", "WORKSPACE_NOT_FOUND", () =>
    deleteWorkspace(prisma, bob.id, second.id),
  );
  const stillThere = await getOwnedWorkspace(prisma, alice.id, second.id);
  check("workspace untouched after failed non-owner ops", stillThere?.name === "Second");

  console.log("\nRename by owner:");
  const renamed = await renameWorkspace(prisma, alice.id, second.id, "Renamed");
  check("owner rename succeeds", renamed.name === "Renamed");

  console.log("\nDelete cascade (records only — never Drive):");
  const board = await prisma.board.create({
    data: { workspaceId: second.id, name: "b", elements: [], appState: {} },
  });
  const task = await prisma.task.create({
    data: { workspaceId: second.id, title: "t", order: 1000 },
  });
  await deleteWorkspace(prisma, alice.id, second.id);
  check("workspace deleted", (await getOwnedWorkspace(prisma, alice.id, second.id)) === null);
  check("board cascade-deleted", (await prisma.board.findUnique({ where: { id: board.id } })) === null);
  check("task cascade-deleted", (await prisma.task.findUnique({ where: { id: task.id } })) === null);
  check("owner's other workspace survives", (await getOwnedWorkspace(prisma, alice.id, aliceStarter.id)) !== null);
  check("owner still exists", (await prisma.user.findUnique({ where: { id: alice.id } })) !== null);

  console.log(`\nAtomic per-user limit (${MAX_WORKSPACES_PER_USER}):`);
  let count = (await listWorkspaces(prisma, alice.id)).length;
  while (count < MAX_WORKSPACES_PER_USER) {
    await createWorkspace(prisma, alice.id, `w${count}`);
    count++;
  }
  check(`owner has exactly ${MAX_WORKSPACES_PER_USER}`, (await listWorkspaces(prisma, alice.id)).length === MAX_WORKSPACES_PER_USER);
  await expectCode("creating beyond the limit", "WORKSPACE_LIMIT_REACHED", () =>
    createWorkspace(prisma, alice.id, "one too many"),
  );
  check("count stays at the cap after rejection", (await listWorkspaces(prisma, alice.id)).length === MAX_WORKSPACES_PER_USER);
  check("the limit is per-user — bob is unaffected", (await listWorkspaces(prisma, bob.id)).length === 1);

  await prisma.$disconnect();
  await db.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
