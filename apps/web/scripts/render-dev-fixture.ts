/**
 * Renders the fixture timeline WITHOUT captions into public/dev-fixture/ so
 * /dev/player can show JASSUB drawing the captions live (development only).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compileTimeline } from "@editor/core";
import { executeRenderPlan } from "@editor/render";
import { Timeline } from "@editor/schemas";

const root = join(import.meta.dirname, "..", "..", "..");
const timeline = Timeline.parse(JSON.parse(readFileSync(join(root, "fixtures/plans/sample.timeline.json"), "utf8")));
const plan = compileTimeline(timeline, { quality: "preview", inputSize: { width: 640, height: 360 }, captions: "none" });
const out = join(import.meta.dirname, "..", "public", "dev-fixture");
mkdirSync(out, { recursive: true });
await executeRenderPlan(plan, { resolveInput: () => join(root, "fixtures/video/sample_10s.mp4"), outputPath: join(out, "preview.mp4") });
// VP9 copy: Playwright's Chromium has no H.264 decoder (used by the browser smoke test).
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", join(out, "preview.mp4"), "-c:v", "libvpx-vp9", "-b:v", "600k", "-c:a", "libopus", join(out, "preview.webm")]);
console.log("wrote public/dev-fixture/preview.{mp4,webm}");
