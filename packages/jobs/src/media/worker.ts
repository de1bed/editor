import type {
  AnalyzeFacesRequest,
  DetectRequest,
  FetchUrlRequest,
  FetchUrlResult,
  DetectionTrack,
  FaceAnalysis,
  IngestRequest,
  IngestResult,
  RenderRequest,
  RenderResult,
  TranscribeRequest,
  TranscribeResult,
} from "@editor/schemas";

export type RequestInput<T> = Omit<T, "jobId"> & { jobId?: string | null };

/** Heavy media operations. Implemented by Modal (GPU/CPU workers) or locally with ffmpeg. */
export interface MediaWorker {
  readonly name: string;
  readonly capabilities: { transcribe: boolean; faces: boolean; detect: boolean };
  fetchUrl(req: RequestInput<FetchUrlRequest>): Promise<FetchUrlResult>;
  ingest(req: RequestInput<IngestRequest>): Promise<IngestResult>;
  transcribe(req: RequestInput<TranscribeRequest>): Promise<TranscribeResult>;
  analyzeFaces(req: RequestInput<AnalyzeFacesRequest>): Promise<FaceAnalysis>;
  detectObjects(req: RequestInput<DetectRequest>): Promise<{ tracks: DetectionTrack[] }>;
  render(req: RequestInput<RenderRequest>): Promise<RenderResult>;
}

export class MediaWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaWorkerError";
  }
}
