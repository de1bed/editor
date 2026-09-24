import { assets, transcripts } from "@editor/db";
import { HttpError, route } from "@/lib/api";

export const GET = route<{ id: string }>(async (_req, { sb }, { id }) => {
  const source = (await assets.listForProject(sb, id)).find((a) => a.kind === "source");
  if (!source) throw new HttpError(404, "El proyecto no tiene archivo fuente");
  const transcript = await transcripts.forAsset(sb, source.id);
  if (!transcript) throw new HttpError(404, "Transcripción no disponible todavía");
  return { transcript, sourceAssetId: source.id };
});
