import { clips, timelines } from "@editor/db";
import { enqueueJob } from "@editor/jobs";
import { z } from "zod";
import { body, HttpError, route } from "@/lib/api";

const RevertReq = z.object({ toVersion: z.int().nonnegative(), expectedVersion: z.int().nonnegative() });

/** Undo: the chosen old version becomes a new version (history is never rewritten). */
export const POST = route<{ id: string }>(async (req, { sb, user }, { id }) => {
  const b = await body(req, RevertReq);
  const clip = await clips.get(sb, id);
  if (clip.currentVersion !== b.expectedVersion) throw new HttpError(409, "El clip cambió; recarga");
  if (b.toVersion >= clip.currentVersion) throw new HttpError(400, "Solo se puede volver a una versión anterior");
  const old = await timelines.get(sb, id, b.toVersion);
  const version = await timelines.commit(sb, { clipId: id, expectedVersion: clip.currentVersion, timeline: old.timeline, ops: [], jsonPatch: [], author: "user" });
  const job = await enqueueJob({ userId: user.id, projectId: clip.projectId, type: "render_preview", input: { clipId: id, version } });
  return { version, job };
});
