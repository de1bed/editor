import { timelineToAss } from "@editor/core";
import { assets, clips, renders, signedUrl, timelines } from "@editor/db";
import { route } from "@/lib/api";

/** Everything the clip editor needs: clip, current timeline, captions (ASS) and latest renders with URLs. */
export const GET = route<{ id: string }>(async (_req, { sb }, { id }) => {
  const clip = await clips.get(sb, id);
  let timeline = null;
  let ass: string | null = null;
  try {
    timeline = (await timelines.get(sb, id)).timeline;
    ass = timelineToAss(timeline);
  } catch {
    // timeline not built yet
  }
  const list = await renders.list(sb, id);
  const withUrls = await Promise.all(
    list.slice(0, 10).map(async (r) => {
      if (r.status !== "succeeded" || !r.assetId) return { ...r, url: null };
      const a = await assets.get(sb, r.assetId);
      return { ...r, url: await signedUrl(sb, { bucket: a.bucket, path: a.path }, 3600) };
    }),
  );
  return { clip, timeline, ass, renders: withUrls };
});
