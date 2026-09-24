import { hashMcpToken, newMcpToken } from "@editor/tools";
import { z } from "zod";
import { body, route } from "@/lib/api";

const NewToken = z.object({ name: z.string().trim().min(1).max(80), scopes: z.array(z.enum(["read", "edit", "render"])).min(1).default(["read", "edit", "render"]) });

export const GET = route(async (_req, { sb }) => {
  const { data } = await sb.from("mcp_tokens").select("id, name, scopes, last_used_at, revoked_at, created_at").is("revoked_at", null).order("created_at", { ascending: false });
  return { tokens: data ?? [] };
});

/** Creates a personal MCP token. The plain token is returned only once. */
export const POST = route(async (req, { sb, user }) => {
  const b = await body(req, NewToken);
  const token = newMcpToken();
  const { data, error } = await sb.from("mcp_tokens").insert({ user_id: user.id, name: b.name, scopes: b.scopes, token_hash: hashMcpToken(token) }).select("id, name, scopes, created_at").single();
  if (error) throw new Error(error.message);
  return { token, info: data };
});
