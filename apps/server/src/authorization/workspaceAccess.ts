import type { PrismaClient, Workspace, WorkspaceRole } from "@prisma/client";

export interface WorkspaceAccess {
  workspace: Workspace;
  role: WorkspaceRole;
  isOwner: boolean;
}

/**
 * One query performs lookup and authorization. The OR clause deliberately makes
 * a private workspace indistinguishable from a missing one to non-members.
 */
export async function getWorkspaceAccess(
  db: PrismaClient,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceAccess | null> {
  const workspace = await db.workspace.findFirst({
    where: {
      id: workspaceId,
      OR: [{ userId }, { members: { some: { userId } } }],
    },
    include: { members: { where: { userId }, take: 1 } },
  });
  if (!workspace) return null;

  const isOwner = workspace.userId === userId;
  const role: WorkspaceRole | undefined = isOwner ? "OWNER" : workspace.members[0]?.role;
  if (!role) return null;

  const { members: _members, ...workspaceRecord } = workspace;
  return { workspace: workspaceRecord, role, isOwner };
}
