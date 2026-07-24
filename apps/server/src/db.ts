import { PrismaClient } from "@prisma/client";
import { isProd } from "./env.js";

/**
 * Single PrismaClient for the process. In dev, reuse across tsx hot-reloads
 * so we don't exhaust database connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProd ? ["warn", "error"] : ["warn", "error"],
  });

if (!isProd) globalForPrisma.prisma = prisma;
