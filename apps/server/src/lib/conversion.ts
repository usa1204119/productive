import type { PrismaClient, User } from "@prisma/client";
import { AppError, unauthenticated } from "../errors.js";
import type { GoogleIdentity } from "./google.js";

/**
 * Guest -> Google conversion (the main funnel), as ONE transaction so a partial
 * failure can never split a user's work across two identities:
 *   load the guest -> ensure it IS a guest -> ensure the Google account isn't
 *   linked elsewhere -> update the SAME user row in place -> commit.
 *
 * Because we update the same row, the guest's existing workspaces, boards and
 * tasks stay attached. Shared by the OAuth route and the DB smoke test.
 *
 * (No GoogleCredential row is created here — that represents a Drive connection
 * and is created only during incremental drive.file authorization.)
 */
export async function convertGuestToGoogle(
  db: PrismaClient,
  userId: string,
  identity: GoogleIdentity,
): Promise<User> {
  return db.$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id: userId } });
    if (!current) throw unauthenticated();
    if (!current.isGuest) {
      throw new AppError(409, "ALREADY_SIGNED_IN", "Account is already linked to Google");
    }

    const clash = await tx.user.findFirst({
      where: {
        id: { not: userId },
        OR: [{ googleId: identity.googleId }, { email: identity.email }],
      },
    });
    if (clash) {
      throw new AppError(
        409,
        "GOOGLE_ACCOUNT_ALREADY_LINKED",
        "This Google account is already connected to another user",
      );
    }

    return tx.user.update({
      where: { id: userId },
      data: {
        googleId: identity.googleId,
        email: identity.email,
        name: identity.name,
        avatarUrl: identity.avatarUrl,
        isGuest: false,
      },
    });
  });
}
