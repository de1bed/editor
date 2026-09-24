import { jobs } from "@editor/db";
import { route } from "@/lib/api";

export const POST = route<{ id: string }>(async (_req, { sb }, { id }) => {
  await jobs.get(sb, id);
  await jobs.cancel(sb, id);
  return { ok: true };
});
