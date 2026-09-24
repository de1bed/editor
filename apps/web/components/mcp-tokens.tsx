"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

interface TokenInfo {
  id: string;
  name: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
}

/** Personal tokens for MCP clients (Claude Desktop/Code, other agents). */
export function McpTokens() {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const load = () => api<{ tokens: TokenInfo[] }>("/api/mcp-tokens").then((r) => setTokens(r.tokens), () => undefined);
  useEffect(() => void load(), []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const r = await api<{ token: string }>("/api/mcp-tokens", { body: { name } });
    setFresh(r.token);
    setName("");
    void load();
  }
  async function revoke(id: string) {
    await api(`/api/mcp-tokens/${id}`, { method: "DELETE" });
    void load();
  }

  return (
    <div className="card space-y-3 p-5">
      <h2 className="font-semibold">Tokens MCP</h2>
      <p className="text-sm text-muted">Conecta clientes externos (Claude Desktop, Claude Code, otros agentes) a las mismas herramientas de edición.</p>
      {fresh && (
        <div className="rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm">
          Copia este token ahora; no se volverá a mostrar:
          <code className="mt-1 block break-all font-mono text-xs">{fresh}</code>
        </div>
      )}
      <form onSubmit={create} className="flex gap-2">
        <input className="input" placeholder="Nombre (p. ej. Claude Desktop)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-ghost" disabled={!name.trim()}>Crear token</button>
      </form>
      <ul className="space-y-1 text-sm">
        {tokens.map((t) => (
          <li key={t.id} className="flex items-center justify-between">
            <span>
              {t.name} <span className="text-xs text-muted">· {t.scopes.join(", ")} · {t.last_used_at ? `usado ${new Date(t.last_used_at).toLocaleDateString("es")}` : "sin usar"}</span>
            </span>
            <button className="text-xs text-muted hover:text-red-300" onClick={() => revoke(t.id)}>Revocar</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
