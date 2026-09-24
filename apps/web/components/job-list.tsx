"use client";
import { useState } from "react";
import type { JobRow } from "@editor/db";
import { api } from "@/lib/client-api";
import { JOB_LABELS, STATUS_LABELS } from "@/lib/format";

export function JobList({ jobs, onChange }: { jobs: JobRow[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running" || j.status === "waiting");
  const failed = jobs.filter((j) => j.status === "failed");
  const shown = open ? jobs : [...active, ...failed].slice(0, 6);

  async function act(id: string, what: "retry" | "cancel") {
    await api(`/api/jobs/${id}/${what}`, { method: "POST" });
    onChange();
  }

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          Trabajos {active.length > 0 && <span className="ml-1 text-muted">({active.length} en curso)</span>}
        </h2>
        <button className="text-xs text-muted hover:text-white" onClick={() => setOpen(!open)}>
          {open ? "Ver menos" : `Ver todos (${jobs.length})`}
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="text-xs text-muted">Todo al día.</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((j) => (
            <li key={j.id} className="text-sm">
              <div className="flex items-center justify-between gap-3">
                <span>
                  {JOB_LABELS[j.type] ?? j.type}
                  {j.step && j.status === "running" ? <span className="text-muted"> · {j.step}</span> : null}
                </span>
                <span className="flex items-center gap-3 text-xs">
                  <span className={j.status === "failed" ? "text-red-400" : j.status === "succeeded" ? "text-emerald-400" : "text-muted"}>
                    {STATUS_LABELS[j.status]}
                    {j.attempts > 1 ? ` (intento ${j.attempts})` : ""}
                  </span>
                  {(j.status === "failed" || j.status === "canceled") && (
                    <button className="text-accent hover:underline" onClick={() => act(j.id, "retry")}>Reintentar</button>
                  )}
                  {(j.status === "queued" || j.status === "running" || j.status === "waiting") && (
                    <button className="text-muted hover:text-white" onClick={() => act(j.id, "cancel")}>Cancelar</button>
                  )}
                </span>
              </div>
              {(j.status === "running" || j.status === "waiting" || j.status === "queued") && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-white/10">
                  <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(j.progress * 100)}%` }} />
                </div>
              )}
              {j.status === "failed" && j.error && <p className="mt-1 line-clamp-2 text-xs text-red-300/80">{j.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
