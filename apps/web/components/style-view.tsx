"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { StyleProfileVersionRow } from "@editor/db";
import { api } from "@/lib/client-api";

type Change = { path: string; value: string | number | boolean };

/** The learned style profile: settings, where each value came from, rules, and version history (revertible). */
export function StyleView({ active, history }: { profileId: string; active: StyleProfileVersionRow; history: StyleProfileVersionRow[] }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const s = active.settings;

  async function save(changes: Change[], summary: string, extra: Record<string, unknown> = {}) {
    setErr(null);
    try {
      await api("/api/style", { body: { changes, summary, ...extra } });
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function activate(id: string) {
    await api(`/api/style/versions/${id}/activate`, { method: "POST" });
    router.refresh();
  }
  const origin = (path: string) => {
    const p = active.provenance[path];
    if (!p) return null;
    return <span className={`ml-1 rounded px-1 text-[10px] ${p.source === "explicit" ? "bg-accent/20 text-accent" : "bg-sky-500/20 text-sky-200"}`}>{p.source === "explicit" ? "pedido" : `aprendido ${Math.round(p.confidence * 100)}%`}</span>;
  };

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <section className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Mi estilo</h1>
          <p className="text-sm text-muted">Versión {active.version}. Se actualiza cuando dices “siempre…” en el chat y cuando la IA detecta preferencias repetidas en tus aprobaciones y correcciones.</p>
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}
        <div className="card grid gap-4 p-5 sm:grid-cols-2">
          <Item k="Subtítulos" v={<>{s.captions.fontFamily} {s.captions.fontWeight} · {s.captions.fontSizePx}px{origin("/captions/fontSizePx")} · {s.captions.animation}{origin("/captions/animation")}</>} />
          <Item k="Colores" v={<>texto {s.captions.textColor}{origin("/captions/textColor")} · resaltado {s.captions.highlightColor}{origin("/captions/highlightColor")}</>} />
          <Item k="Posición" v={<>{s.captions.position.anchor} ({s.captions.position.offsetYPct}%){origin("/captions/position/anchor")} · {s.captions.maxWordsPerLine} palabras/línea</>} />
          <Item k="Hook" v={<>{s.hook.type} · máx {s.hook.maxHookSec} s{origin("/hook/type")}</>} />
          <Item k="Zooms" v={<>{s.zooms.perMinute}/min · ×{s.zooms.scale} · {s.zooms.style}</>} />
          <Item k="Reencuadre" v={<>{s.reframe.defaultMode}{origin("/reframe/defaultMode")} · suavizado {s.reframe.smoothing}</>} />
          <Item k="Censura" v={<>{s.censorship.enabled ? `${s.censorship.audio} · ${s.censorship.languages.join(", ")} · máscara ${s.censorship.captionMask}` : "desactivada"}{origin("/censorship/enabled")}</>} />
          <div>
            <span className="label">Duración de clips (s){origin("/pacing/clipDurationSec/ideal")}</span>
            <DurationEditor min={s.pacing.clipDurationSec.min} ideal={s.pacing.clipDurationSec.ideal} max={s.pacing.clipDurationSec.max} onSave={(min, ideal, max) => save([{ path: "/pacing/clipDurationSec/min", value: min }, { path: "/pacing/clipDurationSec/ideal", value: ideal }, { path: "/pacing/clipDurationSec/max", value: max }], `Duración de clips ${min}-${max} s`)} />
          </div>
          <div className="sm:col-span-2">
            <span className="label">Blur automático en clips nuevos</span>
            <div className="flex flex-wrap gap-4 text-sm">
              {(["faces", "plates", "screens", "logos"] as const).map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" checked={s.censorship.autoBlur[k]} onChange={(e) => save([{ path: `/censorship/autoBlur/${k}`, value: e.target.checked }], `Blur automático de ${LABEL[k]} ${e.target.checked ? "activado" : "desactivado"}`)} />
                  {LABEL[k]}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="card p-5">
          <h2 className="mb-2 font-semibold">Reglas aprendidas</h2>
          {active.learnedRules.filter((r) => r.active).length === 0 ? (
            <p className="text-sm text-muted">Aún no hay reglas: aparecerán cuando el asistente detecte preferencias que no son un ajuste concreto (p. ej. “prefiere hooks con pregunta”).</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {active.learnedRules.filter((r) => r.active).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span>
                    • {r.text} <span className="text-xs text-muted">({Math.round(r.confidence * 100)}% · {r.appliesTo} · {r.evidence.length} evidencias)</span>
                  </span>
                  <button className="text-xs text-muted hover:text-red-300" onClick={() => save([], `Regla desactivada: ${r.text}`, { deactivateRuleIds: [r.id] })}>Olvidar</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <aside className="card p-4">
        <h2 className="mb-3 text-sm font-semibold">Historial</h2>
        <ol className="space-y-3 text-sm">
          {history.map((v) => (
            <li key={v.id} className={v.id === active.id ? "text-white" : "text-muted"}>
              v{v.version} · {v.changeSummary || "sin descripción"}
              <span className="block text-xs text-muted">
                {new Date(v.createdAt).toLocaleString("es")} · {v.createdBy === "system" ? "aprendido" : v.createdBy === "agent" ? "chat" : "manual"}
                {v.id !== active.id && (
                  <button className="ml-2 text-accent hover:underline" onClick={() => activate(v.id)}>Restaurar</button>
                )}
              </span>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

const LABEL = { faces: "caras", plates: "placas", screens: "pantallas", logos: "logos" };

function DurationEditor({ min, ideal, max, onSave }: { min: number; ideal: number; max: number; onSave: (a: number, b: number, c: number) => void }) {
  const [v, setV] = useState({ min, ideal, max });
  const changed = v.min !== min || v.ideal !== ideal || v.max !== max;
  return (
    <div className="flex items-center gap-2 text-sm">
      {(["min", "ideal", "max"] as const).map((k) => (
        <input key={k} type="number" className="input w-16 px-2 py-1" value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} title={k} />
      ))}
      {changed && <button className="text-accent hover:underline" onClick={() => onSave(v.min, v.ideal, v.max)}>Guardar</button>}
    </div>
  );
}

function Item({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <span className="label">{k}</span>
      <p className="text-sm">{v}</p>
    </div>
  );
}
