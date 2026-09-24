import { jobs, serviceClient } from "@editor/db";
import { enqueueJob } from "@editor/jobs";
import { HttpError, route } from "@/lib/api";

export const POST = route<{ id: string }>(async (_req, { sb, user }, { id }) => {
  const job = await jobs.get(sb, id); // RLS check
  if (job.status !== "failed" && job.status !== "canceled") throw new HttpError(409, "Solo se reintentan trabajos fallidos o cancelados");
  const again = await enqueueJob({ db: serviceClient(), userId: user.id, projectId: job.projectId, type: job.type, input: job.input, idempotencyKey: job.idempotencyKey });
  return { job: again };
});
