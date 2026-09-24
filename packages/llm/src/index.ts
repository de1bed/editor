import { AnthropicProvider } from "./anthropic";
import { OpenAIEmbedder, OpenAIProvider } from "./openai";
import { type Embedder, type LLMProvider, LLMError } from "./types";

export * from "./types";
export * from "./schema";
export { AnthropicProvider } from "./anthropic";
export { OpenAIEmbedder, OpenAIProvider } from "./openai";

let provider: LLMProvider | null = null;
let embedder: Embedder | null = null;

/** Provider from LLM_PROVIDER / LLM_MODEL / LLM_FAST_MODEL. */
export function llm(): LLMProvider {
  if (provider) return provider;
  const name = process.env.LLM_PROVIDER ?? "anthropic";
  if (name === "anthropic") {
    provider = new AnthropicProvider({ main: process.env.LLM_MODEL || "claude-opus-5", fast: process.env.LLM_FAST_MODEL || "claude-haiku-4-5" });
  } else if (name === "openai") {
    const main = process.env.LLM_MODEL;
    if (!main) throw new LLMError("LLM_MODEL is required with LLM_PROVIDER=openai", "config");
    provider = new OpenAIProvider({ main, fast: process.env.LLM_FAST_MODEL || main });
  } else {
    throw new LLMError(`unknown LLM_PROVIDER "${name}"`, "config");
  }
  return provider;
}

/** Embeddings (EMBEDDINGS_PROVIDER). Anthropic has no embeddings endpoint, so OpenAI is the default. */
export function embeddings(): Embedder | null {
  if (embedder) return embedder;
  if ((process.env.EMBEDDINGS_PROVIDER ?? "openai") !== "openai" || !process.env.OPENAI_API_KEY) return null;
  embedder = new OpenAIEmbedder(process.env.EMBEDDINGS_MODEL || "text-embedding-3-small", 1536);
  return embedder;
}

/** Tests inject fakes here. */
export function setLLM(p: LLMProvider | null, e: Embedder | null = null) {
  provider = p;
  embedder = e;
}
