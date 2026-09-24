import { assets, MEDIA_BUCKET, paths, projects } from "@editor/db";
import { z } from "zod";
import { body, HttpError, route } from "@/lib/api";

const NewSource = z.object({
  filename: z.string().min(1).max(300),
  mimeType: z.string().max(100).default("video/mp4"),
  bytes: z.int().positive(),
});

/** Registers the source file before the browser uploads it (TUS, straight to Storage). */
export const POST = route<{ id: string }>(async (req, { sb, user }, { id }) => {
  const b = await body(req, NewSource);
  if (!b.mimeType.startsWith("video/") && !b.mimeType.startsWith("audio/")) throw new HttpError(400, "Solo se aceptan archivos de video o audio");
  const project = await projects.get(sb, id);
  const assetId = crypto.randomUUID();
  const path = paths.source(user.id, project.id, assetId, b.filename);
  const asset = await assets.create(sb, {
    id: assetId,
    userId: user.id,
    projectId: project.id,
    kind: "source",
    bucket: MEDIA_BUCKET,
    path,
    originalFilename: b.filename,
    mimeType: b.mimeType,
    bytes: b.bytes,
  });
  await projects.update(sb, project.id, { status: "uploading" });
  return { asset, upload: { bucket: MEDIA_BUCKET, path } };
});
