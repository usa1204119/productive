import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env.js";

/**
 * AES-256-GCM using the key from ENCRYPTION_KEY (32 bytes, hex).
 * Used to encrypt Google refresh tokens at rest.
 *
 * Serialized form: "<iv-hex>:<authTag-hex>:<ciphertext-hex>".
 */
const KEY = Buffer.from(env.ENCRYPTION_KEY, "hex");
const IV_BYTES = 12; // GCM standard nonce length

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), ciphertext.toString("hex")].join(":");
}

export function decrypt(serialized: string): string {
  const parts = serialized.split(":");
  if (parts.length !== 3) throw new Error("Malformed ciphertext");
  const [ivHex, tagHex, dataHex] = parts as [string, string, string];
  const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
