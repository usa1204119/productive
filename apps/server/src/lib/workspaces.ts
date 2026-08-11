import type { PrismaClient, Workspace, WorkspaceRole } from "@prisma/client";
import { MAX_WORKSPACES_PER_USER, type WorkspaceDto } from "@plane-and-curves/shared";
import { AppError, notFound } from "../errors.js";

const workspaceNotFound = () =>
  new AppError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");

export function toWorkspaceDto(ws: Workspace, currentRole: WorkspaceRole = "OWNER"): WorkspaceDto {
  return {
    id: ws.id,
    name: ws.name,
    driveFolderId: ws.driveFolderId,
    createdAt: ws.createdAt.toISOString(),
    updatedAt: ws.updatedAt.toISOString(),
    currentRole,
    isOwner: currentRole === "OWNER",
  };
}

/** List the user's workspaces, oldest first. Always scoped to the user. */
export async function listWorkspaces(
  db: PrismaClient,
  userId: string,
): Promise<Array<Workspace & { currentRole: WorkspaceRole }>> {
  const rows = await db.workspace.findMany({
    where: { OR: [{ userId }, { members: { some: { userId } } }] },
    include: { members: { where: { userId }, take: 1 } },
    orderBy: { createdAt: "asc" },
  });
  return rows.flatMap((row) => {
    const role = row.userId === userId ? "OWNER" : row.members[0]?.role;
    if (!role) return [];
    const { members: _members, ...workspace } = row;
    return [{ ...workspace, currentRole: role }];
  });
}

/**
 * Resolve a workspace the user owns, or null. A SINGLE scoped query does both
 * lookup and authorization — no findUnique-then-check-owner pattern.
 */
export function getOwnedWorkspace(
  db: PrismaClient,
  userId: string,
  workspaceId: string,
): Promise<Workspace | null> {
  return db.workspace.findFirst({ where: { id: workspaceId, userId } });
}

/**
 * Create a workspace, enforcing the per-user limit ATOMICALLY: a per-user
 * transaction advisory lock serializes concurrent creates for the same user,
 * so two requests can't both pass the count check and exceed the cap.
 */
export function createWorkspace(
  db: PrismaClient,
  userId: string,
  name: string,
): Promise<Workspace> {
  return db.$transaction(async (tx) => {
    // Serialize creates per user (auto-released at transaction end).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

    const count = await tx.workspace.count({ where: { userId } });
    if (count >= MAX_WORKSPACES_PER_USER) {
      throw new AppError(
        409,
        "WORKSPACE_LIMIT_REACHED",
        `You can have at most ${MAX_WORKSPACES_PER_USER} workspaces`,
      );
    }
    const workspace = await tx.workspace.create({ data: { userId, name } });
    await tx.workspaceMember.create({
      data: { workspaceId: workspace.id, userId, role: "OWNER" },
    });
    return workspace;
  });
}

/** Rename a workspace the user owns. Scoped update; 404 if not theirs. */
export async function renameWorkspace(
  db: PrismaClient,
  userId: string,
  workspaceId: string,
  name: string,
): Promise<Workspace> {
  const result = await db.workspace.updateMany({
    where: { id: workspaceId, userId },
    data: { name },
  });
  if (result.count === 0) throw workspaceNotFound();
  // Safe: ownership just confirmed by the scoped updateMany above.
  const ws = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws) throw notFound();
  return ws;
}

/**
 * Delete a workspace the user owns. Scoped delete; 404 if not theirs.
 * Cascades to Boards, Tasks and Document *records* (enforced in the schema);
 * it never deletes actual files or folders in the user's Google Drive.
 */
export async function deleteWorkspace(
  db: PrismaClient,
  userId: string,
  workspaceId: string,
): Promise<void> {
  const result = await db.workspace.deleteMany({ where: { id: workspaceId, userId } });
  if (result.count === 0) throw workspaceNotFound();
}
