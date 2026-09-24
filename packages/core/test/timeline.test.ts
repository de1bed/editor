import { describe, expect, it } from "vitest";
import { Timeline, TimelineShape } from "@editor/schemas";
import { validateTimeline } from "../src/validate";
import { fixtureTimeline } from "./helpers";

describe("Timeline validator", () => {
  it("accepts a timeline built from the fixture", () => {
    const t = fixtureTimeline();
    const r = validateTimeline(t);
    expect(r.ok).toBe(true);
    expect(t.segments).toHaveLength(1);
    expect(t.captions.cues.length).toBeGreaterThan(3);
  });

  it("fills defaults for optional sections", () => {
    const t = fixtureTimeline();
    const minimal = {
      schemaVersion: "1",
      id: "x",
      projectId: "p",
      clipId: "c",
      version: 0,
      source: t.source,
      style: t.style,
      segments: [{ id: "s1", sourceStartMs: 0, sourceEndMs: 1000 }],
    };
    const parsed = Timeline.parse(minimal);
    expect(parsed.output).toEqual({ width: 1080, height: 1920, fps: 30 });
    expect(parsed.blurs).toEqual([]);
    expect(parsed.captions).toEqual({ enabled: true, cues: [] });
  });

  const cases: [string, (t: Timeline) => void, RegExp][] = [
    ["segment end before start", (t) => { t.segments[0]!.sourceEndMs = t.segments[0]!.sourceStartMs; }, /segments\.0.*end/],
    ["segment beyond source", (t) => { t.segments[0]!.sourceEndMs = 20_000; }, /exceeds source duration/],
    ["duplicate ids", (t) => { t.segments.push({ ...t.segments[0]!, sourceStartMs: 0, sourceEndMs: 500 }); }, /duplicate id/],
    ["empty segments", (t) => { t.segments = []; }, /segments/],
    ["negative time", (t) => { t.segments[0]!.sourceStartMs = -5; }, /segments\.0\.sourceStartMs/],
    ["non-integer ms", (t) => { t.segments[0]!.sourceStartMs = 1.5; }, /segments\.0\.sourceStartMs/],
    [
      "unsorted blur keyframes",
      (t) => {
        t.blurs.push({ id: "b1", label: "", kind: "face", sourceStartMs: 0, sourceEndMs: 1000, shape: "rect", featherPx: 0,
          effect: { type: "gaussian", strength: 30 },
          keyframes: [{ tMs: 500, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { tMs: 100, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] });
      },
      /sorted/,
    ],
    [
      "blur box outside frame",
      (t) => {
        t.blurs.push({ id: "b1", label: "", kind: "face", sourceStartMs: 0, sourceEndMs: 1000, shape: "rect", featherPx: 0,
          effect: { type: "gaussian", strength: 30 }, keyframes: [{ tMs: 0, x: 0.9, y: 0.1, w: 0.3, h: 0.2 }] });
      },
      /outside the frame/,
    ],
    [
      "mask shape without mask",
      (t) => {
        t.blurs.push({ id: "b1", label: "", kind: "logo", sourceStartMs: 0, sourceEndMs: 1000, shape: "mask", featherPx: 0,
          effect: { type: "gaussian", strength: 30 }, keyframes: [{ tMs: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] });
      },
      /requires mask/,
    ],
    ["coordinate > 1", (t) => { t.reframe.push({ id: "r1", sourceStartMs: 0, sourceEndMs: 1000, mode: "track", interpolation: "linear", keyframes: [{ tMs: 0, cx: 1.5, cy: 0.5, zoom: 1 }] }); }, /cx/],
    [
      "overlapping reframe tracks",
      (t) => {
        const kf = [{ tMs: 0, cx: 0.5, cy: 0.5, zoom: 1 }];
        t.reframe.push({ id: "r1", sourceStartMs: 0, sourceEndMs: 1000, mode: "track", interpolation: "linear", keyframes: kf });
        t.reframe.push({ id: "r2", sourceStartMs: 500, sourceEndMs: 1500, mode: "track", interpolation: "linear", keyframes: kf });
      },
      /overlaps/,
    ],
    ["word outside its cue", (t) => { t.captions.cues[0]!.words[0]!.sourceStartMs = 0; t.captions.cues[0]!.sourceStartMs = 100; }, /outside its cue/],
    ["censorship event with unknown word", (t) => { t.audio.events.push({ id: "e1", type: "bleep", sourceStartMs: 0, sourceEndMs: 100, reason: "censorship", wordId: "nope" }); }, /unknown word/],
    ["overlay past the end", (t) => { t.overlays.push({ id: "o1", type: "zoom", outputStartMs: 9000, outputEndMs: 99_000, scale: 1.2, easing: "punch" }); }, /after the clip/],
    ["max duration", (t) => { t.output.maxDurationMs = 1000; }, /exceeds maxDurationMs/],
    ["bad color", (t) => { t.style.resolved.captions.textColor = "red"; }, /textColor/],
    ["transition on first segment", (t) => { t.segments[0]!.transitionIn = { type: "crossfade", durationMs: 100 }; }, /first segment/],
  ];

  for (const [name, mutate, pattern] of cases) {
    it(`rejects: ${name}`, () => {
      const t = structuredClone(fixtureTimeline());
      mutate(t);
      const r = validateTimeline(t);
      expect(r.ok).toBe(false);
      expect(r.errors.join("\n")).toMatch(pattern);
    });
  }

  it("structural schema (JSON Schema source) has no refinements", () => {
    const t = structuredClone(fixtureTimeline());
    t.segments[0]!.sourceEndMs = 99_999;
    expect(TimelineShape.safeParse(t).success).toBe(true);
    expect(Timeline.safeParse(t).success).toBe(false);
  });
});
