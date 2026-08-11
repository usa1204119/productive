import { env } from "../../env.js";
import { ConsoleMailProvider } from "./console.js";
import { MemoryMailProvider } from "./memory.js";
import { ResendMailProvider } from "./resend.js";
import type { MailProvider } from "./types.js";

function createMailProvider(): MailProvider {
  if (env.MAIL_PROVIDER === "memory") return new MemoryMailProvider();
  if (env.MAIL_PROVIDER === "resend") {
    return new ResendMailProvider(env.RESEND_API_KEY!, env.MAIL_FROM!);
  }
  return new ConsoleMailProvider();
}

export const mailProvider = createMailProvider();
