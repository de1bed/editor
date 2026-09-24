import { describe, expect, it } from "vitest";
import { StyleSettings, type Transcript } from "@editor/schemas";
import type { GenerateObjectArgs, LLMProvider } from "@editor/llm";
import { pickNonOverlapping, selectMoments } from "../src/select-moments";

// 3 minutes of speech: 60 sentences of 3 s each.
const words = Array.from({ length: 180 }, (_, i) => ({ id: `w${i}`, text: i % 3 === 2 ? "fin." : "palabra", startMs: i * 1000, endMs: i * 1000 + 800, speaker: "S0", confidence: 1 }));
const transcript: Transcript = {
  assetId: "a",
  language: "es",
  provider: "fixture",
  providerVersion: "1",
  durationMs: 180_000,
  words,
  speakers: [{ id: "S0", label: "Ana" }],
  sentences: Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, startMs: i * 3000, endMs: i * 3000 + 2800, wordIds: [`w${i * 3}`, `w${i * 3 + 1}`, `w${i * 3 + 2}`], speaker: "S0" })),
};
const style = StyleSettings.parse({ pacing: { clipDurationSec: { min: 15, ideal: 30, max: 45 }, maxShotLengthSec: 8, removeSilencesAboveMs: null, removeFillers: false } });

function fakeLLM(reply: unknown, seen: GenerateObjectArgs<unknown>[] = []): LLMProvider {
  return {
    name: "anthropic",
    models: { main: "m", fast: "f" },
    async generateObject<T>(args: GenerateObjectArgs<T>) {
      seen.push(args as GenerateObjectArgs<unknown>);
      return { object: args.schema.parse(reply), usage: { inputTokens: 100, outputTokens: 10 } };
    },
    async runTools() {
      throw new Error("unused");
    },
  };
}

const m = (a: number, b: number, s: number, title = "t") => ({ startSentence: `s${a}`, endSentence: `s${b}`, title, hook: "h", justification: "j", hookScore: s, payoffScore: s, standaloneScore: s, emotionScore: s });

describe("selectMoments", () => {
  it("maps sentence ids to exact times, scores and ranks without overlaps", async () => {
    const seen: GenerateObjectArgs<unknown>[] = [];
    const llm = fakeLLM({ moments: [m(0, 9, 6, "A"), m(2, 11, 9, "B"), m(20, 29, 8, "C"), m(40, 41, 10, "too short"), m(5, "x" as never, 10), m(30, 25, 10)] }, seen);
    const { moments, usage } = await selectMoments({ transcript, style, count: 5, llm, learnedRules: [{ id: "r", text: "Prefiere preguntas", appliesTo: "clip_selection", confidence: 0.9, evidence: [], active: true }], examples: ["Aprobó un clip de 30 s que abre con una pregunta"] });
    expect(moments.map((x) => x.title)).toEqual(["B", "C"]); // A overlaps B; invalid ones dropped
    expect(moments[0]).toMatchObject({ startMs: 6000, endMs: 35_800 });
    expect(moments[0]!.scores.total).toBeGreaterThan(moments[1]!.scores.total);
    expect(usage.inputTokens).toBeGreaterThan(0);
    const prompt = seen[0]!;
    expect(prompt.system).toContain("Prefiere preguntas");
    expect(prompt.system).toContain("Aprobó un clip");
    expect(prompt.messages[0]!.content).toContain("[s0 00:00.000–00:02.800] Ana: palabra palabra fin.");
    expect(prompt.model).toBe("fast");
  });

  it("splits long transcripts into overlapping blocks", async () => {
    const seen: GenerateObjectArgs<unknown>[] = [];
    await selectMoments({ transcript, style, count: 3, llm: fakeLLM({ moments: [] }, seen), blockMs: 60_000 });
    expect(seen).toHaveLength(3);
    expect(seen[1]!.messages[0]!.content).toContain("[s4 "); // overlap from the previous block
  });

  it("pickNonOverlapping respects the count", () => {
    const c = (s: number, t: number) => ({ startMs: s, endMs: s + 10_000, title: "", hookText: "", justification: "", scores: { hook: 0, payoff: 0, standalone: 0, emotion: 0, durationFit: 0, total: t } });
    expect(pickNonOverlapping([c(0, 1), c(20_000, 5), c(40_000, 3)], 2).map((x) => x.scores.total)).toEqual([5, 3]);
  });
});
