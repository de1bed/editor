import { route } from "@/lib/api";

export const DELETE = route<{ id: string }>(async (_req, { sb }, { id }) => {
  await sb.from("mcp_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  return { ok: true };
});
