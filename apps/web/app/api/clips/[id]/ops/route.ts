import { applyOps, EditOpError } from "@editor/core";
import { clips, DbError, timelines } from "@editor/db";
import { enqueueJob } from "@editor/jobs";
import { EditOp } from "@editor/schemas";
import { z } from "zod";
import { body, HttpError, route } from "@/lib/api";

const OpsReq = z.object({ ops: z.array(EditOp).min(1).max(100), expectedVersion: z.int().nonnegative() });

/** Manual edits from the UI: typed ops → new timeline version → preview render. */
export const POST = route<{ id: string }>(async (req, { sb, user }, { id }) => {
  const b = await body(req, OpsReq);
  const clip = await clips.get(sb, id);
  if (clip.currentVersion !== b.expectedVersion) throw new HttpError(409, "El clip cambió mientras editabas; recarga", { currentVersion: clip.currentVersion });
  const { timeline } = await timelines.get(sb, id, clip.currentVersion);
  let result;
  try {
    result = applyOps(timeline, b.ops);
  } catch (e) {
    if (e instanceof EditOpError) throw new HttpError(422, e.message, e.details);
    throw e;
  }
  let version: number;
  try {
    version = await timelines.commit(sb, { clipId: id, expectedVersion: clip.currentVersion, timeline: result.timeline, ops: result.ops, jsonPatch: result.jsonPatch, author: "user" });
  } catch (e) {
    if (e instanceof DbError && e.isConflict) throw new HttpError(409, "Otro cambio se guardó antes; recarga");
    throw e;
  }
  const job = await enqueueJob({ userId: user.id, projectId: clip.projectId, type: "render_preview", input: { clipId: id, version } });
  return { version, job };
});
