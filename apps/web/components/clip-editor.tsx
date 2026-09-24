"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AVAILABLE_FONT_FAMILIES } from "@editor/core/fonts";
import { applyOps } from "@editor/core/apply-ops";
import { timelineToAss } from "@editor/core/ass";
import type { Clip, RenderRow } from "@editor/db";
import type { CaptionStyle, EditOpInput, Timeline } from "@editor/schemas";
import { api } from "@/lib/client-api";
import { fmtMs } from "@/lib/format";
import { useRealtime } from "@/lib/use-realtime";
import { CaptionPlayer } from "./caption-player";
import { ChatPanel } from "./chat-panel";

type RenderWithUrl = RenderRow & { url: string | null };
interface Status {
  clip: Clip;
  timeline: Timeline | null;
  ass: string | null;
  renders: RenderWithUrl[];
}

const ANIMATIONS: [CaptionStyle["animation"], string][] = [
  ["karaoke_highlight", "Resaltar palabra"],
  ["pop", "Pop"],
  ["bounce", "Rebote"],
  ["word_by_word", "Palabra a palabra"],
  ["typewriter", "Máquina de escribir"],
  ["none", "Sin animación"],
];

export function ClipEditor({ projectId, clipId }: { projectId: string; clipId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [draft, setDraft] = useState<Timeline | null>(null); // optimistic local edits
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api<Status>(`/api/clips/${clipId}/status`);
      setStatus(s);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [clipId]);
  useEffect(() => void load(), [load]);
  useRealtime(["clips"], `id=eq.${clipId}`, load, 60_000);
  useRealtime(["renders"], `clip_id=eq.${clipId}`, load, 5000);

  const timeline = draft ?? status?.timeline ?? null;
  const ass = useMemo(() => (timeline ? timelineToAss(timeline) : null), [timeline]);
  const preview = status?.renders.find((r) => r.quality === "preview" && r.status === "succeeded" && r.url);
  const finalRender = status?.renders.find((r) => r.quality === "final");
  const rendering = status?.renders.some((r) => r.status === "queued" || r.status === "running");

  /** Applies ops locally first (instant captions), then persists them. */
  async function edit(ops: EditOpInput[]) {
    if (!status?.timeline) return;
    setErr(null);
    try {
      setDraft(applyOps(timeline!, ops).timeline);
    } catch (e) {
      return setErr((e as Error).message);
    }
    setSaving(true);
    try {
      await api(`/api/clips/${clipId}/ops`, { body: { ops, expectedVersion: status.clip.currentVersion } });
      await load();
      setDraft(null);
    } catch (e) {
      setErr((e as Error).message);
      setDraft(null);
    } finally {
      setSaving(false);
    }
  }

  async function renderFinal() {
    setErr(null);
    try {
      await api(`/api/clips/${clipId}/render`, { body: { quality: "final" } });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function review(decision: "approve" | "reject") {
    try {
      await api(`/api/clips/${clipId}/review`, { body: { decision } });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function undo() {
    if (!status || status.clip.currentVersion === 0) return;
    try {
      await api(`/api/clips/${clipId}/revert`, { body: { toVersion: status.clip.currentVersion - 1, expectedVersion: status.clip.currentVersion } });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (!status) return <p className="text-sm text-muted">{err ?? "Cargando…"}</p>;
  const { clip } = status;
  const cap = timeline?.style.resolved.captions;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/projects/${projectId}`} className="text-xs text-muted hover:text-white">← Proyecto</Link>
          <h1 className="text-xl font-semibold">{clip.title || "Clip"}</h1>
          <p className="text-xs text-muted">
            {fmtMs(clip.sourceStartMs)}–{fmtMs(clip.sourceEndMs)} del original · versión {clip.currentVersion}
            {saving ? " · guardando…" : ""}
            {rendering ? " · renderizando…" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {clip.status === "proposed" && (
            <>
              <button className="btn-ghost" onClick={() => review("approve")}>Aprobar</button>
              <button className="btn-ghost" onClick={() => review("reject")}>Descartar</button>
            </>
          )}
          <button className="btn-ghost" onClick={undo} disabled={clip.currentVersion === 0}>Deshacer</button>
          <button className="btn-primary" onClick={renderFinal} disabled={!timeline}>Render final 1080×1920</button>
        </div>
      </div>
      {err && <p className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{err}</p>}

      <div className="grid gap-6 lg:grid-cols-[340px_1fr_360px]">
        <div className="space-y-3">
          <CaptionPlayer src={preview?.url ?? null} ass={ass} />
          {finalRender && (
            <div className="card p-3 text-sm">
              {finalRender.status === "succeeded" && finalRender.url ? (
                <a className="text-accent hover:underline" href={finalRender.url} download>
                  Descargar render final (v{finalRender.timelineVersion})
                </a>
              ) : finalRender.status === "failed" ? (
                <span className="text-red-400">El render final falló: {finalRender.error}</span>
              ) : (
                <span className="text-muted">Render final en curso…</span>
              )}
            </div>
          )}
          {clip.justification && <p className="text-xs text-muted">Por qué este clip: {clip.justification}</p>}
        </div>

        <div className="card space-y-5 p-5">
          <h2 className="font-semibold">Subtítulos</h2>
          {cap && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Fuente">
                <select className="input" value={cap.fontFamily} onChange={(e) => edit([{ op: "set_caption_style", patch: { fontFamily: e.target.value } }])}>
                  {AVAILABLE_FONT_FAMILIES.map((f) => <option key={f}>{f}</option>)}
                </select>
              </Field>
              <Field label={`Tamaño (${cap.fontSizePx}px)`}>
                <input type="range" min={40} max={140} value={cap.fontSizePx} onChange={(e) => setDraft({ ...timeline!, style: { ...timeline!.style, resolved: { ...timeline!.style.resolved, captions: { ...cap, fontSizePx: Number(e.target.value) } } } })} onPointerUp={(e) => edit([{ op: "set_caption_style", patch: { fontSizePx: Number((e.target as HTMLInputElement).value) } }])} className="w-full" />
              </Field>
              <Field label="Animación">
                <select className="input" value={cap.animation} onChange={(e) => edit([{ op: "set_caption_style", patch: { animation: e.target.value as CaptionStyle["animation"] } }])}>
                  {ANIMATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Posición">
                <select className="input" value={cap.position.anchor} onChange={(e) => edit([{ op: "set_caption_style", patch: { position: { ...cap.position, anchor: e.target.value as "top" | "middle" | "bottom" } } }])}>
                  <option value="top">Arriba</option>
                  <option value="middle">Centro</option>
                  <option value="bottom">Abajo</option>
                </select>
              </Field>
              <Field label="Color del texto">
                <input type="color" className="h-9 w-full rounded" value={cap.textColor.slice(0, 7)} onChange={(e) => edit([{ op: "set_caption_style", patch: { textColor: e.target.value.toUpperCase() } }])} />
              </Field>
              <Field label="Color de resaltado">
                <input type="color" className="h-9 w-full rounded" value={cap.highlightColor.slice(0, 7)} onChange={(e) => edit([{ op: "set_caption_style", patch: { highlightColor: e.target.value.toUpperCase() } }])} />
              </Field>
              <Field label="Palabras por línea">
                <select className="input" value={cap.maxWordsPerLine} onChange={(e) => edit([{ op: "regroup_captions", maxWordsPerLine: Number(e.target.value) }])}>
                  {[1, 2, 3, 4, 5, 6, 8].map((n) => <option key={n}>{n}</option>)}
                </select>
              </Field>
              <Field label="Mayúsculas">
                <label className="flex h-9 items-center gap-2 text-sm">
                  <input type="checkbox" checked={cap.uppercase} onChange={(e) => edit([{ op: "set_caption_style", patch: { uppercase: e.target.checked } }])} />
                  TODO EN MAYÚSCULAS
                </label>
              </Field>
            </div>
          )}
          {timeline && <CaptionWords timeline={timeline} onEdit={edit} />}
          {timeline && <Framing timeline={timeline} onEdit={edit} />}
        </div>

        <ChatPanel clipId={clipId} disabled={!timeline} onApplied={load} />
      </div>
    </div>
  );
}

/** 9:16 framing: follow the speaker, fixed crop, or whole frame over a blurred fill. */
function Framing({ timeline, onEdit }: { timeline: Timeline; onEdit: (ops: EditOpInput[]) => void }) {
  const mode = timeline.reframe[0]?.mode ?? (timeline.style.resolved.reframe.defaultMode === "fit_blur_bg" ? "fit_blur_bg" : "fixed");
  const tracked = timeline.reframe.some((r) => r.keyframes.length > 1 || r.speakerId);
  const cx = timeline.reframe[0]?.keyframes[0]?.cx ?? 0.5;
  return (
    <div>
      <span className="label">Encuadre 9:16</span>
      <div className="flex flex-wrap gap-2">
        {([
          ["track", "Seguir al que habla"],
          ["fixed", "Fijo"],
          ["fit_blur_bg", "Completo con fondo desenfocado"],
        ] as const).map(([m, l]) => (
          <button
            key={m}
            disabled={m === "track" && !tracked}
            title={m === "track" && !tracked ? "Requiere el análisis de caras (worker GPU)" : undefined}
            className={`rounded-lg border px-3 py-1.5 text-sm ${mode === m ? "border-accent text-accent" : "border-line hover:bg-white/5"} disabled:opacity-40`}
            onClick={() => onEdit([{ op: "set_reframe_mode", mode: m }])}
          >
            {l}
          </button>
        ))}
      </div>
      {mode === "fixed" && (
        <input
          type="range"
          min={0}
          max={100}
          defaultValue={Math.round(cx * 100)}
          className="mt-3 w-full"
          onPointerUp={(e) => onEdit([{ op: "set_reframe_mode", mode: "fixed", cx: Number((e.target as HTMLInputElement).value) / 100 }])}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

/** Words of the clip: click to censor/uncensor, double-click to mark emphasis. */
function CaptionWords({ timeline, onEdit }: { timeline: Timeline; onEdit: (ops: EditOpInput[]) => void }) {
  const words = timeline.captions.cues.flatMap((c) => c.words);
  return (
    <div>
      <span className="label">Palabras · clic = censurar / quitar censura · doble clic = destacar</span>
      <div className="max-h-56 overflow-y-auto rounded-lg border border-line p-3 text-sm leading-7">
        {words.map((w) => (
          <button
            key={w.wordId}
            onClick={() => onEdit([{ op: w.censored ? "uncensor_word" : "censor_word", wordId: w.wordId }])}
            onDoubleClick={() => onEdit([{ op: "edit_caption_word", wordId: w.wordId, emphasis: !w.emphasis }])}
            className={`mr-1 rounded px-1 ${w.censored ? "bg-red-500/25 text-red-200 line-through" : w.emphasis ? "bg-sky-500/25 text-sky-100" : "hover:bg-white/10"}`}
            title={w.censored ? `Censurada (${w.displayText})` : "Clic para censurar"}
          >
            {w.text}
          </button>
        ))}
      </div>
    </div>
  );
}
