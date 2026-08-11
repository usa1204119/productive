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
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      "headers.cookie",
      "headers.authorization",
      "code",
      "token",
      "apiKey",
      "clientSecret",
      "refreshToken",
    ],
    censor: "[REDACTED]",
  },
});
