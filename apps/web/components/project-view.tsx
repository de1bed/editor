"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { Clip, JobRow, MediaAsset, Project } from "@editor/db";
import { api } from "@/lib/client-api";
import { fmtMs } from "@/lib/format";
import { useRealtime } from "@/lib/use-realtime";
import { JobList } from "./job-list";
import { TranscriptPicker } from "./transcript-picker";
import { Uploader } from "./uploader";
import { UrlIngest } from "./url-ingest";

export function ProjectView(props: { project: Project; assets: MediaAsset[]; clips: Clip[]; jobs: JobRow[]; youtubeEnabled: boolean }) {
  const { project, assets, clips, jobs } = props;
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  useRealtime(["jobs", "clips", "media_assets"], `project_id=eq.${project.id}`, refresh);

  const source = assets.find((a) => a.kind === "source");
  const proxy = assets.find((a) => a.kind === "proxy");
  const transcribed = jobs.some((j) => j.type === "transcribe" && j.status === "succeeded");
  const selecting = jobs.some((j) => j.type === "select_moments" && (j.status === "queued" || j.status === "running"));
  const [busy, setBusy] = useState(false);

  async function propose() {
    setBusy(true);
    try {
      await api(`/api/projects/${project.id}/propose`, { body: { count: project.settings.clipCount || 5 } });
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function review(clipId: string, decision: "approve" | "reject") {
    await api(`/api/clips/${clipId}/review`, { body: { decision } });
    refresh();
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/projects" className="text-xs text-muted hover:text-white">← Proyectos</Link>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          {source?.durationMs ? (
            <p className="text-sm text-muted">
              {source.originalFilename} · {fmtMs(source.durationMs)} · {source.width}×{source.height}
            </p>
          ) : null}
        </div>
      </div>

      {(!source || source.status === "pending") && (
        <section className="grid gap-4 md:grid-cols-2">
          <Uploader projectId={project.id} pending={source ?? null} onDone={refresh} />
          {props.youtubeEnabled && <UrlIngest projectId={project.id} onDone={refresh} />}
        </section>
      )}

      {jobs.length > 0 && <JobList jobs={jobs} onChange={refresh} />}

      {(clips.length > 0 || transcribed) && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Clips</h2>
            {transcribed && (
              <button className="btn-ghost" onClick={propose} disabled={busy || selecting}>
                {selecting ? "Buscando momentos…" : clips.length ? "Proponer más clips" : "Proponer clips con IA"}
              </button>
            )}
          </div>
          {clips.length === 0 && <p className="text-sm text-muted">Aún no hay clips. Pídele a la IA que proponga los mejores momentos o crea uno desde la transcripción.</p>}
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {clips.map((c) => (
              <li key={c.id} className={`card flex flex-col ${c.status === "rejected" ? "opacity-50" : ""}`}>
                <Link href={`/projects/${project.id}/clips/${c.id}`} className="block flex-1 p-4 hover:bg-white/[0.02]">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="line-clamp-1 font-medium">{c.title || "Sin título"}</span>
                    {c.scores?.total !== undefined && (
                      <span className="rounded bg-accent/15 px-1.5 py-0.5 text-xs font-semibold text-accent">{c.scores.total.toFixed(1)}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted">
                    {fmtMs(c.sourceStartMs)}–{fmtMs(c.sourceEndMs)} · {Math.round((c.sourceEndMs - c.sourceStartMs) / 1000)} s · v{c.currentVersion}
                    {c.status === "approved" ? " · ✓ aprobado" : c.status === "rejected" ? " · descartado" : ""}
                  </p>
                  {c.justification && <p className="mt-2 line-clamp-3 text-xs text-neutral-400">{c.justification}</p>}
                </Link>
                {c.status === "proposed" && (
                  <div className="flex border-t border-line text-xs">
                    <button className="flex-1 py-2 text-emerald-300 hover:bg-white/5" onClick={() => review(c.id, "approve")}>Aprobar</button>
                    <button className="flex-1 border-l border-line py-2 text-muted hover:bg-white/5" onClick={() => review(c.id, "reject")}>Descartar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {transcribed && source && <TranscriptPicker projectId={project.id} proxyAssetId={proxy?.id ?? null} onClipCreated={refresh} />}
    </div>
  );
}
