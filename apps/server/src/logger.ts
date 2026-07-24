import pino from "pino";
import { env, isProd } from "./env.js";

/** Structured logging. No stray console.log anywhere in committed code. */
export const logger = pino({
  level: isProd ? "info" : "debug",
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
        },
      }),
  base: { env: env.NODE_ENV },
});
