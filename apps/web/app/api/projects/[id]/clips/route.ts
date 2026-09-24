import { assets, clips, transcripts } from "@editor/db";
import { enqueueJob } from "@editor/jobs";
import { z } from "zod";
import { body, HttpError, route } from "@/lib/api";

const NewClip = z
  .object({ startMs: z.int().nonnegative(), endMs: z.int().positive(), title: z.string().max(200).default("") })
  .refine((c) => c.endMs - c.startMs >= 1000, "El clip debe durar al menos 1 segundo")
  .refine((c) => c.endMs - c.startMs <= 10 * 60_000, "El clip no puede durar más de 10 minutos");

/** Manual clip from a transcript selection → build timeline → preview render. */
export const POST = route<{ id: string }>(async (req, { sb, user }, { id }) => {
  const b = await body(req, NewClip);
  const source = (await assets.listForProject(sb, id)).find((a) => a.kind === "source");
  if (!source?.durationMs) throw new HttpError(409, "El video todavía se está procesando");
  if (!(await transcripts.forAsset(sb, source.id))) throw new HttpError(409, "La transcripción todavía no está lista");
  if (b.endMs > source.durationMs) throw new HttpError(400, "El rango excede la duración del video");
  const title = b.title || `Clip ${new Date().toLocaleTimeString("es")}`;
  const clip = await clips.create(sb, { userId: user.id, projectId: id, sourceAssetId: source.id, sourceStartMs: b.startMs, sourceEndMs: b.endMs, title, createdBy: "user" });
  const job = await enqueueJob({ userId: user.id, projectId: id, type: "build_timeline", input: { clipId: clip.id } });
  return { clip, job };
});

export const GET = route<{ id: string }>(async (_req, { sb }, { id }) => ({ clips: await clips.list(sb, id) }));
