"use client";
import type { StyleProfileVersionRow } from "@editor/db";

/** The learned style profile: current settings, learned rules and version history. */
export function StyleView({ active, history }: { profileId: string; active: StyleProfileVersionRow; history: StyleProfileVersionRow[] }) {
  const s = active.settings;
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <section className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Mi estilo</h1>
          <p className="text-sm text-muted">Versión {active.version}. Se actualiza con cada ajuste que apruebas o corriges en el chat.</p>
        </div>
        <div className="card grid gap-4 p-5 sm:grid-cols-2">
          <Item k="Subtítulos" v={`${s.captions.fontFamily} ${s.captions.fontWeight} · ${s.captions.fontSizePx}px · ${s.captions.animation}`} />
          <Item k="Colores" v={`texto ${s.captions.textColor} · resaltado ${s.captions.highlightColor}`} />
          <Item k="Posición" v={`${s.captions.position.anchor} (${s.captions.position.offsetYPct}%) · ${s.captions.maxWordsPerLine} palabras/línea`} />
          <Item k="Duración de clips" v={`${s.pacing.clipDurationSec.min}–${s.pacing.clipDurationSec.max} s (ideal ${s.pacing.clipDurationSec.ideal} s)`} />
          <Item k="Hook" v={`${s.hook.type} · máx ${s.hook.maxHookSec} s`} />
          <Item k="Zooms" v={`${s.zooms.perMinute}/min · ×${s.zooms.scale} · ${s.zooms.style}`} />
          <Item k="Reencuadre" v={`${s.reframe.defaultMode} · suavizado ${s.reframe.smoothing}`} />
          <Item k="Censura" v={s.censorship.enabled ? `${s.censorship.audio} · ${s.censorship.languages.join(", ")} · máscara ${s.censorship.captionMask}` : "desactivada"} />
        </div>
        <div className="card p-5">
          <h2 className="mb-2 font-semibold">Reglas aprendidas</h2>
          {active.learnedRules.length === 0 ? (
            <p className="text-sm text-muted">Aún no hay reglas: aparecerán cuando el asistente detecte preferencias repetidas.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {active.learnedRules.filter((r) => r.active).map((r) => (
                <li key={r.id}>
                  • {r.text} <span className="text-xs text-muted">({Math.round(r.confidence * 100)}% · {r.appliesTo})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <aside className="card p-4">
        <h2 className="mb-3 text-sm font-semibold">Historial</h2>
        <ol className="space-y-2 text-sm">
          {history.map((v) => (
            <li key={v.id} className={v.id === active.id ? "text-white" : "text-muted"}>
              v{v.version} · {v.changeSummary || "sin descripción"}
              <span className="block text-xs text-muted">{new Date(v.createdAt).toLocaleString("es")} · {v.createdBy}</span>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <span className="label">{k}</span>
      <p className="text-sm">{v}</p>
    </div>
  );
}
