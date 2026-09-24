import { notFound } from "next/navigation";
import { clips } from "@editor/db";
import { requireUser } from "@/lib/auth";
import { ClipEditor } from "@/components/clip-editor";

export default async function ClipPage({ params }: PageProps<"/projects/[id]/clips/[clipId]">) {
  const { id, clipId } = await params;
  const { sb } = await requireUser();
  try {
    const clip = await clips.get(sb, clipId);
    if (clip.projectId !== id) notFound();
  } catch {
    notFound();
  }
  return <ClipEditor projectId={id} clipId={clipId} />;
}
