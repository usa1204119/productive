import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { createGoogleUser } from "../lib/users.js";
import { createSession, setSessionCookie, toUserDto } from "../lib/session.js";
import { memoryMailbox } from "../lib/mail/index.js";
import { ok } from "../lib/respond.js";
import { validateBody } from "../middleware/validate.js";
import { e2eRateLimit } from "../middleware/rateLimit.js";

if (process.env.NODE_ENV !== "test" || process.env.E2E_TEST_MODE !== "true") {
  throw new Error("The E2E helper module may only be imported in isolated test mode");
}

const loginSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(100).optional(),
});

export const e2eRouter = Router();

e2eRouter.post("/reset", async (_req, res, next) => {
  try {
    await prisma.user.deleteMany();
    memoryMailbox.clear();
    ok(res, { reset: true });
  } catch (error) {
    next(error);
  }
});

e2eRouter.post("/login", validateBody(loginSchema), async (req, res, next) => {
  try {
    const email = String(req.body.email).toLowerCase();
    const user =
      (await prisma.user.findUnique({ where: { email } })) ??
      (await createGoogleUser({
        googleId: `e2e:${email}`,
        email,
        name: req.body.name ?? email.split("@")[0] ?? "Test user",
        avatarUrl: null,
      }));
    const session = await createSession(user.id);
    setSessionCookie(res, session.token, session.expiresAt);
    ok(res, toUserDto(user));
  } catch (error) {
    next(error);
  }
});

e2eRouter.get("/mailbox", (_req, res) => {
  ok(
    res,
    memoryMailbox.all().map((message) => ({
      to: message.to,
      workspaceName: message.workspaceName,
      role: message.role,
      inviteUrl: message.inviteUrl,
    })),
  );
});

e2eRouter.get("/rate-limit", e2eRateLimit, (_req, res) => ok(res, { allowed: true }));
