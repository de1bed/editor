import { compileTimeline } from "@editor/core";
import { assets, clips, paths, renders, timelines } from "@editor/db";
import { PermanentJobError, type JobHandler } from "../context";
import { int, mediaRef, ref, str } from "./common";

/** Timeline version → RenderPlan → MP4. Cached by plan hash: identical plans are not re-rendered. */
export function renderJob(quality: "preview" | "final"): JobHandler {
  return async (ctx, input) => {
    const clipId = str(input, "clipId");
    const clip = await clips.get(ctx.db, clipId);
    const version = int(input, "version", clip.currentVersion);
    const { timeline } = await timelines.get(ctx.db, clipId, version);
    const source = await assets.get(ctx.db, timeline.source.assetId);
    const proxy = timeline.source.proxyAssetId ? await assets.get(ctx.db, timeline.source.proxyAssetId) : null;
    const decoded = quality === "preview" && proxy ? proxy : source;
    if (!decoded.width || !decoded.height) throw new PermanentJobError("input video has no known size");

    const plan = compileTimeline(timeline, {
      quality,
      inputSize: { width: decoded.width, height: decoded.height },
      inputHasAudio: decoded.kind === "proxy" ? true : (source.hasAudio ?? true),
    });

    const existing = await renders.findByHash(ctx.db, clipId, plan.hash);
    if (existing?.status === "succeeded" && existing.assetId) {
      return { renderId: existing.id, assetId: existing.assetId, cached: true };
    }
    const row = await renders.upsert(ctx.db, { userId: clip.userId, clipId, timelineVersion: version, quality, planHash: plan.hash, jobId: ctx.job.id });
    await renders.update(ctx.db, row.id, { status: "running" });

    const inputs: Record<string, { bucket: string; path: string }> = {};
    for (const [key, inp] of Object.entries(plan.inputs)) {
      if (key === "src") inputs[key] = ref(decoded);
      else inputs[key] = ref(await assets.get(ctx.db, inp.assetId));
    }
    const out = mediaRef(paths.render(clip.userId, clip.projectId, clipId, plan.hash));
    try {
      const res = await ctx.media.render({ jobId: ctx.job.id, plan, inputs, out });
      const asset = await assets.upsertDerived(ctx.db, {
        userId: clip.userId,
        projectId: clip.projectId,
        kind: "render",
        bucket: out.bucket,
        path: out.path,
        parentAssetId: source.id,
        bytes: res.bytes,
        mimeType: "video/mp4",
        meta: { durationMs: res.durationMs, width: plan.output.width, height: plan.output.height, hasAudio: true },
      });
      await renders.update(ctx.db, row.id, { status: "succeeded", assetId: asset.id, error: null });
      return { renderId: row.id, assetId: asset.id, planHash: plan.hash, durationMs: res.durationMs };
    } catch (e) {
      await renders.update(ctx.db, row.id, { status: "failed", error: e instanceof Error ? e.message.slice(0, 4000) : String(e) });
      throw e;
    }
  };
}
