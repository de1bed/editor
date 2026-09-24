import type { Db } from "@editor/db";
import { hashMcpToken, newMcpToken, type Scope } from "@editor/tools";

export const hashToken = hashMcpToken;
export const newToken = newMcpToken;

/** Personal MCP token → user and scopes (service client; tokens are stored hashed). */
export async function resolveToken(db: Db, token: string | undefined | null): Promise<{ userId: string; scopes: Scope[] } | null> {
  if (!token || !token.startsWith("edmcp_")) return null;
  const { data } = await db.from("mcp_tokens").select("id, user_id, scopes, revoked_at").eq("token_hash", hashToken(token)).maybeSingle();
  if (!data || data.revoked_at) return null;
  void db.from("mcp_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id).then(() => undefined);
  return { userId: data.user_id as string, scopes: (data.scopes as Scope[]) ?? ["read"] };
}
