import type { User, Workspace, WorkspaceRole } from "@prisma/client";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // Set by requireAuth.
      user?: User;
      // Set by membership-aware workspace authorization.
      workspace?: Workspace;
      workspaceAccess?: {
        role: WorkspaceRole;
        isOwner: boolean;
      };
      requestId?: string;
    }
  }
}

export {};
