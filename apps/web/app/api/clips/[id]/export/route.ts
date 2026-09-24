import { toolByName } from "@editor/tools";
import { route } from "@/lib/api";
import { webToolContext } from "@/lib/tool-context";

/** OTIO + SRT + ASS for DaVinci Resolve / Premiere (same tool the agent and MCP use). */
export const POST = route<{ id: string }>(async (_req, { sb, user }, { id }) => {
  const tool = toolByName("export_otio")!;
  return tool.run(webToolContext(sb, user.id), { clipId: id });
});
