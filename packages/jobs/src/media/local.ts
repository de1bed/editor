import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnalyzeFacesRequest, DetectRequest, IngestRequest, RenderRequest, TranscribeRequest } from "@editor/schemas";
import { type Db, downloadTo, signedUrl, uploadFrom } from "@editor/db";
import { executeRenderPlan, extractAudio, makeProxy, probe, thumbnail } from "@editor/render";
import { type MediaWorker, MediaWorkerError, type RequestInput } from "./worker";

type Progress = (fraction: number, step?: string) => void;

/**
 * Runs ingest and render with the local ffmpeg (development, or a Trigger.dev
 * machine with the ffmpeg extension). No GPU models: faces return no tracks
 * (centered crop) and object detection requires the Modal worker.
 */
export class LocalMediaWorker implements MediaWorker {
  readonly name = "local";
  readonly capabilities = { transcribe: false, faces: false, detect: false };

  constructor(
    private readonly db: Db,
    private readonly onProgress: Progress = () => {},
  ) {}

  async ingest(req: RequestInput<IngestRequest>) {
    const dir = await mkdtemp(join(tmpdir(), "ingest-"));
    try {
      const src = join(dir, "source" + (/\.[a-z0-9]+$/i.exec(req.source.path)?.[0] ?? ".mp4"));
      this.onProgress(0.01, "download");
      await downloadTo(this.db, req.source, src);
      const info = await probe(src);
      const bytes = (await stat(src)).size;
      const proxy = join(dir, "proxy.mp4");
      this.onProgress(0.05, "proxy");
      await makeProxy(src, proxy, req.proxyHeight ?? 720, info.hasAudio, info.durationMs, (f) => this.onProgress(0.05 + 0.75 * f));
      const audio = join(dir, "audio.wav");
      this.onProgress(0.8, "audio");
      await extractAudio(info.hasAudio ? src : proxy, audio, info.durationMs);
      const thumb = join(dir, "thumb.jpg");
      await thumbnail(proxy, thumb, Math.min(Math.floor(info.durationMs / 3), 10_000));
      this.onProgress(0.9, "upload");
      const p = await probe(proxy);
      const proxyBytes = await uploadFrom(this.db, proxy, req.proxyOut, "video/mp4");
      const audioBytes = await uploadFrom(this.db, audio, req.audioOut, "audio/wav");
      const thumbBytes = await uploadFrom(this.db, thumb, req.thumbOut, "image/jpeg");
      return {
        probe: { durationMs: info.durationMs, width: info.width, height: info.height, fps: info.fps, hasAudio: info.hasAudio, videoCodec: info.videoCodec, audioCodec: info.audioCodec, bytes },
        proxy: { width: p.width, height: p.height, bytes: proxyBytes },
        audioBytes,
        thumbBytes,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async transcribe(_req: RequestInput<TranscribeRequest>): Promise<never> {
    throw new MediaWorkerError("WhisperX runs on the Modal worker: set MEDIA_WORKER=modal, or TRANSCRIBER=deepgram|assemblyai");
  }

  async analyzeFaces(req: RequestInput<AnalyzeFacesRequest>) {
    return { assetId: req.assetId, sampleFps: req.sampleFps ?? 5, width: 1, height: 1, tracks: [] };
  }

  async detectObjects(_req: RequestInput<DetectRequest>): Promise<never> {
    throw new MediaWorkerError("Object detection needs the GPU worker: set MEDIA_WORKER=modal");
  }

  async render(req: RequestInput<RenderRequest>) {
    const dir = await mkdtemp(join(tmpdir(), "render-"));
    try {
      const out = join(dir, "out.mp4");
      const urls: Record<string, string> = {};
      for (const [k, ref] of Object.entries(req.inputs)) urls[k] = await signedUrl(this.db, ref, 3 * 3600);
      await executeRenderPlan(req.plan, { resolveInput: (k) => urls[k]!, outputPath: out, onProgress: (f) => this.onProgress(0.02 + 0.93 * f, "render") });
      const bytes = await uploadFrom(this.db, out, req.out, "video/mp4");
      const p = await probe(out);
      return { out: req.out, bytes, durationMs: p.durationMs };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
