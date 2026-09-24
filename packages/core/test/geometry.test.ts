import { describe, expect, it } from "vitest";
import type { DetectionTrack } from "@editor/schemas";
import { applyOps } from "../src/apply-ops";
import { cropWindowAt, detectionToBlur, outputBoxToSource } from "../src/geometry";
import { validateTimeline } from "../src/validate";
import { fixtureTimeline } from "./helpers";

describe("geometry", () => {
  it("center crop of a 16:9 source is ~31.6% wide", () => {
    const w = cropWindowAt(fixtureTimeline(), 1000);
    expect(w.w).toBeCloseTo(0.3164, 3);
    expect(w.x).toBeCloseTo((1 - w.w) / 2, 5);
    expect(w).toMatchObject({ y: 0, h: 1, letterboxed: false });
  });

  it("maps a box drawn on the output back to source coordinates", () => {
    const t = applyOps(fixtureTimeline([{ startMs: 2000, endMs: 6000 }]), [{ op: "set_reframe_mode", mode: "fixed", cx: 0.2 }]).timeline;
    const r = outputBoxToSource(t, 500, { x: 0, y: 0.25, w: 0.5, h: 0.5 })!;
    const at = t.segments[0]!.sourceStartMs + 500;
    const win = cropWindowAt(t, at);
    expect(r.sourceMs).toBe(at);
    expect(r.box.x).toBeCloseTo(win.x, 5);
    expect(r.box.w).toBeCloseTo(win.w / 2, 5);
    expect(r.box.y).toBeCloseTo(0.25, 5);
  });

  it("letterboxed frames map through the vertical offset", () => {
    const t = applyOps(fixtureTimeline(), [{ op: "set_reframe_mode", mode: "fit_blur_bg" }]).timeline;
    const r = outputBoxToSource(t, 100, { x: 0.25, y: 0.5, w: 0.5, h: 0.1 })!;
    // 16:9 frame occupies 31.6% of the 9:16 height, centered.
    expect(r.box.x).toBeCloseTo(0.25, 5);
    expect(r.box.y).toBeCloseTo((0.5 - (1 - 0.3164) / 2) / 0.3164, 2);
  });

  it("detection tracks become valid blur regions", () => {
    const d: DetectionTrack = {
      id: "det_1", assetId: "a", query: "logo de la gorra", kind: "logo", model: "gdino", startMs: 500, endMs: 12_000, score: 0.8,
      keyframes: [{ tMs: 500, x: 0.4, y: 0.1, w: 0.1, h: 0.1 }, { tMs: 3000, x: 0.95, y: 0.1, w: 0.1, h: 0.1 }],
    };
    const region = detectionToBlur(d, { id: "b1", startMs: 0, endMs: 10_000 })!;
    expect(region).toMatchObject({ sourceStartMs: 500, sourceEndMs: 10_000, kind: "logo", label: "logo de la gorra" });
    expect(region.keyframes[1]!.w).toBeCloseTo(0.05, 5); // clamped inside the frame
    const t = applyOps(fixtureTimeline(), [{ op: "add_blur", region }]).timeline;
    expect(validateTimeline(t).ok).toBe(true);
  });

  it("set_censorship re-applies the lists", () => {
    const t = fixtureTimeline();
    const off = applyOps(t, [{ op: "set_censorship", patch: { enabled: false } }]).timeline;
    expect(off.audio.events).toHaveLength(0);
    const extra = applyOps(off, [{ op: "set_censorship", patch: { enabled: true, audio: "mute", addWords: { es: ["trabajo"] } } }]).timeline;
    expect(extra.audio.events.map((e) => [e.wordId, e.type]).sort()).toEqual([["w14", "mute"], ["w7", "mute"]]);
  });
});
