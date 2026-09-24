import { clips } from "@editor/db";
import { enqueueJob } from "@editor/jobs";
import { z } from "zod";
import { body, route } from "@/lib/api";

const RenderReq = z.object({ quality: z.enum(["preview", "final"]), version: z.int().nonnegative().optional() });

export const POST = route<{ id: string }>(async (req, { sb, user }, { id }) => {
  const b = await body(req, RenderReq);
  const clip = await clips.get(sb, id);
  const version = b.version ?? clip.currentVersion;
  const job = await enqueueJob({
    userId: user.id,
    projectId: clip.projectId,
    type: b.quality === "final" ? "render_final" : "render_preview",
    input: { clipId: id, version },
  });
  return { job };
});
