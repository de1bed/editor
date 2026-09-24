"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: string;
}

interface TurnResult {
  reply: string;
  assistantMessageId: string;
  userMessageId: string;
  versionBefore: number;
  versionAfter: number;
  toolCalls: { name: string; ok: boolean; error?: string }[];
  learned: { summary: string; profileVersion: number } | null;
}

const SUGGESTIONS = ["Subtítulos más grandes y en amarillo", "Quita los primeros 3 segundos", "Blurea el logo de la gorra", "No censures groserías en este clip", "Siempre quiero los subtítulos arriba"];

/** Conversational editing: each message becomes EditOps on the timeline (and may update the style profile). */
export function ChatPanel({ clipId, disabled, onApplied }: { clipId: string; disabled: boolean; onApplied: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ messages: Msg[] }>(`/api/clips/${clipId}/chat`).then((r) => setMessages(r.messages), () => undefined);
  }, [clipId]);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [messages, busy]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { id: `tmp${Date.now()}`, role: "user", content: message }]);
    try {
      const r = await api<TurnResult>(`/api/clips/${clipId}/chat`, { body: { message } });
      const edits = r.versionAfter - r.versionBefore;
      const failed = r.toolCalls.filter((c) => !c.ok).length;
      const meta = [edits > 0 ? `${edits} cambio${edits > 1 ? "s" : ""} · v${r.versionAfter}` : "", failed ? `${failed} intento${failed > 1 ? "s" : ""} corregido${failed > 1 ? "s" : ""}` : "", r.learned ? `Guardado en tu estilo: ${r.learned.summary}` : ""]
        .filter(Boolean)
        .join(" · ");
      setMessages((m) => [...m, { id: r.assistantMessageId, role: "assistant", content: r.reply, meta }]);
      if (edits > 0) onApplied();
    } catch (e) {
      setMessages((m) => [...m, { id: `err${Date.now()}`, role: "assistant", content: `No pude completar eso: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex h-[70vh] flex-col">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-semibold">Asistente</h2>
        <p className="text-xs text-muted">Pide cambios en lenguaje natural. Di “siempre…” para que lo recuerde.</p>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {messages.length === 0 && (
          <div className="space-y-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} disabled={disabled} className="block w-full rounded-lg border border-line px-3 py-2 text-left text-muted hover:bg-white/5 hover:text-white" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "ml-8 rounded-lg bg-accent/15 px-3 py-2" : "mr-4"}>
            <p className="whitespace-pre-wrap">{m.content}</p>
            {m.meta && <p className="mt-1 text-xs text-accent">{m.meta}</p>}
          </div>
        ))}
        {busy && <p className="text-muted">Editando…</p>}
        <div ref={end} />
      </div>
      <form
        className="flex gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input className="input" placeholder={disabled ? "Esperando el timeline…" : "Ej.: pon el hook en texto arriba"} value={input} onChange={(e) => setInput(e.target.value)} disabled={disabled || busy} />
        <button className="btn-primary" disabled={disabled || busy || !input.trim()}>
          Enviar
        </button>
      </form>
    </div>
  );
}
