import { assets, signedUrl } from "@editor/db";
import { route } from "@/lib/api";

export const GET = route<{ id: string }>(async (_req, { sb }, { id }) => {
  const asset = await assets.get(sb, id);
  return { url: await signedUrl(sb, { bucket: asset.bucket, path: asset.path }, 3600), asset };
});
