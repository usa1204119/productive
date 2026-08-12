import { z } from "zod";

/** A turn in the Ask-AI conversation (only user/assistant cross the wire; the
 *  system prompt is added server-side). */
export const aiChatRoleSchema = z.enum(["user", "assistant"]);
export type AiChatRole = z.infer<typeof aiChatRoleSchema>;

export const aiChatMessageSchema = z.object({
  role: aiChatRoleSchema,
  content: z.string().min(1).max(8000),
});
export type AiChatMessage = z.infer<typeof aiChatMessageSchema>;

/** ~4 MB image → ~5.5 MB base64 data URL; cap the string generously. */
export const MAX_AI_IMAGE_CHARS = 6_000_000;

export const aiChatRequestSchema = z.object({
  /** PNG/JPEG/WEBP snapshot of the selected whiteboard elements. */
  imageDataUrl: z
    .string()
    .regex(/^data:image\/(png|jpe?g|webp);base64,/, "must be a base64 image data URL")
    .max(MAX_AI_IMAGE_CHARS)
    .optional(),
  messages: z.array(aiChatMessageSchema).min(1).max(30),
});
export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;
