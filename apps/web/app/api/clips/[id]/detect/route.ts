import { clips } from "@editor/db";
import { enqueueJob } from "@editor/jobs";
import { z } from "zod";
import { body, route } from "@/lib/api";

const DetectReq = z.object({ query: z.string().trim().min(2).max(200), kind: z.enum(["face", "plate", "logo", "screen", "custom"]).default("custom") });

/** "blurea el logo de la gorra" → open-vocabulary detection over the clip. */
export const POST = route<{ id: string }>(async (req, { sb, user }, { id }) => {
  const b = await body(req, DetectReq);
  const clip = await clips.get(sb, id);
  const job = await enqueueJob({ userId: user.id, projectId: clip.projectId, type: "detect_objects", input: { clipId: id, query: b.query, kind: b.kind, version: clip.currentVersion } });
  return { job };
});
