import { describe, expect, it } from "vitest";
import { defaultStyleSettings } from "@editor/schemas";
import type { GenerateObjectArgs, LLMProvider } from "@editor/llm";
import { applyStyleChanges, durationFromApprovals, learnFromFeedback, StyleChangeError } from "../src/style";

describe("style changes", () => {
  it("applies pointer changes with coercion and validation", () => {
    const s = applyStyleChanges(defaultStyleSettings(), [
      { path: "/captions/fontSizePx", value: "96" },
      { path: "/captions/highlightColor", value: "#ff0000" },
      { path: "/captions/uppercase", value: "false" },
      { path: "/censorship/autoBlur/plates", value: true },
    ]);
    expect(s.captions).toMatchObject({ fontSizePx: 96, highlightColor: "#FF0000", uppercase: false });
    expect(s.censorship.autoBlur.plates).toBe(true);
  });
  it("rejects invalid values and inconsistent durations", () => {
    expect(() => applyStyleChanges(defaultStyleSettings(), [{ path: "/captions/animation", value: "explode" }])).toThrow(StyleChangeError);
    expect(() => applyStyleChanges(defaultStyleSettings(), [{ path: "/pacing/clipDurationSec/ideal", value: 500 }])).toThrow(/min ≤ ideal ≤ max/);
  });
  it("drifts the ideal duration toward approved clips", () => {
    expect(durationFromApprovals(defaultStyleSettings(), [30, 32])).toEqual([]);
    expect(durationFromApprovals(defaultStyleSettings(), [20, 22, 18])).toEqual([{ path: "/pacing/clipDurationSec/ideal", value: 34 }]);
  });
});

describe("learnFromFeedback", () => {
  it("keeps only changes backed by enough distinct evidence", async () => {
    const llm: LLMProvider = {
      name: "anthropic",
      models: { main: "m", fast: "f" },
      async generateObject<T>(args: GenerateObjectArgs<T>) {
        return {
          object: args.schema.parse({
            changes: [
              { path: "/captions/fontSizePx", value: 100, evidence: ["f1", "f2", "f3"] },
              { path: "/captions/animation", value: "pop", evidence: ["f1", "f1"] },
              { path: "/zooms/perMinute", value: 8, evidence: ["f1", "ghost"] },
            ],
            rules: [
              { text: "Prefiere hooks con pregunta", appliesTo: "clip_selection", evidence: ["f2", "f3"], confidence: 0.8 },
              { text: "Odia el azul", appliesTo: "captions", evidence: ["f4"], confidence: 0.5 },
            ],
            deactivateRuleIds: ["r_old", "r_missing"],
            summary: "Subtítulos más grandes",
          }),
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
      async runTools() {
        throw new Error("unused");
      },
    };
    const items = ["f1", "f2", "f3", "f4"].map((id) => ({ id, kind: "correction", area: "captions", scope: "this_clip", userText: null, summary: "más grande" }));
    const r = await learnFromFeedback(llm, { settings: defaultStyleSettings(), rules: [{ id: "r_old", text: "x", appliesTo: "general", confidence: 0.5, evidence: [], active: true }], items });
    expect(r.changes.map((c) => c.path)).toEqual(["/captions/fontSizePx"]);
    expect(r.rules.map((x) => x.text)).toEqual(["Prefiere hooks con pregunta"]);
    expect(r.deactivateRuleIds).toEqual(["r_old"]);
  });
});
