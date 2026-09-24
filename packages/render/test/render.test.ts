import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Transcript, defaultStyleSettings, type Timeline } from "@editor/schemas";
import { applyOps, buildTimeline, compileTimeline } from "@editor/core";
import { readFileSync } from "node:fs";
import { executeRenderPlan } from "../src/execute";
import { bandVolumeDb, grayFrame, probe, regionSharpness } from "../src/probe";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/video/sample_10s.mp4", import.meta.url));
const transcript = Transcript.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/transcripts/sample_10s.json", import.meta.url)), "utf8")),
);

function timeline(ranges: { startMs: number; endMs: number }[]): Timeline {
  return buildTimeline({
    id: "tl",
    projectId: "p",
    clipId: "c",
    source: { assetId: "src", durationMs: 10_000, width: 640, height: 360, fps: { num: 30, den: 1 } },
    transcript,
    ranges,
    style: defaultStyleSettings(),
    styleProfileVersionId: null,
    snapToWords: false,
  });
}

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "render-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function render(t: Timeline, quality: "preview" | "final" = "preview") {
  const plan = compileTimeline(t, { quality, inputSize: { width: 640, height: 360 } });
  const out = join(dir, `${plan.hash.slice(0, 12)}.mp4`);
  const progress: number[] = [];
  await executeRenderPlan(plan, { resolveInput: () => FIXTURE, outputPath: out, onProgress: (p) => progress.push(p) });
  return { out, plan, progress };
}

describe("render (ffmpeg integration)", () => {
  it("renders a 9:16 clip with the right duration, size and captions", async () => {
    const t = timeline([
      { startMs: 1000, endMs: 3000 },
      { startMs: 5000, endMs: 7500 },
    ]);
    const { out, progress } = await render(t);
    const p = await probe(out);
    expect(p.width).toBe(540);
    expect(p.height).toBe(960);
    expect(Math.abs(p.durationMs - 4500)).toBeLessThanOrEqual(70);
    expect(p.hasAudio).toBe(true);
    expect(progress.at(-1)).toBeGreaterThan(0.9);
  }, 60_000);

  it("replaces the censored word with a bleep", async () => {
    // Keep 3.0–6.0 s; "mierda" is 4.0–4.4 s source → 1.0–1.4 s output.
    const { out } = await render(timeline([{ startMs: 3000, endMs: 6000 }]));
    const toneDuringWord = await bandVolumeDb(out, 1080, 240, 440);
    const toneElsewhere = await bandVolumeDb(out, 2200, 240, 440);
    const bleepDuringWord = await bandVolumeDb(out, 1080, 240, 1000);
    const bleepElsewhere = await bandVolumeDb(out, 2200, 240, 1000);
    expect(toneElsewhere - toneDuringWord).toBeGreaterThan(25); // source muted
    expect(bleepDuringWord - bleepElsewhere).toBeGreaterThan(25); // bleep present
  }, 60_000);

  it("mutes instead of bleeping when asked", async () => {
    const t = applyOps(timeline([{ startMs: 3000, endMs: 6000 }]), [{ op: "censor_word", wordId: "w7", audio: "mute" }]).timeline;
    const { out } = await render(t);
    expect(await bandVolumeDb(out, 1080, 240, 1000)).toBeLessThan(-60);
    expect(await bandVolumeDb(out, 1080, 240, 440)).toBeLessThan(-60);
  }, 60_000);

  it("blurs a region (edges softened inside, untouched outside)", async () => {
    // Test pattern with no captions so text does not interfere.
    let t = timeline([{ startMs: 0, endMs: 2000 }]);
    t = applyOps(t, [
      { op: "set_captions_enabled", enabled: false },
      {
        op: "add_blur",
        region: {
          id: "b1",
          kind: "custom",
          label: "center",
          sourceStartMs: 0,
          sourceEndMs: 2000,
          keyframes: [{ tMs: 0, x: 0.35, y: 0.3, w: 0.3, h: 0.4 }],
          effect: { type: "gaussian", strength: 80 },
        },
      },
    ]).timeline;
    const plain = timeline([{ startMs: 0, endMs: 2000 }]);
    const noCaptions = applyOps(plain, [{ op: "set_captions_enabled", enabled: false }]).timeline;
    const blurred = await render(t, "final");
    const reference = await render(noCaptions, "final");
    // Output is a 9:16 center crop of the 640x360 source: crop x ∈ [218.75, 421.25].
    // The blur box (x 224–416, y 108–252 in source) maps to output x ≈ 0.03–0.97, y 0.3–0.7.
    const box = { x: 0.1, y: 0.35, w: 0.8, h: 0.3 };
    const sb = regionSharpness(await grayFrame(blurred.out, 1000), box);
    const sr = regionSharpness(await grayFrame(reference.out, 1000), box);
    expect(sb).toBeLessThan(sr * 0.5);
    // Outside the box (top strip) the picture is unchanged.
    const top = { x: 0.1, y: 0.02, w: 0.8, h: 0.2 };
    const ob = regionSharpness(await grayFrame(blurred.out, 1000), top);
    const or = regionSharpness(await grayFrame(reference.out, 1000), top);
    expect(Math.abs(ob - or)).toBeLessThan(or * 0.15 + 0.5);
  }, 90_000);

  it("same timeline → same plan hash (render cache key)", () => {
    const a = compileTimeline(timeline([{ startMs: 0, endMs: 2000 }]), { quality: "preview", inputSize: { width: 640, height: 360 } });
    const b = compileTimeline(timeline([{ startMs: 0, endMs: 2000 }]), { quality: "preview", inputSize: { width: 640, height: 360 } });
    expect(a.hash).toBe(b.hash);
  });
});
