import { detections, jobs } from "@editor/db";
import { route } from "@/lib/api";

export const GET = route<{ id: string }>(async (_req, { sb }, { id }) => {
  const job = await jobs.get(sb, id);
  return { job, tracks: job.status === "succeeded" ? await detections.forJob(sb, id) : [] };
});
