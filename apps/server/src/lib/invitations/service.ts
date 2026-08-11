import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient, type User, type WorkspaceRole } from "@prisma/client";
import type {
  AssignableWorkspaceRole,
  InvitationPreviewDto,
  WorkspaceInvitationDto,
} from "@plane-and-curves/shared";
import { env } from "../../env.js";
import { AppError } from "../../errors.js";
import type { MailProvider } from "../mail/types.js";

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
export const hashInvitationToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(2, local.length - visible.length))}@${domain}`;
}

function sharingRequired(): void {
  if (!env.SHARING_ENABLED) {
    throw new AppError(503, "SHARING_DISABLED", "Workspace sharing is not enabled");
  }
}

function toDto(invitation: {
  id: string;
  emailNormalized: string;
  role: WorkspaceRole;
  expiresAt: Date;
  createdAt: Date;
}): WorkspaceInvitationDto {
  return {
    id: invitation.id,
    emailMasked: maskEmail(invitation.emailNormalized),
    role: invitation.role as AssignableWorkspaceRole,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
    expired: invitation.expiresAt.getTime() <= Date.now(),
  };
}

export async function listPendingInvitations(
  db: PrismaClient,
  workspaceId: string,
): Promise<WorkspaceInvitationDto[]> {
  sharingRequired();
  const invitations = await db.workspaceInvitation.findMany({
    where: { workspaceId, acceptedAt: null, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return invitations.map(toDto);
}

async function deliver(
  mail: MailProvider,
  rawToken: string,
  invitation: {
    emailNormalized: string;
    role: WorkspaceRole;
    expiresAt: Date;
    workspace: { name: string };
    invitedBy: { name: string };
  },
): Promise<void> {
  await mail.sendWorkspaceInvitation({
    to: invitation.emailNormalized,
    role: invitation.role as AssignableWorkspaceRole,
    workspaceName: invitation.workspace.name,
    inviterName: invitation.invitedBy.name,
    inviteUrl: `${env.WEB_URL}/invite/${rawToken}`,
    expiresAt: invitation.expiresAt,
  });
}

export async function createInvitation(
  db: PrismaClient,
  mail: MailProvider,
  workspaceId: string,
  actor: User,
  email: string,
  role: AssignableWorkspaceRole,
): Promise<WorkspaceInvitationDto> {
  sharingRequired();
  if (actor.isGuest || !actor.email) {
    throw new AppError(403, "GUEST_FORBIDDEN", "Sign in with Google before inviting members");
  }
  const emailNormalized = normalizeEmail(email);
  if (normalizeEmail(actor.email) === emailNormalized) {
    throw new AppError(409, "MEMBER_ALREADY_EXISTS", "This person is already a workspace member");
  }

  const existingUser = await db.user.findUnique({ where: { email: emailNormalized } });
  if (
    existingUser &&
    (await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: existingUser.id } },
    }))
  ) {
    throw new AppError(409, "MEMBER_ALREADY_EXISTS", "This person is already a workspace member");
  }

  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env.INVITE_TTL_HOURS * 60 * 60 * 1000);
  let invitation;
  try {
    invitation = await db.workspaceInvitation.create({
      data: {
        workspaceId,
        emailNormalized,
        role,
        tokenHash: hashInvitationToken(rawToken),
        invitedById: actor.id,
        expiresAt,
      },
      include: { workspace: { select: { name: true } }, invitedBy: { select: { name: true } } },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(409, "VALIDATION_ERROR", "An active invitation already exists");
    }
    throw error;
  }

  try {
    await deliver(mail, rawToken, invitation);
  } catch (error) {
    await db.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date() },
    });
    throw error;
  }
  await db.workspaceAuditLog.create({
    data: { workspaceId, actorUserId: actor.id, action: "invitation.created", metadata: { role } },
  });
  return toDto(invitation);
}

export async function revokeInvitation(
  db: PrismaClient,
  workspaceId: string,
  invitationId: string,
  actorUserId: string,
): Promise<void> {
  sharingRequired();
  const result = await db.workspaceInvitation.updateMany({
    where: { id: invitationId, workspaceId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!result.count) throw new AppError(404, "INVITATION_NOT_FOUND", "Invitation not found");
  await db.workspaceAuditLog.create({
    data: { workspaceId, actorUserId, action: "invitation.revoked", metadata: { invitationId } },
  });
}

export async function resendInvitation(
  db: PrismaClient,
  mail: MailProvider,
  workspaceId: string,
  invitationId: string,
  actor: User,
): Promise<WorkspaceInvitationDto> {
  const old = await db.workspaceInvitation.findFirst({
    where: { id: invitationId, workspaceId, acceptedAt: null, revokedAt: null },
  });
  if (!old) throw new AppError(404, "INVITATION_NOT_FOUND", "Invitation not found");
  await revokeInvitation(db, workspaceId, invitationId, actor.id);
  return createInvitation(
    db,
    mail,
    workspaceId,
    actor,
    old.emailNormalized,
    old.role as AssignableWorkspaceRole,
  );
}

export async function previewInvitation(
  db: PrismaClient,
  token: string,
): Promise<InvitationPreviewDto> {
  sharingRequired();
  const invitation = await db.workspaceInvitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    include: { workspace: { select: { name: true } }, invitedBy: { select: { name: true } } },
  });
  if (!invitation || invitation.revokedAt) {
    throw new AppError(404, "INVITATION_NOT_FOUND", "Invitation not found");
  }
  if (invitation.acceptedAt) {
    throw new AppError(409, "INVITATION_ALREADY_USED", "Invitation has already been used");
  }
  return {
    workspaceName: invitation.workspace.name,
    inviterName: invitation.invitedBy.name,
    role: invitation.role as AssignableWorkspaceRole,
    emailMasked: maskEmail(invitation.emailNormalized),
    expiresAt: invitation.expiresAt.toISOString(),
    expired: invitation.expiresAt.getTime() <= Date.now(),
  };
}

export async function acceptInvitation(
  db: PrismaClient,
  token: string,
  user: User,
): Promise<{ workspaceId: string }> {
  sharingRequired();
  if (user.isGuest || !user.email) {
    throw new AppError(403, "GUEST_FORBIDDEN", "Sign in with Google to accept this invitation");
  }
  const tokenHash = hashInvitationToken(token);
  const invitation = await db.workspaceInvitation.findUnique({ where: { tokenHash } });
  if (!invitation || invitation.revokedAt) {
    throw new AppError(404, "INVITATION_NOT_FOUND", "Invitation not found");
  }
  if (invitation.acceptedAt) {
    throw new AppError(409, "INVITATION_ALREADY_USED", "Invitation has already been used");
  }
  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw new AppError(410, "INVITATION_EXPIRED", "Invitation has expired");
  }
  if (normalizeEmail(user.email) !== invitation.emailNormalized) {
    throw new AppError(403, "INVITATION_EMAIL_MISMATCH", "Sign in with the invited Google account");
  }

  return db.$transaction(
    async (tx) => {
      const claimed = await tx.workspaceInvitation.updateMany({
        where: {
          id: invitation.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { acceptedAt: new Date() },
      });
      if (!claimed.count) {
        throw new AppError(409, "INVITATION_ALREADY_USED", "Invitation is no longer available");
      }
      const member = await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id } },
        create: {
          workspaceId: invitation.workspaceId,
          userId: user.id,
          role: invitation.role,
          invitedById: invitation.invitedById,
          aclSyncStatus: "PENDING",
        },
        update: {},
      });
      const workspace = await tx.workspace.findUniqueOrThrow({
        where: { id: invitation.workspaceId },
        select: { driveFolderId: true },
      });
      if (workspace.driveFolderId) {
        await tx.driveAclSyncJob.create({
          data: {
            workspaceId: invitation.workspaceId,
            memberId: member.id,
            action: "GRANT",
            emailNormalized: invitation.emailNormalized,
            desiredRole: invitation.role,
          },
        });
      }
      await tx.workspaceAuditLog.create({
        data: {
          workspaceId: invitation.workspaceId,
          actorUserId: user.id,
          action: "invitation.accepted",
          metadata: { invitationId: invitation.id, role: invitation.role },
        },
      });
      return { workspaceId: invitation.workspaceId };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
