import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { EditOpInput } from "@editor/schemas";
import { applyOps, EditOpError } from "../src/apply-ops";
import { validateTimeline } from "../src/validate";
import { fixtureTimeline } from "./helpers";

describe("applyOps", () => {
  it("trims, splits, reorders and bumps the version", () => {
    const t = fixtureTimeline();
    const r = applyOps(t, [
      { op: "trim_segment", segmentId: "seg_1", sourceStartMs: 1000 },
      { op: "split_segment", segmentId: "seg_1", atSourceMs: 5000 },
      { op: "reorder_segments", order: ["seg_1b", "seg_1"] },
    ]);
    expect(r.timeline.version).toBe(t.version + 1);
    expect(r.timeline.segments.map((s) => [s.id, s.sourceStartMs, s.sourceEndMs])).toEqual([
      ["seg_1b", 5000, 10000],
      ["seg_1", 1000, 5000],
    ]);
    expect(r.jsonPatch.length).toBeGreaterThan(0);
    expect(t.segments).toHaveLength(1); // input untouched
  });

  it("is atomic: one bad op rejects the batch with a readable error", () => {
    const t = fixtureTimeline();
    expect(() =>
      applyOps(t, [
        { op: "trim_segment", segmentId: "seg_1", sourceStartMs: 1000 },
        { op: "delete_segment", segmentId: "nope" },
      ]),
    ).toThrow(/op #1 \(delete_segment\): segment "nope" not found/);
    expect(() => applyOps(t, [{ op: "trim_segment", segmentId: "seg_1", sourceEndMs: 50_000 }])).toThrow(EditOpError);
  });

  it("censor/uncensor words and re-derives bleeps", () => {
    const t = fixtureTimeline();
    const un = applyOps(t, [{ op: "uncensor_word", wordId: "w7" }]).timeline;
    expect(un.audio.events).toHaveLength(0);
    const c = applyOps(un, [{ op: "censor_word", wordId: "w0", audio: "mute" }]).timeline;
    expect(c.audio.events.map((e) => [e.wordId, e.type])).toEqual([["w0", "mute"]]);
  });

  it("caption style, emphasis and blur ops", () => {
    const t = fixtureTimeline();
    const r = applyOps(t, [
      { op: "set_caption_style", patch: { fontSizePx: 90, highlightColor: "#FF0000" } },
      { op: "edit_caption_word", wordId: "w2", emphasis: true },
      {
        op: "add_blur",
        region: { id: "b1", kind: "logo", label: "logo", sourceStartMs: 0, sourceEndMs: 2000, keyframes: [{ tMs: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] },
      },
      { op: "update_blur", id: "b1", patch: { effect: { type: "pixelate", strength: 50 } } },
    ]).timeline;
    expect(r.style.resolved.captions.fontSizePx).toBe(90);
    expect(r.blurs[0]!.effect.type).toBe("pixelate");
    expect(r.captions.cues.flatMap((c) => c.words).find((w) => w.wordId === "w2")!.emphasis).toBe(true);
  });

  it("set_reframe replaces overlapped parts of other tracks", () => {
    const t = fixtureTimeline();
    const kf = (tMs: number, cx: number) => ({ tMs, cx, cy: 0.5, zoom: 1 });
    let r = applyOps(t, [{ op: "set_reframe", track: { id: "r1", sourceStartMs: 0, sourceEndMs: 10000, mode: "track", keyframes: [kf(0, 0.3), kf(9000, 0.4)] } }]).timeline;
    r = applyOps(r, [{ op: "set_reframe", track: { id: "r2", sourceStartMs: 4000, sourceEndMs: 6000, mode: "fixed", keyframes: [kf(4000, 0.7)] } }]).timeline;
    expect(r.reframe.map((x) => [x.id, x.sourceStartMs, x.sourceEndMs])).toEqual([
      ["r1", 0, 4000],
      ["r2", 4000, 6000],
      ["r1_b", 6000, 10000],
    ]);
  });

  it("set_reframe_mode: fixed crop and blurred fill replace speaker tracks", () => {
    const t = fixtureTimeline();
    const fixed = applyOps(t, [{ op: "set_reframe_mode", mode: "fixed", cx: 0.3 }]).timeline;
    expect(fixed.reframe).toMatchObject([{ mode: "fixed", sourceStartMs: 0, sourceEndMs: 10000, keyframes: [{ cx: 0.3 }] }]);
    expect(applyOps(fixed, [{ op: "set_reframe_mode", mode: "fit_blur_bg" }]).timeline.reframe[0]!.mode).toBe("fit_blur_bg");
    expect(() => applyOps(t, [{ op: "set_reframe_mode", mode: "track" }])).toThrow(/tracking data/);
  });

  it("property: any sequence of ops yields a valid timeline or a clean EditOpError", () => {
    const base = fixtureTimeline();
    const opArb: fc.Arbitrary<EditOpInput> = fc.oneof(
      fc.record({ op: fc.constant("trim_segment" as const), segmentId: fc.constantFrom("seg_1", "seg_1b", "x"), sourceStartMs: fc.integer({ min: 0, max: 12000 }) }),
      fc.record({ op: fc.constant("split_segment" as const), segmentId: fc.constantFrom("seg_1", "seg_1b"), atSourceMs: fc.integer({ min: 0, max: 10000 }) }),
      fc.record({ op: fc.constant("delete_segment" as const), segmentId: fc.constantFrom("seg_1", "seg_1b", "seg_1b2") }),
      fc.record({ op: fc.constant("censor_word" as const), wordId: fc.constantFrom("w0", "w3", "w7", "w99") }),
      fc.record({ op: fc.constant("uncensor_word" as const), wordId: fc.constantFrom("w0", "w7") }),
      fc.record({ op: fc.constant("regroup_captions" as const), maxWordsPerLine: fc.integer({ min: 1, max: 6 }) }),
      fc.record({
        op: fc.constant("add_overlay" as const),
        overlay: fc.record({ id: fc.constantFrom("z1", "z2"), type: fc.constant("zoom" as const), outputStartMs: fc.integer({ min: 0, max: 9000 }), outputEndMs: fc.integer({ min: 0, max: 11000 }), scale: fc.double({ min: 1, max: 3, noNaN: true }), easing: fc.constant("punch" as const) }),
      }),
    );
    fc.assert(
      fc.property(fc.array(fc.array(opArb, { minLength: 1, maxLength: 3 }), { maxLength: 6 }), (batches) => {
        let t = base;
        for (const ops of batches) {
          try {
            t = applyOps(t, ops).timeline;
          } catch (e) {
            if (!(e instanceof EditOpError)) throw e;
          }
          expect(validateTimeline(t).ok).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});
