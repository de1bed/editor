/** Runtime configuration for the job system (read lazily so tests can set env first). */
export const config = {
  get runner(): "inline" | "trigger" {
    return process.env.JOB_RUNNER === "trigger" ? "trigger" : "inline";
  },
  get mediaWorker(): "local" | "modal" {
    return process.env.MEDIA_WORKER === "modal" ? "modal" : "local";
  },
  get transcriber(): "whisperx" | "deepgram" | "assemblyai" {
    const v = process.env.TRANSCRIBER ?? "whisperx";
    if (v === "deepgram" || v === "assemblyai" || v === "whisperx") return v;
    throw new Error(`unknown TRANSCRIBER "${v}"`);
  },
  get modalApiUrl(): string {
    const v = process.env.MODAL_API_URL;
    if (!v) throw new Error("MODAL_API_URL is required when MEDIA_WORKER=modal");
    return v.replace(/\/$/, "");
  },
  get mediaWorkerToken(): string {
    const v = process.env.MEDIA_WORKER_TOKEN;
    if (!v) throw new Error("MEDIA_WORKER_TOKEN is required when MEDIA_WORKER=modal");
    return v;
  },
};
