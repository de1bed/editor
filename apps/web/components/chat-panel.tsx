"use client";

/** Phase 4: conversational editing. Placeholder until the agent endpoint exists. */
export function ChatPanel({ disabled }: { clipId: string; disabled: boolean; onApplied: () => void }) {
  return (
    <div className="card flex flex-col p-4">
      <h2 className="mb-2 font-semibold">Asistente</h2>
      <p className="text-sm text-muted">{disabled ? "Esperando el timeline…" : "Pronto: pídele cambios en lenguaje natural."}</p>
    </div>
  );
}
