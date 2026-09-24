import { projects } from "@editor/db";
import { z } from "zod";
import { body, route } from "@/lib/api";

const CreateProject = z.object({
  name: z.string().trim().min(1).max(120),
  clipCount: z.int().min(0).max(20).default(5),
  language: z.string().min(2).max(8).nullable().default(null),
});

export const POST = route(async (req, { sb, user }) => {
  const b = await body(req, CreateProject);
  const project = await projects.create(sb, { userId: user.id, name: b.name, settings: { clipCount: b.clipCount, language: b.language, diarize: true } });
  return { project };
});

export const GET = route(async (_req, { sb, user }) => ({ projects: await projects.list(sb, user.id) }));
