"use client";
import { useEffect, useState } from "react";
import { detectionToBlur } from "@editor/core/geometry";
import type { BlurRegion, DetectionTrack, EditOpInput, Timeline } from "@editor/schemas";
import { api } from "@/lib/client-api";
import { fmtMs } from "@/lib/format";

const KINDS: [BlurRegion["kind"], string][] = [
  ["custom", "Objeto"],
  ["face", "Cara"],
  ["plate", "Placa"],
  ["logo", "Logo"],
  ["screen", "Pantalla"],
];
const EFFECTS: [BlurRegion["effect"]["type"], string][] = [
  ["gaussian", "Desenfoque"],
  ["pixelate", "Pixelado"],
  ["solid", "Tapar"],
];

interface JobState {
  id: string;
  status: string;
  error: string | null;
}

/** Blur regions of the clip: list/edit, detect by text, or draw one on the player. */
export function BlurPanel({
  clipId,
  timeline,
  onEdit,
  drawing,
  setDrawing,
}: {
  clipId: string;
  timeline: Timeline;
  onEdit: (ops: EditOpInput[]) => void;
  drawing: boolean;
  setDrawing: (v: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<BlurRegion["kind"]>("custom");
  const [job, setJob] = useState<JobState | null>(null);
  const [tracks, setTracks] = useState<DetectionTrack[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!job || job.status === "succeeded" || job.status === "failed") return;
    const t = setInterval(async () => {
      const r = await api<{ job: JobState; tracks: DetectionTrack[] }>(`/api/jobs/${job.id}/detections`);
      setJob(r.job);
      if (r.job.status === "succeeded") setTracks(r.tracks);
    }, 2500);
    return () => clearInterval(t);
  }, [job]);

  async function detect(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setTracks([]);
    try {
      const r = await api<{ job: JobState }>(`/api/clips/${clipId}/detect`, { body: { query, kind } });
      setJob(r.job);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function apply(d: DetectionTrack) {
    const region = detectionToBlur(d, { id: `blur_${d.id.slice(0, 8)}_${Date.now().toString(36)}`, effect: timeline.style.resolved.censorship.blurEffect });
    if (region) onEdit([{ op: "add_blur", region }]);
    setTracks(tracks.filter((t) => t.id !== d.id));
  }

  return (
    <div className="space-y-3">
      <span className="label">Blur</span>
      {timeline.blurs.length === 0 ? (
        <p className="text-xs text-muted">Sin regiones de blur.</p>
      ) : (
        <ul className="space-y-2">
          {timeline.blurs.map((b) => (
            <li key={b.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">
                {b.label || b.kind} <span className="text-xs text-muted">{fmtMs(b.sourceStartMs)}–{fmtMs(b.sourceEndMs)}</span>
              </span>
              <select className="input w-32 py-1" value={b.effect.type} onChange={(e) => onEdit([{ op: "update_blur", id: b.id, patch: { effect: { ...b.effect, type: e.target.value as BlurRegion["effect"]["type"] } } }])}>
                {EFFECTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button className="text-xs text-red-300 hover:underline" onClick={() => onEdit([{ op: "remove_blur", id: b.id }])}>Quitar</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={detect} className="flex gap-2">
        <input className="input" placeholder="Ej.: el logo de la gorra" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="input w-28" value={kind} onChange={(e) => setKind(e.target.value as BlurRegion["kind"])}>
          {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="btn-ghost" disabled={query.trim().length < 2 || (job !== null && job.status !== "succeeded" && job.status !== "failed")}>Detectar</button>
      </form>
      <button className={`text-xs ${drawing ? "text-accent" : "text-muted hover:text-white"}`} onClick={() => setDrawing(!drawing)}>
        {drawing ? "Dibuja un rectángulo sobre el video… (clic para cancelar)" : "…o dibuja el área a mano sobre el video"}
      </button>
      {job && job.status !== "succeeded" && job.status !== "failed" && <p className="text-xs text-muted">Detectando…</p>}
      {job?.status === "failed" && <p className="text-xs text-red-300">{job.error}</p>}
      {job?.status === "succeeded" && tracks.length === 0 && <p className="text-xs text-muted">No se encontró nada con esa descripción.</p>}
      {tracks.length > 0 && (
        <ul className="space-y-1">
          {tracks.map((d) => (
            <li key={d.id} className="flex items-center justify-between text-sm">
              <span>
                {d.query} · {fmtMs(d.startMs)}–{fmtMs(d.endMs)} <span className="text-xs text-muted">({Math.round(d.score * 100)}%)</span>
              </span>
              <button className="text-accent hover:underline" onClick={() => apply(d)}>Aplicar blur</button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="text-xs text-red-300">{err}</p>}
    </div>
  );
}
