import { assets, paths, projects } from "@editor/db";
import type { JobHandler } from "../context";
import { mediaRef, ref, str } from "./common";

/** Source upload → probe, CFR proxy, 16 kHz audio, thumbnail → transcribe. */
export const ingest: JobHandler = async (ctx, input) => {
  const assetId = str(input, "assetId");
  const source = await assets.get(ctx.db, assetId);
  const { userId, projectId } = source;
  await projects.update(ctx.db, projectId, { status: "processing" });
  await ctx.progress(0.01, "ingest");

  const proxyPath = paths.proxy(userId, projectId, assetId);
  const audioPath = paths.audio(userId, projectId, assetId);
  const thumbPath = paths.thumb(userId, projectId, assetId);
  const res = await ctx.media.ingest({
    jobId: ctx.job.id,
    source: ref(source),
    proxyOut: mediaRef(proxyPath),
    audioOut: mediaRef(audioPath),
    thumbOut: mediaRef(thumbPath),
    proxyHeight: 720,
  });

  await assets.update(ctx.db, assetId, {
    status: "ready",
    bytes: res.probe.bytes,
    durationMs: res.probe.durationMs,
    width: res.probe.width,
    height: res.probe.height,
    fps: res.probe.fps,
    hasAudio: res.probe.hasAudio,
    probe: res.probe,
  });
  const common = { userId, projectId, parentAssetId: assetId, bucket: source.bucket };
  const proxy = await assets.upsertDerived(ctx.db, {
    ...common,
    kind: "proxy",
    path: proxyPath,
    bytes: res.proxy.bytes,
    mimeType: "video/mp4",
    meta: { durationMs: res.probe.durationMs, width: res.proxy.width, height: res.proxy.height, hasAudio: true },
  });
  await assets.upsertDerived(ctx.db, { ...common, kind: "audio", path: audioPath, bytes: res.audioBytes, mimeType: "audio/wav", meta: { durationMs: res.probe.durationMs } });
  await assets.upsertDerived(ctx.db, { ...common, kind: "thumb", path: thumbPath, bytes: res.thumbBytes, mimeType: "image/jpeg" });

  const next = await ctx.enqueue("transcribe", { assetId });
  return { probe: res.probe, proxyAssetId: proxy.id, transcribeJobId: next.id };
};
