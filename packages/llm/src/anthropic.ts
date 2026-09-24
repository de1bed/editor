import Anthropic from "@anthropic-ai/sdk";
import { type GenerateObjectArgs, type LLMProvider, LLMError, type RunToolsArgs, type RunToolsResult, type ToolCallRecord, type Usage } from "./types";
import { parseOutput, toJsonSchema } from "./schema";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(
    readonly models: { main: string; fast: string },
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic();
  }

  async generateObject<T>(args: GenerateObjectArgs<T>): Promise<{ object: T; usage: Usage }> {
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const messages: Anthropic.MessageParam[] = args.messages.map((m) => ({ role: m.role, content: m.content }));
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.client.messages
        .stream({
          model: this.models[args.model ?? "main"],
          max_tokens: args.maxTokens ?? 16000,
          // Stable prefix first so the system prompt is cached across calls.
          system: [{ type: "text", text: args.system, cache_control: { type: "ephemeral" } }],
          messages,
          output_config: { format: { type: "json_schema", schema: toJsonSchema(args.schema) }, ...(args.effort ? { effort: args.effort } : {}) },
        })
        .finalMessage();
      addUsage(usage, res.usage);
      if (res.stop_reason === "refusal") throw new LLMError("the model declined this request", "refusal");
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const parsed = parseOutput(args.schema, text);
      if (parsed.ok) return { object: parsed.value, usage };
      if (res.stop_reason === "max_tokens") throw new LLMError("output truncated (max_tokens)", "invalid_output");
      messages.push({ role: "assistant", content: text }, { role: "user", content: `That output is invalid: ${parsed.error}. Return corrected JSON only.` });
    }
    throw new LLMError("the model did not return valid structured output", "invalid_output");
  }

  async runTools(args: RunToolsArgs): Promise<RunToolsResult> {
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const toolCalls: ToolCallRecord[] = [];
    const byName = new Map(args.tools.map((t) => [t.name, t]));
    const tools: Anthropic.Tool[] = args.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: toJsonSchema(t.input) as Anthropic.Tool.InputSchema,
    }));
    if (tools.length) tools[tools.length - 1] = { ...tools[tools.length - 1]!, cache_control: { type: "ephemeral" } };
    const messages: Anthropic.MessageParam[] = args.messages.map((m) => ({ role: m.role, content: m.content }));
    let text = "";

    for (let turn = 0; turn < (args.maxTurns ?? 12); turn++) {
      const res = await this.client.messages
        .stream({
          model: this.models[args.model ?? "main"],
          max_tokens: args.maxTokens ?? 16000,
          system: [{ type: "text", text: args.system, cache_control: { type: "ephemeral" } }],
          tools,
          messages,
          ...(args.effort ? { output_config: { effort: args.effort } } : {}),
        })
        .finalMessage();
      addUsage(usage, res.usage);
      text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      if (res.stop_reason === "refusal") return { text, toolCalls, usage, stopReason: "refusal" };
      if (res.stop_reason === "max_tokens") return { text, toolCalls, usage, stopReason: "max_tokens" };
      if (res.stop_reason !== "tool_use") return { text, toolCalls, usage, stopReason: "end" };

      messages.push({ role: "assistant", content: res.content });
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      // All results of a turn go back in one user message.
      const records: ToolCallRecord[] = [];
      const results = await Promise.all(
        uses.map(async (u): Promise<Anthropic.ToolResultBlockParam> => {
          const tool = byName.get(u.name);
          const record: ToolCallRecord = { name: u.name, input: u.input };
          records.push(record);
          try {
            if (!tool) throw new Error(`unknown tool ${u.name}`);
            const parsed = tool.input.safeParse(u.input);
            if (!parsed.success) throw new Error(`invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
            record.output = await tool.run(parsed.data);
            return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(record.output ?? null) };
          } catch (e) {
            record.error = e instanceof Error ? e.message : String(e);
            return { type: "tool_result", tool_use_id: u.id, content: record.error, is_error: true };
          } finally {
            args.onToolCall?.(record);
          }
        }),
      );
      toolCalls.push(...uses.map((u) => records.find((r) => r.input === u.input)!));
      messages.push({ role: "user", content: results });
    }
    return { text, toolCalls, usage, stopReason: "max_turns" };
  }
}

function addUsage(u: Usage, r: Anthropic.Usage) {
  u.inputTokens += r.input_tokens + (r.cache_read_input_tokens ?? 0) + (r.cache_creation_input_tokens ?? 0);
  u.outputTokens += r.output_tokens;
  u.cacheReadTokens = (u.cacheReadTokens ?? 0) + (r.cache_read_input_tokens ?? 0);
}
