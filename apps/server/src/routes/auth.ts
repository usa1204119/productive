import { Router } from "express";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { AppError } from "../errors.js";
import { logger } from "../logger.js";
import { requireAuth } from "../middleware/auth.js";
import { buildSignInUrl, exchangeSignInCode } from "../lib/google.js";
import { convertGuestToGoogle } from "../lib/conversion.js";
import { beginOAuth, consumeOAuth } from "../lib/oauthState.js";
import { ok } from "../lib/respond.js";
import { createGoogleUser, createGuestUser } from "../lib/users.js";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  getUserFromRequest,
  setSessionCookie,
  toUserDto,
} from "../lib/session.js";

export const authRouter = Router();

/** Issue a session cookie for a user. */
async function signIn(res: Parameters<typeof setSessionCookie>[0], userId: string): Promise<void> {
  const { token, expiresAt } = await createSession(userId);
  setSessionCookie(res, token, expiresAt);
}

/** Current user, or 401 if not signed in. */
authRouter.get("/me", requireAuth, (req, res) => {
  ok(res, toUserDto(req.user!));
});

/** Guest login: one click -> guest user (+ starter workspace) + session. */
authRouter.post("/guest", async (req, res, next) => {
  try {
    const existing = await getUserFromRequest(req);
    if (existing) throw new AppError(409, "ALREADY_SIGNED_IN", "Already signed in");

    const user = await createGuestUser();
    await signIn(res, user.id);
    ok(res, toUserDto(user), 201);
  } catch (err) {
    next(err);
  }
});

/** Start Google Sign-In (identity scopes only). */
authRouter.get("/google", (_req, res) => {
  const nonce = beginOAuth(res, "signin");
  res.redirect(buildSignInUrl(nonce));
});

/**
 * Start guest -> Google conversion. Must be an authenticated guest.
 * The consent screen is identical; only the callback intent differs.
 */
authRouter.get("/google/link", requireAuth, (req, res, next) => {
  try {
    if (!req.user!.isGuest) {
      throw new AppError(409, "ALREADY_SIGNED_IN", "Account is already linked to Google");
    }
    const nonce = beginOAuth(res, "link");
    res.redirect(buildSignInUrl(nonce));
  } catch (err) {
    next(err);
  }
});

/** Single OAuth callback for both sign-in and guest conversion. */
authRouter.get("/google/callback", async (req, res) => {
  const redirectOk = () => res.redirect(`${env.WEB_URL}/?auth=success`);
  const redirectErr = (code: string) =>
    res.redirect(`${env.WEB_URL}/?auth=error&code=${encodeURIComponent(code)}`);

  try {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (req.query.error) return redirectErr("OAUTH_DENIED");
    if (!code) return redirectErr("OAUTH_ERROR");

    const intent = consumeOAuth(req, res, state);
    const identity = await exchangeSignInCode(code);

    if (intent === "link") {
      await convertGuest(req, identity);
    } else {
      await signInWithGoogle(res, identity);
    }
    return redirectOk();
  } catch (err) {
    if (err instanceof AppError) {
      logger.warn({ code: err.code }, "OAuth callback failed");
      return redirectErr(err.code);
    }
    logger.error({ err }, "OAuth callback unexpected error");
    return redirectErr("OAUTH_ERROR");
  }
});

/** Find-or-create a real Google user, then issue a session. */
async function signInWithGoogle(
  res: Parameters<typeof setSessionCookie>[0],
  identity: Awaited<ReturnType<typeof exchangeSignInCode>>,
): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { googleId: identity.googleId } });
  const user = existing ?? (await createGoogleUser(identity));
  await signIn(res, user.id);
}

/**
 * Guest -> Google conversion (the main funnel). Delegates to the shared,
 * transactional convertGuestToGoogle so the exact same code path is covered by
 * the DB smoke test. The user's workspaces/boards/tasks stay attached because
 * the same user row is updated in place.
 */
async function convertGuest(
  req: Parameters<typeof getUserFromRequest>[0],
  identity: Awaited<ReturnType<typeof exchangeSignInCode>>,
): Promise<void> {
  await convertGuestToGoogle(prisma, req.user!.id, identity);
}

/** Log out: destroy the session and clear the cookie. */
authRouter.post("/logout", async (req, res, next) => {
  try {
    await destroySession(req);
    clearSessionCookie(res);
    ok(res, { loggedOut: true });
  } catch (err) {
    next(err);
  }
});
