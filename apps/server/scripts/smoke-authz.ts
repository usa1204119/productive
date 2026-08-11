/**
 * HTTP-level authorization smoke: drives the REAL Express app (full middleware
 * chain + router mount order) over HTTP, which the lib-level smokes bypass.
 *
 * Guards the regression where membersRouter's router-level owner guard, mounted
 * on the broad "/workspaces/:workspaceId" prefix, 403'd non-owner members on
 * /boards, /tasks and /documents. A member MUST be able to GET those; only
 * /members and /invitations are owner-only.
 *
 * Run: npm run smoke:authz --workspace apps/server
 */
import type { AddressInfo } from "node:net";

process.env.NODE_ENV ||= "test";
process.env.USE_PGLITE = "true";
process.env.SKIP_SERVER_START = "true"; // import app.ts without starting its listener
process.env.SERVER_URL ||= "http://localhost:4000";
process.env.WEB_URL ||= "http://localhost:4000";
process.env.DATABASE_URL ||= "postgresql://smoke:smoke@localhost:5432/smoke";
process.env.GOOGLE_CLIENT_ID ||= "smoke-client-id";
process.env.GOOGLE_CLIENT_SECRET ||= "smoke-secret";
process.env.GOOGLE_OAUTH_REDIRECT_URI ||= "http://localhost:4000/auth/google/callback";
process.env.GOOGLE_DRIVE_REDIRECT_URI ||= "http://localhost:4000/auth/google/drive/callback";
process.env.ENCRYPTION_KEY ||= "0".repeat(64);
process.env.SHARING_ENABLED ||= "true";
process.env.MAIL_PROVIDER ||= "memory";

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
  // Importing db first lets initDb() swap the live `prisma` binding to PGlite
  // before the app handles any request.
  const dbmod = await import("../src/db.js");
  await dbmod.initDb(); // spins up PGlite and loads smoke-schema.sql

  const { app } = await import("../src/index.js");
  const { createGoogleUser } = await import("../src/lib/users.js");
  const { createWorkspace } = await import("../src/lib/workspaces.js");
  const { createBoard } = await import("../src/lib/boards.js");
  const { createSession } = await import("../src/lib/session.js");
  const prisma = dbmod.prisma;

  const owner = await createGoogleUser(
    { googleId: "g-owner", email: "owner@example.com", name: "Owner", avatarUrl: null },
    prisma,
  );
  const member = await createGoogleUser(
    { googleId: "g-member", email: "member@example.com", name: "Member", avatarUrl: null },
    prisma,
  );
  const stranger = await createGoogleUser(
    { googleId: "g-stranger", email: "stranger@example.com", name: "Stranger", avatarUrl: null },
    prisma,
  );

  const viewer = await createGoogleUser(
    { googleId: "g-viewer", email: "viewer@example.com", name: "Viewer", avatarUrl: null },
    prisma,
  );

  const ws = await createWorkspace(prisma, owner.id, "Team");
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: member.id, role: "EDITOR" },
  });
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: viewer.id, role: "VIEWER" },
  });
  const board = await createBoard(prisma, ws.id, "Slide 1");

  const cookieFor = async (userId: string): Promise<string> => {
    const { token } = await createSession(userId);
    return `pac_session=${token}`;
  };
  const ownerCookie = await cookieFor(owner.id);
  const memberCookie = await cookieFor(member.id);
  const viewerCookie = await cookieFor(viewer.id);
  const strangerCookie = await cookieFor(stranger.id);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  const get = async (path: string, cookie?: string) => {
    const res = await fetch(base + path, { headers: cookie ? { cookie } : {} });
    const body = (await res.json().catch(() => null)) as
      | { success: boolean; data?: unknown; error?: { code?: string } }
      | null;
    return { status: res.status, body };
  };
  const putScene = async (cookie: string) => {
    const res = await fetch(`${base}/workspaces/${ws.id}/boards/${board.id}/scene`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ baseRevision: 0, elements: [], appState: {}, files: {} }),
    });
    return { status: res.status };
  };

  try {
    console.log("\nMember can read the shared workspace's content:");
    const mb = await get(`/workspaces/${ws.id}/boards`, memberCookie);
    check("member GET /boards is 200 (not 403)", mb.status === 200);
    check(
      "member sees the owner's board",
      Array.isArray(mb.body?.data) && (mb.body!.data as unknown[]).some((b) => (b as { id: string }).id === board.id),
    );
    check("member GET /tasks is 200", (await get(`/workspaces/${ws.id}/tasks`, memberCookie)).status === 200);
    // Documents reach into the owner's Drive (not connected in this test), so the
    // meaningful check is that the member is NOT blocked by the owner-guard 403 —
    // i.e. the request reaches documentsRouter rather than dying in membersRouter.
    const md = await get(`/workspaces/${ws.id}/documents`, memberCookie);
    check(
      "member GET /documents is not the owner-guard 403 (reaches documents router)",
      !(md.status === 403 && md.body?.error?.code === "FORBIDDEN"),
    );

    console.log("\nEditors save their own edits; viewers read but cannot save:");
    check("member (EDITOR) PUT /scene is 200", (await putScene(memberCookie)).status === 200);
    check("viewer GET /boards is 200 (can read)", (await get(`/workspaces/${ws.id}/boards`, viewerCookie)).status === 200);
    check("viewer PUT /scene is 403 (cannot edit)", (await putScene(viewerCookie)).status === 403);

    console.log("\nOwner-only surfaces stay owner-only:");
    check("owner GET /members is 200", (await get(`/workspaces/${ws.id}/members`, ownerCookie)).status === 200);
    const mm = await get(`/workspaces/${ws.id}/members`, memberCookie);
    check("member GET /members is 403", mm.status === 403 && mm.body?.error?.code === "FORBIDDEN");

    console.log("\nOwner reads content; stranger and anon are denied:");
    check("owner GET /boards is 200", (await get(`/workspaces/${ws.id}/boards`, ownerCookie)).status === 200);
    check("stranger GET /boards is 404", (await get(`/workspaces/${ws.id}/boards`, strangerCookie)).status === 404);
    check("anonymous GET /boards is 401", (await get(`/workspaces/${ws.id}/boards`)).status === 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect().catch(() => undefined);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
