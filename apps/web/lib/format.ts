export function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

export const JOB_LABELS: Record<string, string> = {
  ingest: "Preparando video",
  transcribe: "Transcribiendo",
  select_moments: "Buscando los mejores momentos",
  analyze_faces: "Detectando caras",
  build_timeline: "Armando el clip",
  detect_objects: "Detectando objetos",
  render_preview: "Render de vista previa",
  render_final: "Render final",
};

export const STATUS_LABELS: Record<string, string> = {
  queued: "En cola",
  running: "En curso",
  waiting: "Esperando",
  succeeded: "Listo",
  failed: "Falló",
  canceled: "Cancelado",
};
