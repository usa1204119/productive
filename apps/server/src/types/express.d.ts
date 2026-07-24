import type { User } from "@prisma/client";

// Attach the authenticated user to the request after requireAuth runs.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export {};
