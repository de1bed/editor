import type { JobType } from "@editor/schemas";
import type { Db, JobRow } from "@editor/db";
import { z } from "zod";

export type Scope = "read" | "edit" | "render";

export interface ToolContext {
  /** User-scoped client (RLS) in the web app; service client + ownership checks in MCP. */
  db: Db;
  userId: string;
  source: "agent" | "mcp";
  scopes: Scope[];
  enqueue(type: JobType, input: Record<string, unknown>, projectId: string | null): Promise<JobRow>;
  /** Chat message that caused the edits (for timeline version attribution). */
  messageId?: string | null;
  /** Called after every committed edit (the chat collects them for feedback). */
  onCommit?: (c: { clipId: string; before: number; after: number; ops: unknown[] }) => void;
}

export interface ToolSpec<I> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  scope: Scope;
  run: (ctx: ToolContext, input: I) => Promise<unknown>;
}

export function defineTool<I>(spec: ToolSpec<I>): ToolSpec<I> {
  return spec;
}

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

/** Every entity has a user_id; tools never act on someone else's data (RLS is not enough for service clients). */
export function assertOwner(ctx: ToolContext, entity: { userId: string }, what: string) {
  if (entity.userId !== ctx.userId) throw new ToolError(`${what} not found`);
}
