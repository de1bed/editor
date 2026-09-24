/**
 * Writes TS-produced fixtures consumed by the Python tests (schema parity and
 * render parity): a Timeline and the RenderPlan compiled from it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Transcript, defaultStyleSettings } from "@editor/schemas";
import { applyOps, buildTimeline, compileTimeline } from "@editor/core";

const transcript = Transcript.parse(JSON.parse(readFileSync("fixtures/transcripts/sample_10s.json", "utf8")));
let timeline = buildTimeline({
  id: "tl_fixture",
  projectId: "proj_fixture",
  clipId: "clip_fixture",
  source: { assetId: "fixture_sample_10s", durationMs: 10_000, width: 640, height: 360, fps: { num: 30, den: 1 } },
  transcript,
  ranges: [
    { startMs: 500, endMs: 2500 },
    { startMs: 3500, endMs: 6000 },
  ],
  style: defaultStyleSettings(),
  styleProfileVersionId: null,
  snapToWords: false,
});
timeline = applyOps(timeline, [
  {
    op: "add_blur",
    region: { id: "b1", kind: "face", label: "cara", sourceStartMs: 500, sourceEndMs: 6000, keyframes: [{ tMs: 500, x: 0.4, y: 0.2, w: 0.2, h: 0.3 }, { tMs: 6000, x: 0.45, y: 0.25, w: 0.2, h: 0.3 }] },
  },
  { op: "add_overlay", overlay: { id: "z1", type: "zoom", outputStartMs: 1000, outputEndMs: 2000, scale: 1.15, easing: "punch" } },
  { op: "add_overlay", overlay: { id: "h1", type: "text", outputStartMs: 0, outputEndMs: 1500, text: "Lo que pasó ayer…", style: "hook", position: "top" } },
]).timeline;
const plan = compileTimeline(timeline, { quality: "preview", inputSize: { width: 640, height: 360 } });
writeFileSync("fixtures/plans/sample.timeline.json", JSON.stringify(timeline, null, 2) + "\n");
writeFileSync("fixtures/plans/sample.plan.json", JSON.stringify(plan, null, 2) + "\n");
console.log(`plan ${plan.hash.slice(0, 12)} → ${plan.output.width}x${plan.output.height}, ${plan.output.durationMs} ms`);
