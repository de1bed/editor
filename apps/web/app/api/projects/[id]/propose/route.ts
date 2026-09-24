import { assets, transcripts } from "@editor/db";
import { enqueueJob } from "@editor/jobs";
import { z } from "zod";
import { body, HttpError, route } from "@/lib/api";

const ProposeReq = z.object({ count: z.int().min(1).max(20).default(5) });

/** Asks the LLM for (more) clip proposals. Each click is a new run. */
export const POST = route<{ id: string }>(async (req, { sb, user }, { id }) => {
  const b = await body(req, ProposeReq);
  const source = (await assets.listForProject(sb, id)).find((a) => a.kind === "source");
  if (!source || !(await transcripts.forAsset(sb, source.id))) throw new HttpError(409, "La transcripción todavía no está lista");
  const job = await enqueueJob({ userId: user.id, projectId: id, type: "select_moments", input: { projectId: id, assetId: source.id, count: b.count, run: crypto.randomUUID() } });
  return { job };
});
