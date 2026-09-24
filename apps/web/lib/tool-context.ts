import type { Db } from "@editor/db";
import { enqueueJob } from "@editor/jobs";
import type { ToolContext } from "@editor/tools";

/** Tool context for the signed-in user of the web app (RLS-scoped client). */
export function webToolContext(sb: Db, userId: string): ToolContext {
  return {
    db: sb,
    userId,
    source: "agent",
    scopes: ["read", "edit", "render"],
    enqueue: (type, input, projectId) => enqueueJob({ userId, projectId, type, input }),
  };
}
