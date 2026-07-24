/**
 * DB smoke test for the auth flow — runs the REAL guest-create and
 * guest->Google conversion code paths against an in-process PGlite database
 * (Postgres compiled to WASM), so no server or Docker is needed.
 *
 * Run: npm run smoke:auth --workspace apps/server
 *
 * It proves the parts that typecheck/boot could not: the transactions execute,
 * a starter workspace is created, converted work stays attached to the same
 * user row, and the duplicate-link guard rolls the transaction back.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";

// Satisfy env validation BEFORE importing anything that reads process.env.
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
  // 1. Stand up an in-memory Postgres and load the schema.
  const db = new PGlite();
  const ddl = readFileSync(join(here, "..", "prisma", "smoke-schema.sql"), "utf8");
  await db.exec(ddl);

  const prisma = new PrismaClient({ adapter: new PrismaPGlite(db) });

  // Import the real modules only AFTER env is set (they pull env at load time).
  const { createGuestUser, createGoogleUser } = await import("../src/lib/users.js");
  const { convertGuestToGoogle } = await import("../src/lib/conversion.js");

  console.log("\nGuest login creates a usable account:");
  const guest = await createGuestUser(prisma);
  check("user is a guest", guest.isGuest === true);
  check("guest has no email", guest.email === null);
  const ws = await prisma.workspace.findFirst({ where: { userId: guest.id } });
  check("starter workspace exists", ws !== null);
  check("starter workspace named 'My workspace'", ws?.name === "My workspace");

  console.log("\nConversion carries the guest's work to the Google account:");
  // Simulate real work under the guest's workspace.
  const board = await prisma.board.create({
    data: { workspaceId: ws!.id, name: "Plan", elements: [], appState: {} },
  });
  const task = await prisma.task.create({
    data: { workspaceId: ws!.id, title: "Ship it", order: 1000 },
  });

  const alice = {
    googleId: "g-alice",
    email: "alice@example.com",
    name: "Alice",
    avatarUrl: null,
  };
  const converted = await convertGuestToGoogle(prisma, guest.id, alice);
  check("same user row (no identity split)", converted.id === guest.id);
  check("no longer a guest", converted.isGuest === false);
  check("googleId set", converted.googleId === "g-alice");
  check("email set", converted.email === "alice@example.com");

  const boardAfter = await prisma.board.findUnique({ where: { id: board.id } });
  const taskAfter = await prisma.task.findUnique({ where: { id: task.id } });
  check("board still attached to same workspace", boardAfter?.workspaceId === ws!.id);
  check("task still attached to same workspace", taskAfter?.workspaceId === ws!.id);
  const wsOwner = await prisma.workspace.findUnique({ where: { id: ws!.id } });
  check("workspace still owned by the same user", wsOwner?.userId === guest.id);
  const userCount = await prisma.user.count();
  check("exactly one user exists (no duplicate)", userCount === 1);

  console.log("\nDuplicate-link guard rolls the transaction back:");
  const guest2 = await createGuestUser(prisma);
  await createGoogleUser({ googleId: "g-bob", email: "bob@example.com", name: "Bob", avatarUrl: null }, prisma);
  await expectCode("linking an already-linked googleId", "GOOGLE_ACCOUNT_ALREADY_LINKED", () =>
    convertGuestToGoogle(prisma, guest2.id, {
      googleId: "g-bob",
      email: "bob@example.com",
      name: "Bob",
      avatarUrl: null,
    }),
  );
  const guest2After = await prisma.user.findUnique({ where: { id: guest2.id } });
  check("guest stays a guest after failed link", guest2After?.isGuest === true);
  check("guest keeps null googleId after failed link", guest2After?.googleId === null);

  console.log("\nOther guards:");
  await expectCode("linking a taken email", "GOOGLE_ACCOUNT_ALREADY_LINKED", () =>
    convertGuestToGoogle(prisma, guest2.id, {
      googleId: "g-fresh",
      email: "alice@example.com",
      name: "x",
      avatarUrl: null,
    }),
  );
  await expectCode("converting a non-guest", "ALREADY_SIGNED_IN", () =>
    convertGuestToGoogle(prisma, converted.id, {
      googleId: "g-x",
      email: "x@example.com",
      name: "x",
      avatarUrl: null,
    }),
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
