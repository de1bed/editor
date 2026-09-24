import { describe, expect, it } from "vitest";
import { compileTimeline, piecewiseExpr, reframeForSegment, simplify } from "../src/compile";
import { fixtureTimeline } from "./helpers";

const opts = { quality: "preview" as const, inputSize: { width: 640, height: 360 } };

describe("compileTimeline", () => {
  it("is deterministic and hashes the plan", () => {
    const a = compileTimeline(fixtureTimeline(), opts);
    const b = compileTimeline(fixtureTimeline(), opts);
    expect(a).toEqual(b);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(compileTimeline(fixtureTimeline(), { ...opts, quality: "final" }).hash).not.toBe(a.hash);
  });

  it("uses one seeked input per segment and preview size", () => {
    const t = fixtureTimeline([
      { startMs: 1000, endMs: 3000 },
      { startMs: 6000, endMs: 8000 },
    ]);
    const plan = compileTimeline(t, opts);
    expect(plan.args.filter((x) => x === "{{input:src}}")).toHaveLength(2);
    expect(plan.output).toMatchObject({ width: 540, height: 960, fps: 30 });
    const fc = plan.args[plan.args.indexOf("-filter_complex") + 1]!;
    expect(fc).toContain("concat=n=2:v=1:a=1");
    expect(fc).toContain("ass=filename='{{file:captions.ass}}'");
    expect(plan.files["captions.ass"]).toContain("[Events]");
  });

  it("can leave captions out (live overlay in the editor) so caption edits reuse the render", async () => {
    const { applyOps } = await import("../src/apply-ops");
    const t = fixtureTimeline();
    const a = compileTimeline(t, { ...opts, captions: "none" });
    expect(a.files).toEqual({});
    expect(a.args.join(" ")).not.toContain("ass=");
    const restyled = applyOps(t, [{ op: "set_caption_style", patch: { fontSizePx: 99 } }]).timeline;
    expect(compileTimeline(restyled, { ...opts, captions: "none" }).hash).toBe(a.hash);
    expect(compileTimeline(restyled, opts).hash).not.toBe(compileTimeline(t, opts).hash);
  });

  it("adds bleeps for censored words", () => {
    const fc = compileTimeline(fixtureTimeline(), opts).args.find((a) => a.includes("concat="))!;
    expect(fc).toMatch(/sine=frequency=1000/);
    expect(fc).toMatch(/volume=0:enable='between\(t,3\.960,4\.440\)'/);
  });
});

describe("expressions", () => {
  it("builds piecewise linear expressions", () => {
    const e = piecewiseExpr([{ tMs: 0, v: 0.2 }, { tMs: 1000, v: 0.8 }], "linear", 500);
    expect(e).toBe("if(lt((t+0.500),0.000),0.2,if(lt((t+0.500),1.000),(0.2+(0.6)*(((t+0.500)-0.000)/(1.000-0.000))),0.8))");
    expect(piecewiseExpr([{ tMs: 0, v: 0.3 }], "linear", 0)).toBe("0.3");
  });
  it("simplifies collinear keyframes but keeps jumps", () => {
    const pts = [0, 100, 200, 300].map((t) => ({ tMs: t, v: t / 1000 }));
    expect(simplify(pts, 0.001)).toHaveLength(2);
    const jump = [{ tMs: 0, v: 0.2 }, { tMs: 999, v: 0.2 }, { tMs: 1000, v: 0.8 }, { tMs: 2000, v: 0.8 }];
    expect(simplify(jump, 0.001)).toHaveLength(4);
  });
  it("defaults to a centered crop without reframe tracks", () => {
    const r = reframeForSegment([], { id: "s", sourceStartMs: 0, sourceEndMs: 1000, speed: 1 }, "track");
    expect(r).toMatchObject({ mode: "fixed", points: [{ cx: 0.5, cy: 0.5 }] });
  });
});
