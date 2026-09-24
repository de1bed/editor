import { notFound } from "next/navigation";
import { assets, clips, jobs, projects } from "@editor/db";
import { requireUser } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { ProjectView } from "@/components/project-view";

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const { sb } = await requireUser();
  let project;
  try {
    project = await projects.get(sb, id);
  } catch {
    notFound();
  }
  const [assetList, clipList, jobList] = await Promise.all([assets.listForProject(sb, id), clips.list(sb, id), jobs.listForProject(sb, id, 30)]);
  return <ProjectView project={project} assets={assetList} clips={clipList} jobs={jobList} youtubeEnabled={publicEnv.youtubeIngest} />;
}
