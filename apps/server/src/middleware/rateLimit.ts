import type { Request, RequestHandler } from "express";
import { ipKeyGenerator, rateLimit, type Store } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { createClient, type RedisClientType } from "redis";
import { env } from "../env.js";
import { logger } from "../logger.js";

let redisClient: RedisClientType | null = null;

async function connectRedis(): Promise<RedisClientType | null> {
  if (!env.REDIS_URL) return null;
  const client = createClient({ url: env.REDIS_URL });
  try {
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Redis timeout")), 5_000)),
    ]);
    redisClient = client;
    return client;
  } catch (error) {
    logger.error({ err: error }, "Redis rate-limit store unavailable; using in-memory limits");
    await client.quit().catch(() => undefined);
    return null;
  }
}

const connectedRedis = await connectRedis();

function store(prefix: string): Store | undefined {
  if (!connectedRedis) return undefined;
  return new RedisStore({
    prefix: `pac:${prefix}:`,
    sendCommand: (...args: string[]) => connectedRedis.sendCommand(args),
  });
}

function key(req: Request): string {
  return `${req.user?.id ?? "anonymous"}:${ipKeyGenerator(req.ip ?? "unknown")}`;
}

function limiter(prefix: string, windowMs: number, limit: number): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: key,
    store: store(prefix),
    passOnStoreError: true,
    handler: (_req, res, _next, options) => {
      res.status(options.statusCode).json({
        success: false,
        error: { code: "RATE_LIMITED", message: "Too many requests; try again later" },
      });
    },
  });
}

export const generalRateLimit = limiter("general", 15 * 60_000, env.NODE_ENV === "test" ? 5_000 : 500);
export const guestRateLimit = limiter("guest", 60 * 60_000, 10);
export const oauthRateLimit = limiter("oauth", 15 * 60_000, 60);
export const invitationRateLimit = limiter("invitation", 60 * 60_000, 20);
export const invitationAcceptRateLimit = limiter("invitation-accept", 60 * 60_000, 30);
export const uploadRateLimit = limiter("upload", 60 * 60_000, 30);
export const aiRateLimit = limiter("ai", 5 * 60_000, env.NODE_ENV === "test" ? 5 : 30);
export const e2eRateLimit = limiter("e2e", 60_000, 3);

export async function closeRateLimitStore(): Promise<void> {
  await redisClient?.quit().catch(() => undefined);
  redisClient = null;
}
