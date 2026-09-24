import { clips } from "@editor/db";
import { z } from "zod";
import { body, route } from "@/lib/api";
import { enqueueJob, maybeLearnStyle } from "@editor/jobs";
import { recordFeedback } from "@/lib/feedback";

const ReviewReq = z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().max(500).optional() });

/** Approve / reject a proposed clip. Recorded as feedback for style learning. */
export const POST = route<{ id: string }>(async (req, { sb, user }, { id }) => {
  const b = await body(req, ReviewReq);
  const clip = await clips.update(sb, id, { status: b.decision === "approve" ? "approved" : "rejected" });
  await recordFeedback(sb, {
    userId: user.id,
    clip,
    kind: b.decision,
    area: "clip_selection",
    userText: b.reason ?? null,
    scope: "always",
  });
  await maybeLearnStyle(sb, user.id, clip.projectId, (type, input, projectId) => enqueueJob({ userId: user.id, projectId, type, input }));
  return { clip };
});
