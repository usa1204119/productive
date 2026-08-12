import { Router } from "express";
import { aiChatRequestSchema, type AiChatMessage } from "@plane-and-curves/shared";
import { requireAuth } from "../middleware/auth.js";
import { requireWorkspaceAccess } from "../middleware/workspace.js";
import { validateBody } from "../middleware/validate.js";
import { aiRateLimit } from "../middleware/rateLimit.js";
import { aiChatEnabled, env } from "../env.js";
import { logger } from "../logger.js";
import { aiProvider } from "../lib/ai/index.js";
import { AiProviderError, type AiProviderMessage } from "../lib/ai/groq.js";

// Mounted at /workspaces/:workspaceId/ai — mergeParams exposes :workspaceId.
export const aiRouter = Router({ mergeParams: true });
aiRouter.use(requireAuth, requireWorkspaceAccess);

const SYSTEM_PROMPT =
  "You are a helpful assistant embedded in a visual whiteboard app. The user has " +
  "selected part of their whiteboard and captured it as an image — it may contain " +
  "diagrams, notes, code, or sketches. Answer questions about that snapshot clearly " +
  "and concisely. Use GitHub-flavored Markdown; put any code in fenced code blocks " +
  "with a language tag.";

/**
 * Stream an answer about the selection snapshot. The image is attached to the
 * first user turn (OpenAI-style content parts); follow-ups reuse the same thread.
 * Response is Server-Sent Events: `delta` {text}, then `done`, or `error`
 * {message}. The GROQ key never leaves the server.
 */
aiRouter.post("/chat", aiRateLimit, validateBody(aiChatRequestSchema), async (req, res) => {
  if (!aiChatEnabled) {
    res.status(503).json({ success: false, error: { code: "AI_DISABLED", message: "AI chat is not enabled" } });
    return;
  }
  if (req.user!.isGuest) {
    res
      .status(403)
      .json({ success: false, error: { code: "GUEST_FORBIDDEN", message: "Sign in with Google to use AI chat" } });
    return;
  }

  const { imageDataUrl, messages } = req.body as {
    imageDataUrl?: string;
    messages: AiChatMessage[];
  };

  const providerMessages: AiProviderMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
  let imageAttached = false;
  for (const m of messages) {
    if (m.role === "user" && imageDataUrl && !imageAttached) {
      providerMessages.push({
        role: "user",
        content: [
          { type: "text", text: m.content },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      });
      imageAttached = true;
    } else {
      providerMessages.push({ role: m.role, content: m.content });
    }
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const controller = new AbortController();
  const onClose = () => controller.abort();
  req.on("close", onClose);

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    for await (const delta of aiProvider.streamChat({
      model: env.GROQ_MODEL,
      messages: providerMessages,
      signal: controller.signal,
      maxTokens: 1024,
      reasoningEffort: env.GROQ_REASONING_EFFORT || undefined,
    })) {
      send("delta", { text: delta });
    }
    send("done", {});
  } catch (error) {
    if (!controller.signal.aborted) {
      const status = error instanceof AiProviderError ? error.status : 500;
      logger.warn(
        { status, err: error instanceof Error ? error.message : String(error) },
        "AI chat stream failed",
      );
      send("error", {
        message:
          status === 429
            ? "The AI is busy right now — please try again in a moment."
            : "The AI request failed. Please try again.",
      });
    }
  } finally {
    req.off("close", onClose);
    res.end();
  }
});
