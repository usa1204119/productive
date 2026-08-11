import type { DriveAclSyncJob, PrismaClient, WorkspaceRole } from "@prisma/client";
import { prisma } from "../../db.js";
import { logger } from "../../logger.js";
import { getUserDriveClient } from "../driveCredentials.js";
import type { DriveClient } from "../driveClient.js";

const INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 8;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

const driveRole = (role: WorkspaceRole): "reader" | "writer" =>
  role === "VIEWER" ? "reader" : "writer";

function supportsAcl(drive: DriveClient): drive is DriveClient & Required<Pick<
  DriveClient,
  "findPermission" | "createPermission" | "updatePermission" | "deletePermission"
>> {
  return Boolean(
    drive.findPermission &&
      drive.createPermission &&
      drive.updatePermission &&
      drive.deletePermission,
  );
}

async function markFailed(db: PrismaClient, job: DriveAclSyncJob, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Drive ACL synchronization failed";
  const attempts = job.attempts + 1;
  const nextAttemptAt = new Date(Date.now() + Math.min(60_000 * 2 ** attempts, 24 * 60 * 60_000));
  await db.$transaction([
    db.driveAclSyncJob.update({
      where: { id: job.id },
      data: { status: "FAILED", attempts, nextAttemptAt, lastError: message },
    }),
    ...(job.memberId
      ? [db.workspaceMember.updateMany({
          where: { id: job.memberId },
          data: { aclSyncStatus: "FAILED", aclSyncError: "Drive access sync is pending retry" },
        })]
      : []),
  ]);
}

export async function processDriveAclJob(db: PrismaClient, job: DriveAclSyncJob): Promise<void> {
  const context = await db.workspace.findUnique({
    where: { id: job.workspaceId },
    select: { userId: true, driveFolderId: true },
  });
  if (!context?.driveFolderId) {
    await db.driveAclSyncJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED" } });
    return;
  }
  const drive = await getUserDriveClient(db, context.userId);
  if (!supportsAcl(drive)) throw new Error("Drive adapter does not support ACL operations");

  let permissionId = job.permissionId;
  if (job.action === "REVOKE") {
    permissionId ??= await drive.findPermission(context.driveFolderId, job.emailNormalized);
    if (permissionId) await drive.deletePermission(context.driveFolderId, permissionId);
  } else {
    if (!job.desiredRole) throw new Error("ACL job is missing a desired role");
    permissionId ??= await drive.findPermission(context.driveFolderId, job.emailNormalized);
    if (permissionId) {
      await drive.updatePermission(context.driveFolderId, permissionId, driveRole(job.desiredRole));
    } else {
      permissionId = await drive.createPermission(
        context.driveFolderId,
        job.emailNormalized,
        driveRole(job.desiredRole),
      );
    }
  }

  await db.$transaction([
    db.driveAclSyncJob.update({
      where: { id: job.id },
      data: { status: "SUCCEEDED", permissionId, lastError: null },
    }),
    ...(job.memberId
      ? [db.workspaceMember.updateMany({
          where: { id: job.memberId },
          data: {
            drivePermissionId: job.action === "REVOKE" ? null : permissionId,
            aclSyncStatus: "SUCCEEDED",
            aclSyncError: null,
          },
        })]
      : []),
  ]);
}

export async function runDriveAclWorkerOnce(db: PrismaClient = prisma): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const jobs = await db.driveAclSyncJob.findMany({
      where: {
        status: { in: ["PENDING", "FAILED"] },
        nextAttemptAt: { lte: now },
        attempts: { lt: MAX_ATTEMPTS },
      },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
    for (const job of jobs) {
      const claimed = await db.driveAclSyncJob.updateMany({
        where: { id: job.id, status: { in: ["PENDING", "FAILED"] } },
        data: { status: "PROCESSING" },
      });
      if (!claimed.count) continue;
      try {
        await processDriveAclJob(db, job);
      } catch (error) {
        logger.warn({ err: error, jobId: job.id, workspaceId: job.workspaceId }, "Drive ACL job failed");
        await markFailed(db, job, error);
      }
    }
  } finally {
    running = false;
  }
}

export function startDriveAclWorker(): void {
  void runDriveAclWorkerOnce();
  timer = setInterval(() => void runDriveAclWorkerOnce(), INTERVAL_MS);
  timer.unref();
}

export function stopDriveAclWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
