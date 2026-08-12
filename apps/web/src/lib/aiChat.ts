import type { AiChatMessage } from "@plane-and-curves/shared";

interface StreamOptions {
  workspaceId: string;
  imageDataUrl?: string;
  messages: AiChatMessage[];
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}

/**
 * POST the snapshot + conversation to our server and consume the Server-Sent
 * Events stream it proxies back from Groq, invoking `onDelta` for each token.
 * Resolves when the stream ends; throws on a transport/AI error (message is
 * user-safe). Abort via `signal`.
 */
export async function streamAiChat({
  workspaceId,
  imageDataUrl,
  messages,
  onDelta,
  signal,
}: StreamOptions): Promise<void> {
  const res = await fetch(`/workspaces/${workspaceId}/ai/chat`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageDataUrl, messages }),
    signal,
  });

  if (!res.ok || !res.body) {
    // Non-stream error (JSON envelope): disabled, forbidden, rate-limited, …
    let message = "The AI request failed. Please try again.";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }

      if (event === "delta") {
        try {
          const parsed = JSON.parse(data) as { text?: string };
          if (parsed.text) onDelta(parsed.text);
        } catch {
          /* ignore malformed frame */
        }
      } else if (event === "error") {
        let message = "The AI request failed. Please try again.";
        try {
          message = (JSON.parse(data) as { message?: string }).message ?? message;
        } catch {
          /* keep default */
        }
        throw new Error(message);
      } else if (event === "done") {
        return;
      }
    }
  }
}
