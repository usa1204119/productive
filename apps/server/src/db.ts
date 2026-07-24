import { PrismaClient } from "@prisma/client";
import { isProd } from "./env.js";

/**
 * Single PrismaClient for the process. In dev, reuse across tsx hot-reloads
 * so we don't exhaust database connections.
 *
 * `prisma` is a live binding: in the opt-in PGlite demo mode (USE_PGLITE=true)
 * initDb() swaps it for an in-process PGlite-backed client so the whole app can
 * run with no external database. Callers read it inside request handlers (after
 * initDb has run at startup), so they see the swapped instance.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export let prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ log: ["warn", "error"] });

if (!isProd) globalForPrisma.prisma = prisma;

/**
 * Initialise the database connection. Call once at startup, before listening.
 * Normal mode: a no-op (Prisma connects lazily). Demo mode (USE_PGLITE=true):
 * spin up an in-memory PGlite (Postgres/WASM), load the schema, and route
 * Prisma through it. DEV ONLY — never enabled in production.
 */
export async function initDb(): Promise<void> {
  if (process.env.USE_PGLITE !== "true") return;

  const { PGlite } = await import("@electric-sql/pglite");
  const { PrismaPGlite } = await import("pglite-prisma-adapter");
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");

  const here = dirname(fileURLToPath(import.meta.url));
  const ddl = readFileSync(join(here, "..", "prisma", "smoke-schema.sql"), "utf8");

  const pglite = new PGlite(); // in-memory; data is ephemeral (resets on restart)
  await pglite.exec(ddl);

  prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) });
  globalForPrisma.prisma = prisma;
}
