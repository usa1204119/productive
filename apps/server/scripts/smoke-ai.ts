/**
 * HTTP smoke for the "Ask AI" chat route. Drives the REAL Express app with the
 * network-free FakeAiProvider (NODE_ENV=test), so it never calls Groq. Verifies
 * streaming, access control, guest/disabled guards, validation, and rate limits.
 *
 * Run: npm run smoke:ai --workspace apps/server
 */
import type { AddressInfo } from "node:net";

process.env.NODE_ENV ||= "test";
process.env.USE_PGLITE = "true";
process.env.SKIP_SERVER_START = "true";
process.env.AI_CHAT_ENABLED = "true";
process.env.SERVER_URL ||= "http://localhost:4000";
process.env.WEB_URL ||= "http://localhost:4000";
process.env.DATABASE_URL ||= "postgresql://smoke:smoke@localhost:5432/smoke";
process.env.GOOGLE_CLIENT_ID ||= "smoke-client-id";
process.env.GOOGLE_CLIENT_SECRET ||= "smoke-secret";
process.env.GOOGLE_OAUTH_REDIRECT_URI ||= "http://localhost:4000/auth/google/callback";
process.env.GOOGLE_DRIVE_REDIRECT_URI ||= "http://localhost:4000/auth/google/drive/callback";
process.env.ENCRYPTION_KEY ||= "0".repeat(64);

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

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function main(): Promise<void> {
  const dbmod = await import("../src/db.js");
  await dbmod.initDb();
  const { app } = await import("../src/index.js");
  const { createGoogleUser, createGuestUser } = await import("../src/lib/users.js");
  const { createWorkspace } = await import("../src/lib/workspaces.js");
  const { createSession } = await import("../src/lib/session.js");
  const prisma = dbmod.prisma;

  const google = (email: string, name: string) =>
    createGoogleUser({ googleId: `g-${email}`, email, name, avatarUrl: null }, prisma);

  const owner = await google("owner@example.com", "Owner");
  const member = await google("member@example.com", "Member");
  const rateUser = await google("rate@example.com", "Rate");
  const stranger = await google("stranger@example.com", "Stranger");
  const guest = await createGuestUser(prisma);

  const ws = await createWorkspace(prisma, owner.id, "Team");
  await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: member.id, role: "EDITOR" } });
  await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: rateUser.id, role: "EDITOR" } });
  const guestWs = await createWorkspace(prisma, guest.id, "Guest space");

  const cookieFor = async (userId: string) => `pac_session=${(await createSession(userId)).token}`;
  const ownerCookie = await cookieFor(owner.id);
  const memberCookie = await cookieFor(member.id);
  const rateCookie = await cookieFor(rateUser.id);
  const strangerCookie = await cookieFor(stranger.id);
  const guestCookie = await cookieFor(guest.id);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const chat = async (
    workspaceId: string,
    cookie: string | undefined,
    body: unknown,
  ): Promise<{ status: number; type: string; text: string }> => {
    const res = await fetch(`${base}/workspaces/${workspaceId}/ai/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, type: res.headers.get("content-type") ?? "", text: await res.text() };
  };

  const ask = (content: string, imageDataUrl?: string) => ({
    messages: [{ role: "user", content }],
    ...(imageDataUrl ? { imageDataUrl } : {}),
  });

  try {
    console.log("\nStreaming a reply (fake provider, SSE):");
    const streamed = await chat(ws.id, memberCookie, ask("What is this?", PNG));
    check("member gets 200", streamed.status === 200);
    check("responds as an event stream", streamed.type.includes("text/event-stream"));
    check("streams delta events", streamed.text.includes("event: delta"));
    check("ends with a done event", streamed.text.includes("event: done"));
    check("image reached the provider (fake echoes it)", streamed.text.includes("in the image"));

    console.log("\nWorks without an image (text-only turn):");
    const textOnly = await chat(ws.id, memberCookie, ask("Summarize our plan"));
    check("text-only chat streams a reply", textOnly.status === 200 && textOnly.text.includes("event: done"));

    console.log("\nValidation:");
    check("empty messages is 400", (await chat(ws.id, memberCookie, { messages: [] })).status === 400);
    check(
      "non-image data URL is 400",
      (await chat(ws.id, memberCookie, ask("hi", "not-a-data-url"))).status === 400,
    );

    console.log("\nAccess control:");
    check("owner may ask (200)", (await chat(ws.id, ownerCookie, ask("hi"))).status === 200);
    check("stranger is 404", (await chat(ws.id, strangerCookie, ask("hi"))).status === 404);
    check("anonymous is 401", (await chat(ws.id, undefined, ask("hi"))).status === 401);
    check("guest (with own workspace) is 403", (await chat(guestWs.id, guestCookie, ask("hi"))).status === 403);

    console.log("\nRate limit (test cap = 5 per user):");
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await chat(ws.id, rateCookie, ask("ping"))).status;
    check("request past the per-user cap is 429", last === 429);
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
