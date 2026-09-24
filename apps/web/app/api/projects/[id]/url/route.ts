import { projects } from "@editor/db";
import { enqueueJob } from "@editor/jobs";
import { z } from "zod";
import { body, HttpError, route } from "@/lib/api";

const UrlReq = z.object({ url: z.url().max(500), confirmRights: z.literal(true, { message: "Debes confirmar que tienes derechos sobre el contenido" }) });

const ALLOWED_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"];

export const POST = route<{ id: string }>(async (req, { sb, user }, { id }) => {
  if (process.env.NEXT_PUBLIC_FEATURE_YOUTUBE_INGEST !== "true") throw new HttpError(404, "Función desactivada");
  const b = await body(req, UrlReq);
  const host = new URL(b.url).hostname.toLowerCase();
  if (!ALLOWED_HOSTS.includes(host)) throw new HttpError(400, "Solo se admiten enlaces de YouTube");
  const project = await projects.get(sb, id);
  await projects.update(sb, id, { status: "uploading" });
  const job = await enqueueJob({ userId: user.id, projectId: project.id, type: "fetch_url", input: { projectId: project.id, url: b.url, rightsConfirmedAt: new Date().toISOString() } });
  return { job };
});
