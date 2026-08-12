/**
 * Groq is behind a small port so the route never touches the network directly
 * and tests can swap in a fake. Groq's API is OpenAI-compatible: POST
 * /chat/completions with stream:true returns Server-Sent Events whose
 * `choices[0].delta.content` we yield as plain text deltas.
 */

export interface AiContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface AiProviderMessage {
  role: "system" | "user" | "assistant";
  content: string | AiContentPart[];
}

export interface StreamChatOptions {
  model: string;
  messages: AiProviderMessage[];
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
  /** e.g. "none" to skip a reasoning model's hidden thinking. Omitted when empty. */
  reasoningEffort?: string;
}

export interface AiProvider {
  streamChat(opts: StreamChatOptions): AsyncIterable<string>;
}

/** Carries the upstream HTTP status so the route can map 429 → a friendly note. */
export class AiProviderError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export class GroqProvider implements AiProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async *streamChat(opts: StreamChatOptions): AsyncIterable<string> {
    if (!this.apiKey) throw new AiProviderError(500, "GROQ_API_KEY is not configured");

    const res = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        stream: true,
        temperature: opts.temperature ?? 0.6,
        max_tokens: opts.maxTokens ?? 1024,
        ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
      }),
      signal: opts.signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new AiProviderError(res.status || 502, detail || `Groq request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          try {
            const json = JSON.parse(data) as {
              choices?: { delta?: { content?: string } }[];
            };
            const delta = json.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) yield delta;
          } catch {
            /* ignore keep-alive / partial lines */
          }
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
}

/** Deterministic, network-free provider for tests. Echoes a short reply. */
export class FakeAiProvider implements AiProvider {
  async *streamChat(opts: StreamChatOptions): AsyncIterable<string> {
    const sawImage = opts.messages.some(
      (m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"),
    );
    const chunks = ["Here", " is", " what", " I", " see", sawImage ? " in the image." : "."];
    for (const c of chunks) yield c;
  }
}
