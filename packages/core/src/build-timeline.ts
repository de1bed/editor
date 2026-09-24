import {
  type ClipScores,
  type ReframeTrack,
  type StyleSettings,
  TIMELINE_SCHEMA_VERSION,
  type Timeline,
  type Transcript,
  type Word,
} from "@editor/schemas";
import { groupOptionsFromStyle, groupWordsIntoCues, wordsInRange } from "./captions";
import { applyCensorship } from "./censor";
import { validateTimeline } from "./validate";

export interface BuildTimelineInput {
  id: string;
  projectId: string;
  clipId: string;
  source: Timeline["source"];
  transcript: Transcript;
  /** Source ranges to keep, in output order. */
  ranges: { startMs: number; endMs: number }[];
  style: StyleSettings;
  styleProfileVersionId: string | null;
  /** Move range edges to word boundaries so no word is cut in half. */
  snapToWords?: boolean;
  reframe?: ReframeTrack[];
  meta?: { title?: string; hookText?: string; justification?: string; scores?: ClipScores; createdBy?: "llm" | "user" | "system" };
}

const LEAD_MS = 80;
const TAIL_MS = 200;

/** Builds a valid Timeline for a clip from transcript ranges and a style. */
export function buildTimeline(input: BuildTimelineInput): Timeline {
  const { source, transcript, style } = input;
  const ranges = input.ranges
    .map((r) => (input.snapToWords === false ? r : snapRange(transcript.words, r, source.durationMs)))
    .filter((r) => r.endMs > r.startMs);
  if (ranges.length === 0) throw new Error("buildTimeline: no non-empty ranges");

  const segments = ranges.map((r, i) => ({ id: `seg_${i + 1}`, sourceStartMs: r.startMs, sourceEndMs: r.endMs, speed: 1 as const }));

  const words = ranges.flatMap((r) => wordsInRange(transcript.words, r.startMs, r.endMs));
  const uniqueWords = [...new Map(words.map((w) => [w.id, w])).values()].sort((a, b) => a.startMs - b.startMs);
  const cues = groupWordsIntoCues(uniqueWords, groupOptionsFromStyle(style.captions)).map((c) => ({
    ...c,
    // Cues cannot extend beyond the source.
    sourceEndMs: Math.min(c.sourceEndMs, source.durationMs),
  }));

  let timeline: Timeline = {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: input.id,
    projectId: input.projectId,
    clipId: input.clipId,
    version: 0,
    source,
    output: { width: 1080, height: 1920, fps: 30 },
    style: { styleProfileVersionId: input.styleProfileVersionId, resolved: style },
    meta: {
      title: input.meta?.title ?? "",
      createdBy: input.meta?.createdBy ?? "system",
      ...(input.meta?.hookText ? { hookText: input.meta.hookText } : {}),
      ...(input.meta?.justification ? { justification: input.meta.justification } : {}),
      ...(input.meta?.scores ? { scores: input.meta.scores } : {}),
    },
    segments,
    reframe: input.reframe ?? [],
    captions: { enabled: true, cues },
    blurs: [],
    audio: { masterGainDb: 0, events: [], music: [] },
    overlays: [],
  };
  timeline = applyCensorship(timeline);

  const v = validateTimeline(timeline);
  if (!v.ok) throw new Error(`buildTimeline produced an invalid timeline:\n${v.errors.join("\n")}`);
  return v.timeline;
}

/** Expand a range to include whole words at both edges, plus a little air. */
export function snapRange(words: readonly Word[], r: { startMs: number; endMs: number }, durationMs: number) {
  let start = r.startMs;
  let end = r.endMs;
  for (const w of words) {
    if (w.startMs < start && w.endMs > start) start = w.startMs;
    if (w.startMs < end && w.endMs > end) end = w.endMs;
  }
  return { startMs: Math.max(0, start - LEAD_MS), endMs: Math.min(durationMs, end + TAIL_MS) };
}
