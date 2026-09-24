import { buildTimeline, planReframe } from "@editor/core";
import { assets, clips, projects, timelines, transcripts } from "@editor/db";
import { PermanentJobError, type JobHandler } from "../context";
import { projectStyle, ref, str } from "./common";

/** Clip range + transcript + style (+ face analysis) → Timeline v0 → preview render. */
export const buildTimelineJob: JobHandler = async (ctx, input) => {
  const clipId = str(input, "clipId");
  const clip = await clips.get(ctx.db, clipId);
  const source = await assets.get(ctx.db, clip.sourceAssetId);
  const proxy = await assets.derived(ctx.db, source.id, "proxy");
  const transcript = await transcripts.forAsset(ctx.db, source.id);
  if (!transcript) throw new PermanentJobError("no transcript for this source yet");
  if (!source.durationMs || !source.width || !source.height) throw new PermanentJobError("source not ingested");
  const style = await projectStyle(ctx.db, clip.projectId);
  await projects.get(ctx.db, clip.projectId);

  // Active-speaker reframing (needs the GPU worker; without it the crop stays centered).
  let reframe: ReturnType<typeof planReframe> = [];
  if (ctx.media.capabilities.faces && proxy) {
    await ctx.progress(0.1, "faces");
    const turns = speakerTurns(transcript.words, clip.sourceStartMs, clip.sourceEndMs);
    const analysis = await ctx.media.analyzeFaces({
      jobId: ctx.job.id,
      assetId: source.id,
      video: ref(proxy),
      startMs: clip.sourceStartMs,
      endMs: clip.sourceEndMs,
      sampleFps: 5,
      speakerTurns: turns,
    });
    reframe = planReframe(analysis, {
      startMs: clip.sourceStartMs,
      endMs: clip.sourceEndMs,
      turns,
      outputAspect: 9 / 16,
      sourceAspect: source.width / source.height,
      settings: style.settings.reframe,
    });
  }

  await ctx.progress(0.7, "timeline");
  const timeline = buildTimeline({
    id: `tl_${clipId}`,
    projectId: clip.projectId,
    clipId,
    source: {
      assetId: source.id,
      ...(proxy ? { proxyAssetId: proxy.id } : {}),
      durationMs: source.durationMs,
      width: source.width,
      height: source.height,
      fps: source.fps ?? { num: 30, den: 1 },
    },
    transcript,
    ranges: [{ startMs: clip.sourceStartMs, endMs: clip.sourceEndMs }],
    style: style.settings,
    styleProfileVersionId: style.id,
    reframe,
    meta: {
      title: clip.title,
      createdBy: clip.createdBy,
      ...(clip.justification ? { justification: clip.justification } : {}),
    },
  });
  await timelines.insertInitial(ctx.db, { userId: clip.userId, clipId, timeline });
  const render = await ctx.enqueue("render_preview", { clipId, version: 0 });
  return { version: 0, cues: timeline.captions.cues.length, reframeTracks: reframe.length, renderJobId: render.id };
};

/** Contiguous runs of the same speaker inside a range (from word-level diarization). */
export function speakerTurns(words: { speaker: string | null; startMs: number; endMs: number }[], startMs: number, endMs: number) {
  const turns: { speaker: string; startMs: number; endMs: number }[] = [];
  for (const w of words) {
    if (!w.speaker || w.endMs <= startMs || w.startMs >= endMs) continue;
    const last = turns[turns.length - 1];
    if (last && last.speaker === w.speaker && w.startMs - last.endMs < 1500) last.endMs = Math.max(last.endMs, w.endMs);
    else turns.push({ speaker: w.speaker, startMs: w.startMs, endMs: w.endMs });
  }
  return turns;
}
