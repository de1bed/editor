import { Timeline, type Timeline as TimelineT } from "@editor/schemas";

export type ValidationResult = { ok: true; timeline: TimelineT; errors: [] } | { ok: false; errors: string[] };

/** Parses and checks invariants; errors are short, path-prefixed sentences (fit for an LLM to fix). */
export function validateTimeline(value: unknown): ValidationResult {
  const r = Timeline.safeParse(value);
  if (r.success) return { ok: true, timeline: r.data, errors: [] };
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`),
  };
}
