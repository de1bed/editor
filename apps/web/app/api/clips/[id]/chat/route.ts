import { chat, clips } from "@editor/db";
import { runClipChat } from "@editor/tools";
import { z } from "zod";
import { body, route } from "@/lib/api";
import { webToolContext } from "@/lib/tool-context";

// Agent turns can take a while (tool calls, detection).
export const maxDuration = 300;

const ChatReq = z.object({ message: z.string().trim().min(1).max(4000) });

export const POST = route<{ id: string }>(async (req, { sb, user }, { id }) => {
  const b = await body(req, ChatReq);
  return runClipChat(webToolContext(sb, user.id), id, b.message);
});

export const GET = route<{ id: string }>(async (_req, { sb, user }, { id }) => {
  const clip = await clips.get(sb, id);
  const threadId = await chat.thread(sb, { userId: user.id, projectId: clip.projectId, clipId: id });
  const messages = await chat.history(sb, threadId, 100);
  return { messages: messages.filter((m) => m.role !== "tool").map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt, version: m.timelineVersion })) };
});
