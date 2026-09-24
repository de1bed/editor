"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Transcript } from "@editor/schemas";
import { api } from "@/lib/client-api";
import { fmtMs } from "@/lib/format";

/**
 * Transcript as text: click a word to jump there, shift+click to extend the
 * selection, then create a clip from it.
 */
export function TranscriptPicker({ projectId, proxyAssetId, onClipCreated }: { projectId: string; proxyAssetId: string | null; onClipCreated: () => void }) {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const [query, setQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    api<{ transcript: Transcript }>(`/api/projects/${projectId}/transcript`).then((r) => setTranscript(r.transcript), (e) => setErr(e.message));
    if (proxyAssetId) api<{ url: string }>(`/api/assets/${proxyAssetId}/url`).then((r) => setVideoUrl(r.url), () => undefined);
  }, [projectId, proxyAssetId]);

  const index = useMemo(() => new Map(transcript?.words.map((w, i) => [w.id, i]) ?? []), [transcript]);
  const matches = useMemo(() => {
    if (!transcript || query.trim().length < 2) return new Set<number>();
    const q = query.trim().toLowerCase();
    return new Set(transcript.words.flatMap((w, i) => (w.text.toLowerCase().includes(q) ? [i] : [])));
  }, [transcript, query]);

  if (err) return <p className="text-sm text-red-400">{err}</p>;
  if (!transcript) return <p className="text-sm text-muted">Cargando transcripción…</p>;

  const words = transcript.words;
  const lo = sel ? Math.min(sel.a, sel.b) : -1;
  const hi = sel ? Math.max(sel.a, sel.b) : -1;
  const startMs = sel ? words[lo]!.startMs : 0;
  const endMs = sel ? words[hi]!.endMs : 0;
  const speakerLabel = new Map(transcript.speakers.map((s) => [s.id, s.label]));

  function click(i: number, e: React.MouseEvent) {
    if (e.shiftKey && sel) setSel({ a: sel.a, b: i });
    else setSel({ a: i, b: i });
    if (video.current) {
      video.current.currentTime = words[i]!.startMs / 1000;
      void video.current.play().catch(() => undefined);
    }
  }

  async function create() {
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/clips`, { body: { startMs, endMs } });
      setSel(null);
      onClipCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="card max-h-[70vh] overflow-y-auto p-5 leading-8">
        <div className="sticky top-0 z-10 -mx-5 -mt-5 mb-3 flex items-center gap-3 border-b border-line bg-panel px-5 py-3">
          <h2 className="text-sm font-semibold">Transcripción</h2>
          <input className="input max-w-56 py-1" placeholder="Buscar…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <span className="ml-auto text-xs text-muted">Clic para ir · Mayús+clic para seleccionar</span>
        </div>
        {transcript.sentences.map((s) => (
          <p key={s.id} className="mb-2">
            {s.speaker && <span className="mr-2 text-xs font-semibold text-muted">{speakerLabel.get(s.speaker) ?? s.speaker}</span>}
            {s.wordIds.map((id) => {
              const i = index.get(id)!;
              const w = words[i]!;
              const inSel = i >= lo && i <= hi;
              return (
                <span
                  key={id}
                  onClick={(e) => click(i, e)}
                  className={`cursor-pointer rounded px-0.5 ${inSel ? "bg-accent text-accent-ink" : matches.has(i) ? "bg-sky-500/30" : "hover:bg-white/10"}`}
                  title={fmtMs(w.startMs)}
                >
                  {w.text}{" "}
                </span>
              );
            })}
          </p>
        ))}
      </div>
      <aside className="space-y-4">
        {videoUrl && <video ref={video} src={videoUrl} controls className="w-full rounded-lg bg-black" preload="metadata" />}
        <div className="card space-y-3 p-4">
          {sel ? (
            <>
              <p className="text-sm">
                Selección: <strong>{fmtMs(startMs)} – {fmtMs(endMs)}</strong> ({((endMs - startMs) / 1000).toFixed(1)} s)
              </p>
              <button className="btn-primary w-full" onClick={create} disabled={busy || endMs - startMs < 1000}>
                Crear clip con esta selección
              </button>
            </>
          ) : (
            <p className="text-sm text-muted">Selecciona un fragmento de la transcripción para crear un clip manualmente.</p>
          )}
        </div>
      </aside>
    </section>
  );
}
