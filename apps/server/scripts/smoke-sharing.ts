/**
 * DB smoke test for Workspace Sharing (RBAC + invitations) — real lib functions
 * vs in-process PGlite + the in-memory mailbox. Verifies the whole invite ->
 * accept -> authorization -> role-change -> remove lifecycle and its guards.
 *
 * Run: npm run smoke:sharing --workspace apps/server
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";

// Sharing services call sharingRequired() -> env.SHARING_ENABLED must be true.
// NODE_ENV=test keeps the prod "requires resend" refinement from firing.
process.env.NODE_ENV ||= "test";
process.env.SHARING_ENABLED ||= "true";
process.env.MAIL_PROVIDER ||= "memory";
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

  const { createGuestUser, createGoogleUser } = await import("../src/lib/users.js");
  const { createWorkspace } = await import("../src/lib/workspaces.js");
  const { getWorkspaceAccess } = await import("../src/authorization/workspaceAccess.js");
  const inv = await import("../src/lib/invitations/service.js");
  const mem = await import("../src/lib/memberships/service.js");
  const { MemoryMailProvider, memoryMailbox } = await import("../src/lib/mail/memory.js");
  const mail = new MemoryMailProvider();

  const google = (email: string, name: string) =>
    createGoogleUser({ googleId: `g-${email}`, email, name, avatarUrl: null }, prisma);

  const owner = await google("owner@example.com", "Owner");
  const alice = await google("alice@example.com", "Alice");
  const bob = await google("bob@example.com", "Bob");
  const guest = await createGuestUser(prisma);
  const ws = await createWorkspace(prisma, owner.id, "Team");

  const lastToken = (): string => {
    const all = memoryMailbox.all();
    return all[all.length - 1]!.inviteUrl.split("/invite/")[1]!;
  };

  console.log("\nInvite + email delivery:");
  memoryMailbox.clear();
  const invitation = await inv.createInvitation(prisma, mail, ws.id, owner, "alice@example.com", "EDITOR");
  check("invitation created for the invitee (masked email)", invitation.role === "EDITOR");
  check("exactly one email was sent", memoryMailbox.all().length === 1);
  check("email targets the invitee", memoryMailbox.all()[0]!.to === "alice@example.com");
  check("token is not stored in plaintext", (await prisma.workspaceInvitation.findFirst())!.tokenHash !== lastToken());
  const pending = await inv.listPendingInvitations(prisma, ws.id);
  check("shows one pending invitation", pending.length === 1);

  console.log("\nAccess before acceptance:");
  check("owner has OWNER access", (await getWorkspaceAccess(prisma, owner.id, ws.id))?.role === "OWNER");
  check("invitee has no access yet", (await getWorkspaceAccess(prisma, alice.id, ws.id)) === null);
  check("stranger has no access", (await getWorkspaceAccess(prisma, bob.id, ws.id)) === null);

  console.log("\nInvite guards:");
  await expectCode("guest cannot invite", "GUEST_FORBIDDEN", () =>
    inv.createInvitation(prisma, mail, ws.id, guest, "x@example.com", "VIEWER"),
  );
  await expectCode("cannot invite yourself", "MEMBER_ALREADY_EXISTS", () =>
    inv.createInvitation(prisma, mail, ws.id, owner, "owner@example.com", "VIEWER"),
  );

  console.log("\nAccept guards:");
  const token = lastToken();
  await expectCode("guest cannot accept", "GUEST_FORBIDDEN", () => inv.acceptInvitation(prisma, token, guest));
  await expectCode("wrong account cannot accept", "INVITATION_EMAIL_MISMATCH", () =>
    inv.acceptInvitation(prisma, token, bob),
  );
  await expectCode("bad token is not found", "INVITATION_NOT_FOUND", () =>
    inv.acceptInvitation(prisma, "not-a-real-token", alice),
  );

  console.log("\nAccept (the happy path):");
  const accepted = await inv.acceptInvitation(prisma, token, alice);
  check("accept returns the workspace", accepted.workspaceId === ws.id);
  const access = await getWorkspaceAccess(prisma, alice.id, ws.id);
  check("invitee now has EDITOR access", access?.role === "EDITOR" && access?.isOwner === false);
  check("no pending invitations remain", (await inv.listPendingInvitations(prisma, ws.id)).length === 0);
  await expectCode("cannot accept twice", "INVITATION_ALREADY_USED", () => inv.acceptInvitation(prisma, token, alice));
  await expectCode("re-inviting an existing member fails", "MEMBER_ALREADY_EXISTS", () =>
    inv.createInvitation(prisma, mail, ws.id, owner, "alice@example.com", "VIEWER"),
  );

  console.log("\nExpired / revoked invitations:");
  memoryMailbox.clear();
  await inv.createInvitation(prisma, mail, ws.id, owner, "bob@example.com", "VIEWER");
  const bobToken = lastToken();
  await prisma.workspaceInvitation.updateMany({
    where: { emailNormalized: "bob@example.com", acceptedAt: null },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await expectCode("expired invitation is rejected", "INVITATION_EXPIRED", () =>
    inv.acceptInvitation(prisma, bobToken, bob),
  );
  memoryMailbox.clear();
  const revocable = await inv.createInvitation(prisma, mail, ws.id, owner, "carol@example.com", "VIEWER");
  const carolToken = lastToken();
  await inv.revokeInvitation(prisma, ws.id, revocable.id, owner.id);
  const carol = await google("carol@example.com", "Carol");
  await expectCode("revoked invitation is not found", "INVITATION_NOT_FOUND", () =>
    inv.acceptInvitation(prisma, carolToken, carol),
  );

  console.log("\nRole change + removal:");
  const members = await mem.listMembers(prisma, ws.id);
  const aliceMember = members.find((m) => m.userId === alice.id)!;
  await mem.updateMemberRole(prisma, ws.id, aliceMember.id, "VIEWER", owner.id);
  check("member downgraded to VIEWER", (await getWorkspaceAccess(prisma, alice.id, ws.id))?.role === "VIEWER");
  await mem.removeMember(prisma, ws.id, aliceMember.id, owner.id);
  check("removed member loses all access", (await getWorkspaceAccess(prisma, alice.id, ws.id)) === null);
  check("owner keeps access after churn", (await getWorkspaceAccess(prisma, owner.id, ws.id))?.role === "OWNER");

  console.log("\nDrive ACL jobs (only when the workspace has a Drive folder):");
  const driveWs = await createWorkspace(prisma, owner.id, "Drive team");
  await prisma.workspace.update({ where: { id: driveWs.id }, data: { driveFolderId: "folder-1" } });
  memoryMailbox.clear();
  await inv.createInvitation(prisma, mail, driveWs.id, owner, "dave@example.com", "EDITOR");
  const dave = await google("dave@example.com", "Dave");
  await inv.acceptInvitation(prisma, lastToken(), dave);
  const jobs = await prisma.driveAclSyncJob.findMany({ where: { workspaceId: driveWs.id } });
  check("accepting into a Drive workspace enqueues a GRANT job", jobs.length === 1 && jobs[0]!.action === "GRANT");
  const noDriveJobs = await prisma.driveAclSyncJob.findMany({ where: { workspaceId: ws.id } });
  check("non-Drive workspace enqueues no ACL jobs", noDriveJobs.length === 0);

  console.log("\nAudit trail:");
  const audit = await prisma.workspaceAuditLog.findMany({ where: { workspaceId: ws.id } });
  const actions = new Set(audit.map((a) => a.action));
  check(
    "audit log records the lifecycle",
    ["invitation.created", "invitation.accepted", "member.role.updated", "member.removed"].every((a) =>
      actions.has(a),
    ),
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
