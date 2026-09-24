import { assets } from "@editor/db";
import { enqueueJob } from "@editor/jobs";
import { HttpError, route } from "@/lib/api";

/** Upload finished → ingest (proxy, audio) → transcription. */
export const POST = route<{ id: string }>(async (_req, { sb, user }, { id }) => {
  const asset = await assets.get(sb, id); // RLS: only the owner sees it
  if (asset.kind !== "source") throw new HttpError(400, "Solo los archivos fuente se procesan");
  const { data, error } = await sb.storage.from(asset.bucket).list(asset.path.split("/").slice(0, -1).join("/"), { search: asset.path.split("/").pop() });
  if (error || !data?.length) throw new HttpError(409, "El archivo todavía no está en el almacenamiento");
  await assets.update(sb, id, { status: "uploaded" });
  const job = await enqueueJob({ userId: user.id, projectId: asset.projectId, type: "ingest", input: { assetId: id } });
  return { job };
});
