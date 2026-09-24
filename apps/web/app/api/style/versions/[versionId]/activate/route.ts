import { styleProfiles } from "@editor/db";
import { HttpError, route } from "@/lib/api";

/** Revert the style profile to an earlier version (history is kept). */
export const POST = route<{ versionId: string }>(async (_req, { sb, user }, { versionId }) => {
  const v = await styleProfiles.getVersion(sb, versionId);
  if (v.userId !== user.id) throw new HttpError(404, "Versión no encontrada");
  await styleProfiles.activate(sb, v.profileId, v.id);
  return { active: v.version };
});
