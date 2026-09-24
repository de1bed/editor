import { styleProfiles } from "@editor/db";
import { requireUser } from "@/lib/auth";
import { StyleView } from "@/components/style-view";

export default async function StylePage() {
  const { sb, user } = await requireUser();
  const { profileId, version } = await styleProfiles.getOrCreateDefault(sb, user.id);
  const history = await styleProfiles.history(sb, profileId);
  return <StyleView profileId={profileId} active={version} history={history} />;
}
