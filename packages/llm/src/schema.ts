import { z } from "zod";

const UNSUPPORTED = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern", "format", "minItems", "maxItems", "default", "$schema", "id", "title"]);

/**
 * Zod → JSON Schema restricted to what structured-output / strict-tool modes
 * accept: no numeric/length constraints (Zod re-validates the result anyway),
 * closed objects. `maxItems`/`minItems` are also dropped for the same reason.
 */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: "draft-2020-12", io: "output", unrepresentable: "any" }) as Record<string, unknown>;
  return clean(raw) as Record<string, unknown>;
}

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (UNSUPPORTED.has(k)) continue;
    out[k] = k === "properties" ? Object.fromEntries(Object.entries(v as object).map(([p, s]) => [p, clean(s)])) : clean(v);
  }
  if (out.type === "object" && out.properties && out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
}

/** Parses model JSON output with a Zod schema, returning readable errors for a retry. */
export function parseOutput<T>(schema: z.ZodType<T>, text: string): { ok: true; value: T } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(text));
  } catch {
    return { ok: false, error: "the output was not valid JSON" };
  }
  const r = schema.safeParse(json);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
}

function extractJson(text: string): string {
  const t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  return fence ? fence[1]!.trim() : t;
}
