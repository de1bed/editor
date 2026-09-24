import OpenAI from "openai";
import { type Embedder, type GenerateObjectArgs, type LLMProvider, LLMError, type RunToolsArgs, type RunToolsResult, type ToolCallRecord, type Usage } from "./types";
import { parseOutput, toJsonSchema } from "./schema";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai" as const;
  private readonly client: OpenAI;

  constructor(
    readonly models: { main: string; fast: string },
    client?: OpenAI,
  ) {
    this.client = client ?? new OpenAI();
  }

  async generateObject<T>(args: GenerateObjectArgs<T>): Promise<{ object: T; usage: Usage }> {
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const messages: Msg[] = [{ role: "system", content: args.system }, ...args.messages];
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.client.chat.completions.create({
        model: this.models[args.model ?? "main"],
        messages,
        max_completion_tokens: args.maxTokens ?? 16000,
        response_format: { type: "json_schema", json_schema: { name: args.name ?? "output", schema: toJsonSchema(args.schema), strict: false } },
      });
      addUsage(usage, res.usage);
      const choice = res.choices[0];
      if (choice?.message.refusal) throw new LLMError(choice.message.refusal, "refusal");
      const text = choice?.message.content ?? "";
      const parsed = parseOutput(args.schema, text);
      if (parsed.ok) return { object: parsed.value, usage };
      messages.push({ role: "assistant", content: text }, { role: "user", content: `That output is invalid: ${parsed.error}. Return corrected JSON only.` });
    }
    throw new LLMError("the model did not return valid structured output", "invalid_output");
  }

  async runTools(args: RunToolsArgs): Promise<RunToolsResult> {
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const toolCalls: ToolCallRecord[] = [];
    const byName = new Map(args.tools.map((t) => [t.name, t]));
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = args.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: toJsonSchema(t.input) },
    }));
    const messages: Msg[] = [{ role: "system", content: args.system }, ...args.messages];
    let text = "";
    for (let turn = 0; turn < (args.maxTurns ?? 12); turn++) {
      const res = await this.client.chat.completions.create({
        model: this.models[args.model ?? "main"],
        messages,
        tools,
        max_completion_tokens: args.maxTokens ?? 16000,
      });
      addUsage(usage, res.usage);
      const choice = res.choices[0]!;
      text = choice.message.content ?? "";
      if (choice.message.refusal) return { text: choice.message.refusal, toolCalls, usage, stopReason: "refusal" };
      if (choice.finish_reason === "length") return { text, toolCalls, usage, stopReason: "max_tokens" };
      const calls = (choice.message.tool_calls ?? []).filter((c) => c.type === "function");
      if (!calls.length) return { text, toolCalls, usage, stopReason: "end" };
      messages.push(choice.message as Msg);
      for (const c of calls) {
        const record: ToolCallRecord = { name: c.function.name, input: null };
        let content: string;
        try {
          record.input = JSON.parse(c.function.arguments || "{}");
          const tool = byName.get(c.function.name);
          if (!tool) throw new Error(`unknown tool ${c.function.name}`);
          const parsed = tool.input.safeParse(record.input);
          if (!parsed.success) throw new Error(`invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
          record.output = await tool.run(parsed.data);
          content = JSON.stringify(record.output ?? null);
        } catch (e) {
          record.error = e instanceof Error ? e.message : String(e);
          content = `ERROR: ${record.error}`;
        }
        toolCalls.push(record);
        args.onToolCall?.(record);
        messages.push({ role: "tool", tool_call_id: c.id, content });
      }
    }
    return { text, toolCalls, usage, stopReason: "max_turns" };
  }
}

export class OpenAIEmbedder implements Embedder {
  private readonly client: OpenAI;
  constructor(
    readonly model: string,
    readonly dimensions = 1536,
    client?: OpenAI,
  ) {
    this.client = client ?? new OpenAI();
  }
  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const res = await this.client.embeddings.create({ model: this.model, input: texts, dimensions: this.dimensions });
    return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

function addUsage(u: Usage, r: OpenAI.Completions.CompletionUsage | undefined) {
  if (!r) return;
  u.inputTokens += r.prompt_tokens;
  u.outputTokens += r.completion_tokens;
}
