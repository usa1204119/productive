import { z } from "zod";

/**
 * All configuration comes from environment variables — never hardcoded.
 * This module validates them once at startup and fails fast with a clear
 * message if anything required is missing or malformed.
 */
const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  SERVER_URL: z.string().url(),
  WEB_URL: z.string().url(),

  DATABASE_URL: z.string().min(1),

  SESSION_COOKIE_NAME: z.string().min(1).default("pac_session"),
  SESSION_COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url(),
  GOOGLE_DRIVE_REDIRECT_URI: z.string().url(),

  // 32-byte key, hex-encoded (64 hex chars) for AES-256-GCM.
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be 64 hex characters (32 bytes)"),
  SHARING_ENABLED: booleanString.default("false"),
  MAIL_PROVIDER: z.enum(["console", "resend", "memory"]).default("console"),
  RESEND_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).optional(),
  INVITE_TTL_HOURS: z.coerce.number().int().positive().max(24 * 30).default(168),
  REDIS_URL: z.string().url().optional(),
  E2E_TEST_MODE: booleanString.default("false"),

  // AI chat ("Ask AI" about a whiteboard selection) — Groq vision. The key stays
  // server-side; the browser never sees it.
  AI_CHAT_ENABLED: booleanString.default("false"),
  GROQ_API_KEY: z.string().min(1).optional(),
  GROQ_MODEL: z.string().min(1).default("qwen/qwen3.6-27b"),
  GROQ_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
  // Reasoning models (e.g. Qwen3) otherwise burn the token budget on hidden
  // <think>; "none" makes them answer directly. Set empty for non-reasoning models.
  GROQ_REASONING_EFFORT: z.string().default("none"),
}).superRefine((value, ctx) => {
  if (value.NODE_ENV === "production" && value.SHARING_ENABLED) {
    if (value.MAIL_PROVIDER !== "resend") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MAIL_PROVIDER"],
        message: "production sharing requires MAIL_PROVIDER=resend",
      });
    }
    if (!value.RESEND_API_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["RESEND_API_KEY"], message: "required" });
    }
    if (!value.MAIL_FROM) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["MAIL_FROM"], message: "required" });
    }
  }
  if (value.E2E_TEST_MODE && value.NODE_ENV !== "test") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["E2E_TEST_MODE"],
      message: "may only be enabled when NODE_ENV=test",
    });
  }
  if (value.NODE_ENV === "production" && value.AI_CHAT_ENABLED && !value.GROQ_API_KEY) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["GROQ_API_KEY"], message: "required when AI_CHAT_ENABLED" });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console -- config failure before the logger exists
  console.error(
    "Invalid environment configuration:\n" +
      parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n"),
  );
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
