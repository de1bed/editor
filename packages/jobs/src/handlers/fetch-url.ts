import { assets, MEDIA_BUCKET, paths, projects } from "@editor/db";
import type { JobHandler } from "../context";
import { str } from "./common";

/** YouTube link (feature flag) → source file in storage → ingest. */
export const fetchUrl: JobHandler = async (ctx, input) => {
  const projectId = str(input, "projectId");
  const url = str(input, "url");
  const project = await projects.get(ctx.db, projectId);
  const assetId = crypto.randomUUID();
  const path = paths.source(project.userId, projectId, assetId, "video.mp4");
  const res = await ctx.media.fetchUrl({ jobId: ctx.job.id, url, out: { bucket: MEDIA_BUCKET, path }, maxHeight: 1080 });
  await assets.create(ctx.db, {
    id: assetId,
    userId: project.userId,
    projectId,
    kind: "source",
    bucket: MEDIA_BUCKET,
    path,
    status: "uploaded",
    originalFilename: `${res.title || "video"}.mp4`,
    mimeType: res.mimeType,
    bytes: res.bytes,
  });
  const next = await ctx.enqueue("ingest", { assetId });
  return { assetId, title: res.title, ingestJobId: next.id };
};
