import type { Prisma, User } from "@prisma/client";
import { prisma } from "../db.js";

const STARTER_WORKSPACE_NAME = "My workspace";

/**
 * Create a user together with a starter workspace in one transaction, so a
 * brand-new account (guest or Google) can use Whiteboard and Tasks immediately.
 */
async function createUserWithStarterWorkspace(
  data: Prisma.UserCreateInput,
): Promise<User> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data });
    await tx.workspace.create({
      data: { userId: user.id, name: STARTER_WORKSPACE_NAME },
    });
    return user;
  });
}

export function createGuestUser(): Promise<User> {
  return createUserWithStarterWorkspace({ name: "Guest", isGuest: true });
}

export function createGoogleUser(identity: {
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}): Promise<User> {
  return createUserWithStarterWorkspace({
    googleId: identity.googleId,
    email: identity.email,
    name: identity.name,
    avatarUrl: identity.avatarUrl,
    isGuest: false,
  });
}
