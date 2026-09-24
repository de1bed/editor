import { DetectionTrack, FaceAnalysis, IngestResult, RenderResult, TranscribeResult } from "@editor/schemas";
import { z } from "zod";
import { config } from "../env";
import type { JobRuntime } from "../runtime";
import { type MediaWorker, MediaWorkerError, type RequestInput } from "./worker";

/**
 * Calls the Modal HTTP API (workers/media/media/modal_app.py): spawn, then poll.
 * Polling uses runtime.sleep, which on Trigger.dev is a checkpointed wait.
 */
export class ModalMediaWorker implements MediaWorker {
  readonly name = "modal";
  readonly capabilities = { transcribe: true, faces: true, detect: true };

  constructor(
    private readonly runtime: JobRuntime,
    private readonly opts: { baseUrl?: string; token?: string; pollMs?: number; heartbeat?: () => Promise<void> } = {},
  ) {}

  private get base() {
    return this.opts.baseUrl ?? config.modalApiUrl;
  }
  private get headers() {
    return { Authorization: `Bearer ${this.opts.token ?? config.mediaWorkerToken}`, "Content-Type": "application/json" };
  }

  private async call<T>(op: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const res = await fetch(`${this.base}/ops/${op}`, { method: "POST", headers: this.headers, body: JSON.stringify(body) });
    if (!res.ok) throw new MediaWorkerError(`modal ${op}: HTTP ${res.status} ${await res.text()}`);
    const { callId } = (await res.json()) as { callId: string };
    let delay = 1000;
    for (;;) {
      await this.runtime.sleep(delay);
      delay = Math.min(this.opts.pollMs ?? 5000, delay * 2);
      const st = await fetch(`${this.base}/calls/${callId}`, { headers: this.headers });
      if (!st.ok) {
        if (st.status >= 500) continue; // transient
        throw new MediaWorkerError(`modal ${op} status: HTTP ${st.status}`);
      }
      const s = (await st.json()) as { status: string; result?: unknown; error?: string };
      if (s.status === "succeeded") return schema.parse(s.result);
      if (s.status === "failed") throw new MediaWorkerError(`modal ${op} failed: ${s.error}`);
      await this.opts.heartbeat?.();
    }
  }

  ingest(req: RequestInput<import("@editor/schemas").IngestRequest>) {
    return this.call("ingest", req, IngestResult);
  }
  transcribe(req: RequestInput<import("@editor/schemas").TranscribeRequest>) {
    return this.call("transcribe", req, TranscribeResult);
  }
  analyzeFaces(req: RequestInput<import("@editor/schemas").AnalyzeFacesRequest>) {
    return this.call("analyze_faces", req, FaceAnalysis);
  }
  detectObjects(req: RequestInput<import("@editor/schemas").DetectRequest>) {
    return this.call("detect_objects", req, z.object({ tracks: z.array(DetectionTrack) }));
  }
  render(req: RequestInput<import("@editor/schemas").RenderRequest>) {
    return this.call("render", req, RenderResult);
  }
}
