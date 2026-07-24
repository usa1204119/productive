import type { PrismaClient } from "@prisma/client";
import { AppError } from "../errors.js";
import { decrypt, encrypt } from "./crypto.js";
import {
  createDriveAuthClient,
  DRIVE_FILE_SCOPE,
  type DriveTokens,
} from "./google.js";
import { isInvalidGrant, makeGoogleDriveClient, type DriveClient } from "./driveClient.js";

/**
 * Store (or refresh) a user's Drive connection. Idempotent: one row per user
 * (userId is unique), so reconnecting updates in place — never a duplicate.
 * The refresh token is encrypted at rest with AES-256-GCM.
 */
export async function connectDrive(
  db: PrismaClient,
  userId: string,
  tokens: DriveTokens,
): Promise<void> {
  if (tokens.scope !== DRIVE_FILE_SCOPE) {
    throw new AppError(400, "DRIVE_ERROR", "Invalid Google Drive scope");
  }
  const encryptedRefreshToken = encrypt(tokens.refreshToken);
  const scopes = [DRIVE_FILE_SCOPE];
  await db.$transaction([
    db.googleCredential.upsert({
      where: { userId },
      create: { userId, encryptedRefreshToken, scopes, revokedAt: null },
      update: { encryptedRefreshToken, scopes, connectedAt: new Date(), revokedAt: null },
    }),
    db.user.update({ where: { id: userId }, data: { driveConnected: true } }),
  ]);
}

/** The user's active (non-revoked) credential, or null. */
export async function loadActiveCredential(db: PrismaClient, userId: string) {
  const cred = await db.googleCredential.findUnique({ where: { userId } });
  if (!cred || cred.revokedAt) return null;
  return cred;
}

/**
 * Mark the Drive connection revoked (e.g. Google returned invalid_grant). Puts
 * the user into the "Reconnect Google Drive" state instead of crashing.
 */
export async function markDisconnected(db: PrismaClient, userId: string): Promise<void> {
  await db.$transaction([
    db.googleCredential.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    db.user.update({ where: { id: userId }, data: { driveConnected: false } }),
  ]);
}

/** User-initiated disconnect. */
export async function disconnectDrive(db: PrismaClient, userId: string): Promise<void> {
  const credential = await db.googleCredential.findUnique({ where: { userId } });
  if (credential) {
    const refreshToken = decrypt(credential.encryptedRefreshToken);
    try {
      await createDriveAuthClient(refreshToken).revokeToken(refreshToken);
    } catch (err) {
      // An already-invalid token is effectively revoked. Other failures are
      // surfaced so we do not claim a successful Google-side disconnect.
      if (!isInvalidGrant(err)) {
        throw new AppError(502, "DRIVE_ERROR", "Could not disconnect Google Drive");
      }
    }
  }

  await db.$transaction([
    db.googleCredential.deleteMany({ where: { userId } }),
    db.user.update({ where: { id: userId }, data: { driveConnected: false } }),
  ]);
}

/** Build a Drive client from the user's stored (decrypted) refresh token. */
export async function getUserDriveClient(db: PrismaClient, userId: string): Promise<DriveClient> {
  const cred = await loadActiveCredential(db, userId);
  if (!cred) throw new AppError(409, "DRIVE_NOT_CONNECTED", "Google Drive is not connected");
  let refreshToken: string;
  try {
    refreshToken = decrypt(cred.encryptedRefreshToken);
  } catch {
    await markDisconnected(db, userId);
    throw new AppError(409, "DRIVE_DISCONNECTED", "Reconnect Google Drive to continue");
  }
  const auth = createDriveAuthClient(refreshToken);
  return makeGoogleDriveClient(auth);
}

/**
 * Run Drive work with uniform failure handling: a revoked token disconnects the
 * user and surfaces a reconnect state; anything else becomes an opaque
 * DRIVE_ERROR. Never leaks a raw Google error or a 500. The `drive` client is
 * injected so tests can drive the revoked-token path with a fake.
 */
export async function withDriveErrors<T>(
  db: PrismaClient,
  userId: string,
  drive: DriveClient,
  fn: (drive: DriveClient) => Promise<T>,
): Promise<T> {
  try {
    return await fn(drive);
  } catch (err) {
    if (isInvalidGrant(err)) {
      await markDisconnected(db, userId);
      throw new AppError(
        409,
        "DRIVE_DISCONNECTED",
        "Google Drive access was revoked. Reconnect to continue.",
      );
    }
    if (err instanceof AppError) throw err;
    throw new AppError(502, "DRIVE_ERROR", "Google Drive request failed");
  }
}
