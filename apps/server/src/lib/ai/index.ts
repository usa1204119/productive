import { env } from "../../env.js";
import { FakeAiProvider, GroqProvider, type AiProvider } from "./groq.js";

/**
 * The AI provider for the process. Tests (NODE_ENV=test) get the network-free
 * fake automatically, so smokes never call Groq; everything else talks to Groq.
 */
export const aiProvider: AiProvider =
  env.NODE_ENV === "test"
    ? new FakeAiProvider()
    : new GroqProvider(env.GROQ_API_KEY ?? "", env.GROQ_BASE_URL);
