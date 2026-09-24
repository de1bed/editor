import type { BlurRegion, DetectionTrack, Timeline } from "@editor/schemas";
import { assets, clips, detections, timelines } from "@editor/db";
import { PermanentJobError, type JobContext, type JobHandler } from "../context";
import { ref, str } from "./common";

type Kind = BlurRegion["kind"];
const KINDS: Kind[] = ["face", "plate", "logo", "screen", "custom"];

/** Natural-language object detection over a clip ("el logo de la gorra") → stored tracks. */
export const detectObjectsJob: JobHandler = async (ctx, input) => {
  const clipId = str(input, "clipId");
  const query = str(input, "query");
  const kind = (input.kind as Kind) ?? "custom";
  if (!KINDS.includes(kind)) throw new PermanentJobError(`unknown kind ${kind}`);
  if (!ctx.media.capabilities.detect) throw new PermanentJobError("La detección de objetos necesita el worker GPU (MEDIA_WORKER=modal)");
  const clip = await clips.get(ctx.db, clipId);
  const { timeline } = await timelines.get(ctx.db, clipId);
  const tracks = await detectInTimeline(ctx, timeline, query, kind);
  const ids = await detections.insertMany(ctx.db, clip.userId, ctx.job.id, tracks);
  return { count: ids.length, trackIds: ids };
};

export async function detectInTimeline(ctx: JobContext, t: Timeline, query: string, kind: Kind): Promise<DetectionTrack[]> {
  const proxyId = t.source.proxyAssetId;
  const video = proxyId ? await assets.get(ctx.db, proxyId) : await assets.get(ctx.db, t.source.assetId);
  const startMs = Math.min(...t.segments.map((s) => s.sourceStartMs));
  const endMs = Math.max(...t.segments.map((s) => s.sourceEndMs));
  const res = await ctx.media.detectObjects({
    jobId: ctx.job.id,
    assetId: t.source.assetId,
    video: ref(video),
    query,
    kind,
    startMs,
    endMs,
    sampleFps: kind === "face" ? 5 : 4,
    tracker: "sam2",
    boxThreshold: kind === "custom" ? 0.3 : 0.35,
    maskOut: null,
  });
  // Only keep tracks that overlap a kept segment.
  return res.tracks.filter((d) => t.segments.some((s) => d.startMs < s.sourceEndMs && d.endMs > s.sourceStartMs));
}

/** Default detector queries for the style profile's auto-blur switches. */
export const AUTO_BLUR_QUERIES: Record<"faces" | "plates" | "screens" | "logos", { kind: Kind; query: string }> = {
  faces: { kind: "face", query: "face" },
  plates: { kind: "plate", query: "license plate" },
  screens: { kind: "screen", query: "screen" },
  logos: { kind: "logo", query: "logo" },
};
