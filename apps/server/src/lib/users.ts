import type { Prisma, PrismaClient, User } from "@prisma/client";
import { prisma } from "../db.js";

const STARTER_WORKSPACE_NAME = "My workspace";

/**
 * Create a user together with a starter workspace in one transaction, so a
 * brand-new account (guest or Google) can use Whiteboard and Tasks immediately.
 * The client is injectable so the DB smoke test can run against PGlite.
 */
async function createUserWithStarterWorkspace(
  db: PrismaClient,
  data: Prisma.UserCreateInput,
): Promise<User> {
  return db.$transaction(async (tx) => {
    const user = await tx.user.create({ data });
    await tx.workspace.create({
      data: { userId: user.id, name: STARTER_WORKSPACE_NAME },
    });
    return user;
  });
}

export function createGuestUser(db: PrismaClient = prisma): Promise<User> {
  return createUserWithStarterWorkspace(db, { name: "Guest", isGuest: true });
}

export function createGoogleUser(
  identity: { googleId: string; email: string; name: string; avatarUrl: string | null },
  db: PrismaClient = prisma,
): Promise<User> {
  return createUserWithStarterWorkspace(db, {
    googleId: identity.googleId,
    email: identity.email,
    name: identity.name,
    avatarUrl: identity.avatarUrl,
    isGuest: false,
  });
}
