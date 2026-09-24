import { type Db, MEDIA_BUCKET, type MediaAsset, projects, type StyleProfileVersionRow, styleProfiles } from "@editor/db";
import { PermanentJobError } from "../context";

export function str(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== "string" || !v) throw new PermanentJobError(`input.${key} must be a non-empty string`);
  return v;
}

export function int(input: Record<string, unknown>, key: string, fallback?: number): number {
  const v = input[key];
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== "number" || !Number.isInteger(v)) throw new PermanentJobError(`input.${key} must be an integer`);
  return v;
}

export const ref = (a: Pick<MediaAsset, "bucket" | "path">) => ({ bucket: a.bucket, path: a.path });
export const mediaRef = (path: string) => ({ bucket: MEDIA_BUCKET, path });

/** Active style for a project (creates the user's default profile on first use). */
export async function projectStyle(db: Db, projectId: string): Promise<StyleProfileVersionRow> {
  const project = await projects.get(db, projectId);
  if (project.styleProfileId) return styleProfiles.active(db, project.styleProfileId);
  const { profileId, version } = await styleProfiles.getOrCreateDefault(db, project.userId);
  await projects.update(db, projectId, { styleProfileId: profileId });
  return version;
}
