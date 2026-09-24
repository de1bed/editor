import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicProvider } from "../src/anthropic";
import { parseOutput, toJsonSchema } from "../src/schema";

describe("schema helpers", () => {
  it("closes objects and drops unsupported constraints", () => {
    const s = toJsonSchema(z.object({ a: z.number().min(0).max(10), b: z.array(z.string().min(1)).max(3), c: z.object({ d: z.boolean() }) }));
    expect(JSON.stringify(s)).not.toMatch(/minimum|maximum|minLength|maxItems|\$schema/);
    expect(s.additionalProperties).toBe(false);
    expect((s.properties as Record<string, { additionalProperties?: boolean }>).c!.additionalProperties).toBe(false);
  });
  it("parses fenced JSON and reports schema errors", () => {
    const schema = z.object({ n: z.number().max(5) });
    expect(parseOutput(schema, '```json\n{"n": 3}\n```')).toEqual({ ok: true, value: { n: 3 } });
    expect(parseOutput(schema, '{"n": 9}')).toMatchObject({ ok: false });
    expect(parseOutput(schema, "nope")).toEqual({ ok: false, error: "the output was not valid JSON" });
  });
});

/** Minimal stand-in for the Anthropic client: scripted responses for messages.stream(). */
function fakeClient(responses: unknown[], requests: unknown[]) {
  return {
    messages: {
      stream(req: unknown) {
        requests.push(structuredClone(req));
        const next = responses.shift();
        return { finalMessage: async () => next };
      },
    },
  } as never;
}
const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

describe("AnthropicProvider", () => {
  it("runs the tool loop: parallel calls, one tool_result message, errors as is_error", async () => {
    const requests: any[] = [];
    const client = fakeClient(
      [
        {
          stop_reason: "tool_use",
          usage,
          content: [
            { type: "text", text: "Voy." },
            { type: "tool_use", id: "t1", name: "add", input: { a: 1, b: 2 } },
            { type: "tool_use", id: "t2", name: "add", input: { a: "x" } },
          ],
        },
        { stop_reason: "end_turn", usage, content: [{ type: "text", text: "Listo: 3" }] },
      ],
      requests,
    );
    const p = new AnthropicProvider({ main: "claude-opus-5", fast: "claude-haiku-4-5" }, client);
    const r = await p.runTools({
      system: "sys",
      messages: [{ role: "user", content: "suma" }],
      tools: [{ name: "add", description: "add", input: z.object({ a: z.number(), b: z.number() }), run: async ({ a, b }) => a + b }],
    });
    expect(r).toMatchObject({ text: "Listo: 3", stopReason: "end" });
    expect(r.toolCalls.map((c) => [c.output, Boolean(c.error)])).toEqual([[3, false], [undefined, true]]);
    const second = requests[1];
    const toolMsg = second.messages.at(-1);
    expect(toolMsg.role).toBe("user");
    expect(toolMsg.content.map((b: any) => [b.tool_use_id, b.is_error ?? false])).toEqual([["t1", false], ["t2", true]]);
    expect(second.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(requests[0].model).toBe("claude-opus-5");
  });

  it("structured output retries once with the validation error", async () => {
    const requests: any[] = [];
    const client = fakeClient(
      [
        { stop_reason: "end_turn", usage, content: [{ type: "text", text: '{"n": 99}' }] },
        { stop_reason: "end_turn", usage, content: [{ type: "text", text: '{"n": 4}' }] },
      ],
      requests,
    );
    const p = new AnthropicProvider({ main: "m", fast: "f" }, client);
    const r = await p.generateObject({ system: "s", messages: [{ role: "user", content: "x" }], schema: z.object({ n: z.number().max(5) }), model: "fast" });
    expect(r.object).toEqual({ n: 4 });
    expect(requests[0].output_config.format.type).toBe("json_schema");
    expect(requests[1].messages.at(-1).content).toMatch(/invalid/);
    expect(requests[0].model).toBe("f");
  });

  it("surfaces refusals", async () => {
    const client = fakeClient([{ stop_reason: "refusal", usage, content: [] }], []);
    const p = new AnthropicProvider({ main: "m", fast: "f" }, client);
    await expect(p.generateObject({ system: "s", messages: [], schema: z.object({}) })).rejects.toThrow(/declined/);
  });
});
