import { describe, expect, it } from "vitest";
import type { FaceAnalysis } from "@editor/schemas";
import { defaultStyleSettings } from "@editor/schemas";
import { planReframe } from "../src/reframe";

const face = (id: string, speakerId: string | null, x: number, drift = 0) => ({
  id,
  speakerId,
  startMs: 0,
  endMs: 10_000,
  keyframes: Array.from({ length: 51 }, (_, i) => ({ tMs: i * 200, x: x + drift * i, y: 0.3, w: 0.12, h: 0.25 })),
});

const analysis: FaceAnalysis = { assetId: "a", sampleFps: 5, width: 640, height: 360, tracks: [face("L", "S0", 0.15), face("R", "S1", 0.7)] };
const settings = defaultStyleSettings().reframe;
const base = { startMs: 0, endMs: 10_000, outputAspect: 9 / 16, sourceAspect: 16 / 9, settings };

describe("planReframe", () => {
  it("cuts to whoever is speaking", () => {
    const turns = [
      { speaker: "S0", startMs: 0, endMs: 4000 },
      { speaker: "S1", startMs: 4000, endMs: 10_000 },
    ];
    const tracks = planReframe(analysis, { ...base, turns });
    expect(tracks.map((t) => [t.speakerId, t.sourceStartMs, t.sourceEndMs])).toEqual([
      ["S0", 0, 4000],
      ["S1", 4000, 10_000],
    ]);
    expect(tracks[0]!.keyframes[0]!.cx).toBeCloseTo(0.21, 2);
    expect(tracks[1]!.keyframes[0]!.cx).toBeCloseTo(0.76, 2);
  });

  it("ignores short interjections", () => {
    const turns = [
      { speaker: "S0", startMs: 0, endMs: 4000 },
      { speaker: "S1", startMs: 4000, endMs: 4600 },
      { speaker: "S0", startMs: 4600, endMs: 10_000 },
    ];
    expect(planReframe(analysis, { ...base, turns })).toHaveLength(1);
  });

  it("follows a moving face smoothly with few keyframes", () => {
    const moving: FaceAnalysis = { ...analysis, tracks: [face("M", null, 0.1, 0.01)] };
    const [t] = planReframe(moving, { ...base, turns: [] });
    expect(t!.keyframes.length).toBeLessThan(20);
    expect(t!.keyframes.at(-1)!.cx).toBeGreaterThan(0.45);
    const xs = t!.keyframes.map((k) => k.cx);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs); // monotonic, no jitter
  });

  it("no crop needed for vertical sources, no faces → centered", () => {
    expect(planReframe(analysis, { ...base, turns: [], sourceAspect: 9 / 16 })).toEqual([]);
    expect(planReframe({ ...analysis, tracks: [] }, { ...base, turns: [] })).toEqual([]);
  });
});
