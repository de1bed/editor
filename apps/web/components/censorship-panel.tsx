"use client";
import { useState } from "react";
import type { CensorshipSettings, EditOpInput, Timeline } from "@editor/schemas";

/** Clip censorship: on/off, bleep or mute, caption mask, languages and extra words. */
export function CensorshipPanel({ timeline, onEdit }: { timeline: Timeline; onEdit: (ops: EditOpInput[]) => void }) {
  const c = timeline.style.resolved.censorship;
  const [extra, setExtra] = useState("");
  const set = (patch: Partial<CensorshipSettings>) => onEdit([{ op: "set_censorship", patch }]);
  const count = timeline.captions.cues.flatMap((q) => q.words).filter((w) => w.censored).length;
  return (
    <div className="space-y-3">
      <span className="label">Censura · {count} palabra{count === 1 ? "" : "s"} censurada{count === 1 ? "" : "s"}</span>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={c.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Activada
        </label>
        <select className="input w-auto py-1" value={c.audio} onChange={(e) => set({ audio: e.target.value as "bleep" | "mute" })}>
          <option value="bleep">Bip</option>
          <option value="mute">Silencio</option>
        </select>
        <select className="input w-auto py-1" value={c.captionMask} onChange={(e) => set({ captionMask: e.target.value as CensorshipSettings["captionMask"] })}>
          <option value="first_letter">m*****</option>
          <option value="asterisks">******</option>
          <option value="grawlix">#$%&@!</option>
          <option value="none">Sin máscara</option>
        </select>
        {(["es", "en"] as const).map((l) => (
          <label key={l} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={c.languages.includes(l)}
              onChange={(e) => set({ languages: e.target.checked ? [...c.languages, l] : c.languages.filter((x) => x !== l) })}
            />
            {l.toUpperCase()}
          </label>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const words = extra.split(",").map((w) => w.trim()).filter(Boolean);
          if (!words.length) return;
          const lang = c.languages[0] ?? "es";
          set({ addWords: { ...c.addWords, [lang]: [...(c.addWords[lang] ?? []), ...words] } });
          setExtra("");
        }}
      >
        <input className="input" placeholder="Añadir palabras (separadas por comas)" value={extra} onChange={(e) => setExtra(e.target.value)} />
        <button className="btn-ghost">Añadir</button>
      </form>
    </div>
  );
}
