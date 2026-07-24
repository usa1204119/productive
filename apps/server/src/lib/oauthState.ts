import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { env } from "../env.js";
import { AppError } from "../errors.js";

/**
 * Stateless CSRF protection for the OAuth redirect. We store a random nonce
 * (and the intent) in a short-lived httpOnly cookie and echo the nonce in the
 * `state` query param. On callback both must match.
 *
 * intent = "signin"  -> create/find a real user and sign in
 * intent = "link"    -> convert the currently-authenticated guest to Google
 * intent = "drive"   -> incremental Drive authorization for a signed-in user
 */
export type OAuthIntent = "signin" | "link" | "drive";

const STATE_COOKIE = "pac_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface StatePayload {
  nonce: string;
  intent: OAuthIntent;
}

export function beginOAuth(res: Response, intent: OAuthIntent): string {
  const nonce = randomBytes(16).toString("base64url");
  const payload: StatePayload = { nonce, intent };
  res.cookie(STATE_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: env.SESSION_COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: STATE_TTL_MS,
  });
  return nonce;
}

export function consumeOAuth(req: Request, res: Response, stateFromQuery: string): OAuthIntent {
  const raw = (req.cookies as Record<string, string | undefined>)[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: "/" });
  if (!raw) throw new AppError(400, "OAUTH_ERROR", "Missing OAuth state");

  let payload: StatePayload;
  try {
    payload = JSON.parse(raw) as StatePayload;
  } catch {
    throw new AppError(400, "OAUTH_ERROR", "Malformed OAuth state");
  }

  if (!payload.nonce || payload.nonce !== stateFromQuery) {
    throw new AppError(400, "OAUTH_ERROR", "OAuth state mismatch");
  }
  if (!["signin", "link", "drive"].includes(payload.intent)) {
    throw new AppError(400, "OAUTH_ERROR", "Invalid OAuth intent");
  }
  return payload.intent;
}
