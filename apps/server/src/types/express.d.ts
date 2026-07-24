import type { User, Workspace } from "@prisma/client";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // Set by requireAuth.
      user?: User;
      // Set by requireWorkspace (already ownership-verified).
      workspace?: Workspace;
    }
  }
}

export {};
