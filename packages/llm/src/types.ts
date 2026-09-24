import type { z } from "zod";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}

export type Effort = "low" | "medium" | "high";

export interface ToolDef<I = unknown> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  run: (input: I) => Promise<unknown>;
}

export interface ToolCallRecord {
  name: string;
  input: unknown;
  output?: unknown;
  error?: string;
}

export interface GenerateObjectArgs<T> {
  system: string;
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  /** Name for the output format (OpenAI requires one). */
  name?: string;
  model?: "main" | "fast";
  maxTokens?: number;
  effort?: Effort;
}

export interface RunToolsArgs {
  system: string;
  messages: ChatMessage[];
  tools: ToolDef<any>[];
  model?: "main" | "fast";
  maxTurns?: number;
  maxTokens?: number;
  effort?: Effort;
  onToolCall?: (call: ToolCallRecord) => void;
}

export interface RunToolsResult {
  text: string;
  toolCalls: ToolCallRecord[];
  usage: Usage;
  stopReason: "end" | "max_turns" | "refusal" | "max_tokens";
}

/** Provider-agnostic surface used by the agent, clip selection and the style learner. */
export interface LLMProvider {
  readonly name: "anthropic" | "openai";
  readonly models: { main: string; fast: string };
  generateObject<T>(args: GenerateObjectArgs<T>): Promise<{ object: T; usage: Usage }>;
  runTools(args: RunToolsArgs): Promise<RunToolsResult>;
}

export interface Embedder {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly kind: "refusal" | "invalid_output" | "config" | "api" = "api",
  ) {
    super(message);
    this.name = "LLMError";
  }
}
