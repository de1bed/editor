import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Transcript, defaultStyleSettings, type Timeline } from "@editor/schemas";
import { buildTimeline } from "../src/build-timeline";

export const FIXTURE_TRANSCRIPT = Transcript.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/transcripts/sample_10s.json", import.meta.url)), "utf8")),
);

export const FIXTURE_SOURCE: Timeline["source"] = {
  assetId: "fixture_sample_10s",
  durationMs: 10_000,
  width: 640,
  height: 360,
  fps: { num: 30, den: 1 },
};

export function fixtureTimeline(ranges = [{ startMs: 0, endMs: 10_000 }]): Timeline {
  return buildTimeline({
    id: "tl_test",
    projectId: "proj_test",
    clipId: "clip_test",
    source: FIXTURE_SOURCE,
    transcript: FIXTURE_TRANSCRIPT,
    ranges,
    style: defaultStyleSettings(),
    styleProfileVersionId: null,
  });
}
