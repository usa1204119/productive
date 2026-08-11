import type { PrismaClient, WorkspaceRole } from "@prisma/client";
import type { AssignableWorkspaceRole, WorkspaceMemberDto } from "@plane-and-curves/shared";
import { AppError } from "../../errors.js";

export async function listMembers(
  db: PrismaClient,
  workspaceId: string,
): Promise<WorkspaceMemberDto[]> {
  const members = await db.workspaceMember.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
  });
  return members.map((member) => ({
    id: member.id,
    userId: member.userId,
    displayName: member.user.name,
    email: member.user.email,
    avatarUrl: member.user.avatarUrl,
    role: member.role,
    isOwner: member.role === "OWNER",
    joinedAt: member.joinedAt.toISOString(),
    aclSyncStatus: member.aclSyncStatus,
    aclSyncError: member.aclSyncError,
  }));
}

async function mutableMember(db: PrismaClient, workspaceId: string, memberId: string) {
  const member = await db.workspaceMember.findFirst({
    where: { id: memberId, workspaceId },
    include: { user: { select: { email: true } }, workspace: { select: { userId: true, driveFolderId: true } } },
  });
  if (!member) throw new AppError(404, "NOT_FOUND", "Member not found");
  if (member.role === "OWNER" || member.userId === member.workspace.userId) {
    throw new AppError(409, "CANNOT_MODIFY_OWNER", "The canonical owner cannot be changed");
  }
  return member;
}

export async function updateMemberRole(
  db: PrismaClient,
  workspaceId: string,
  memberId: string,
  role: AssignableWorkspaceRole,
  actorUserId: string,
): Promise<void> {
  const member = await mutableMember(db, workspaceId, memberId);
  await db.$transaction(async (tx) => {
    await tx.workspaceMember.update({
      where: { id: member.id },
      data: { role, aclSyncStatus: member.workspace.driveFolderId ? "PENDING" : null, aclSyncError: null },
    });
    if (member.workspace.driveFolderId && member.user.email) {
      await tx.driveAclSyncJob.create({
        data: {
          workspaceId,
          memberId,
          action: "UPDATE",
          emailNormalized: member.user.email.toLowerCase(),
          desiredRole: role as WorkspaceRole,
          permissionId: member.drivePermissionId,
        },
      });
    }
    await tx.workspaceAuditLog.create({
      data: { workspaceId, actorUserId, action: "member.role.updated", metadata: { memberId, role } },
    });
  });
}

export async function removeMember(
  db: PrismaClient,
  workspaceId: string,
  memberId: string,
  actorUserId: string,
): Promise<{ userId: string }> {
  const member = await mutableMember(db, workspaceId, memberId);
  await db.$transaction(async (tx) => {
    if (member.workspace.driveFolderId && member.user.email) {
      await tx.driveAclSyncJob.create({
        data: {
          workspaceId,
          action: "REVOKE",
          emailNormalized: member.user.email.toLowerCase(),
          permissionId: member.drivePermissionId,
        },
      });
    }
    await tx.workspaceMember.delete({ where: { id: member.id } });
    await tx.workspaceAuditLog.create({
      data: { workspaceId, actorUserId, action: "member.removed", metadata: { userId: member.userId } },
    });
  });
  return { userId: member.userId };
}
