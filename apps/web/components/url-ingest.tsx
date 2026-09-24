"use client";
import { useState } from "react";
import { api } from "@/lib/client-api";

/** Behind NEXT_PUBLIC_FEATURE_YOUTUBE_INGEST (off by default). */
export function UrlIngest({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [rights, setRights] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/projects/${projectId}/url`, { body: { url, confirmRights: rights } });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-6">
      <p className="font-medium">O pega un enlace de YouTube</p>
      <input className="input" type="url" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} required />
      <label className="flex items-start gap-2 text-xs text-muted">
        <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5" />
        Confirmo que tengo los derechos sobre este contenido (soy su autor o tengo licencia para editarlo y publicarlo). Descargar contenido ajeno puede
        infringir derechos de autor y los términos de YouTube.
      </label>
      {err && <p className="text-sm text-red-400">{err}</p>}
      <button className="btn-ghost" disabled={busy || !rights}>
        Importar
      </button>
    </form>
  );
}
