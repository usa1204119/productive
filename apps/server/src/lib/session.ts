import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import type { User } from "@prisma/client";
import type { UserDto } from "@plane-and-curves/shared";
import { env } from "../env.js";
import { prisma } from "../db.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * The cookie holds an opaque random token; the database stores only its
 * SHA-256 hash. A stolen database row therefore cannot be used as a session.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreatedSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

export async function createSession(userId: string): Promise<CreatedSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await prisma.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });
  return { sessionId: session.id, token, expiresAt };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.SESSION_COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(env.SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: env.SESSION_COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
  });
}

/** Resolve the current user from the session cookie, or null if none/expired. */
export async function getUserFromRequest(req: Request): Promise<User | null> {
  const token = (req.cookies as Record<string, string | undefined>)[env.SESSION_COOKIE_NAME];
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session.user;
}

export async function destroySession(req: Request): Promise<void> {
  const token = (req.cookies as Record<string, string | undefined>)[env.SESSION_COOKIE_NAME];
  if (!token) return;
  await prisma.session
    .deleteMany({ where: { tokenHash: hashToken(token) } })
    .catch(() => undefined);
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    isGuest: user.isGuest,
    driveConnected: user.driveConnected,
  };
}
