import { z } from "zod";
import { Id, Ms } from "./common";
import { RenderPlan } from "./render-plan";

/**
 * Contract between the job orchestrator (TypeScript) and the media workers
 * (Python on Modal, or the local Node implementation). JSON over HTTP.
 */
export const StorageRef = z.object({ bucket: z.string().min(1), path: z.string().min(1) }).meta({ id: "StorageRef" });
export type StorageRef = z.infer<typeof StorageRef>;

const Base = z.object({ jobId: z.string().nullable().default(null) });

export const IngestRequest = Base.extend({
  source: StorageRef,
  proxyOut: StorageRef,
  audioOut: StorageRef,
  thumbOut: StorageRef,
  proxyHeight: z.int().min(240).max(1080).default(720),
}).meta({ id: "IngestRequest", title: "IngestRequest" });
export type IngestRequest = z.infer<typeof IngestRequest>;

export const ProbeInfo = z
  .object({
    durationMs: Ms,
    width: z.int().nonnegative(),
    height: z.int().nonnegative(),
    fps: z.object({ num: z.int().positive(), den: z.int().positive() }),
    hasAudio: z.boolean(),
    videoCodec: z.string().nullable(),
    audioCodec: z.string().nullable(),
    bytes: z.int().nonnegative(),
  })
  .meta({ id: "ProbeInfo" });
export type ProbeInfo = z.infer<typeof ProbeInfo>;

export const IngestResult = z
  .object({
    probe: ProbeInfo,
    proxy: z.object({ width: z.int(), height: z.int(), bytes: z.int().nonnegative() }),
    audioBytes: z.int().nonnegative(),
    thumbBytes: z.int().nonnegative(),
  })
  .meta({ id: "IngestResult", title: "IngestResult" });
export type IngestResult = z.infer<typeof IngestResult>;

export const TranscribeRequest = Base.extend({
  assetId: Id,
  audio: StorageRef,
  out: StorageRef,
  language: z.string().nullable().default(null),
  diarize: z.boolean().default(true),
  minSpeakers: z.int().positive().nullable().default(null),
  maxSpeakers: z.int().positive().nullable().default(null),
}).meta({ id: "TranscribeRequest", title: "TranscribeRequest" });
export type TranscribeRequest = z.infer<typeof TranscribeRequest>;

export const TranscribeResult = z
  .object({ out: StorageRef, language: z.string(), wordCount: z.int().nonnegative(), durationMs: Ms, provider: z.string() })
  .meta({ id: "TranscribeResult", title: "TranscribeResult" });
export type TranscribeResult = z.infer<typeof TranscribeResult>;

export const SpeakerTurn = z.object({ speaker: z.string(), startMs: Ms, endMs: Ms });
export type SpeakerTurn = z.infer<typeof SpeakerTurn>;

export const AnalyzeFacesRequest = Base.extend({
  assetId: Id,
  video: StorageRef,
  startMs: Ms,
  endMs: Ms,
  sampleFps: z.number().positive().max(30).default(5),
  speakerTurns: z.array(SpeakerTurn).default([]),
}).meta({ id: "AnalyzeFacesRequest", title: "AnalyzeFacesRequest" });
export type AnalyzeFacesRequest = z.infer<typeof AnalyzeFacesRequest>;

export const DetectRequest = Base.extend({
  assetId: Id,
  video: StorageRef,
  /** Natural-language target, e.g. "logo on the cap", "license plate". */
  query: z.string().min(1),
  kind: z.enum(["face", "plate", "logo", "screen", "custom"]),
  startMs: Ms,
  endMs: Ms,
  sampleFps: z.number().positive().max(30).default(4),
  tracker: z.enum(["sam2", "iou"]).default("sam2"),
  boxThreshold: z.number().min(0).max(1).default(0.3),
  maskOut: StorageRef.nullable().default(null),
}).meta({ id: "DetectRequest", title: "DetectRequest" });
export type DetectRequest = z.infer<typeof DetectRequest>;

export const RenderRequest = Base.extend({
  plan: RenderPlan,
  inputs: z.record(z.string(), StorageRef),
  out: StorageRef,
}).meta({ id: "RenderRequest", title: "RenderRequest" });
export type RenderRequest = z.infer<typeof RenderRequest>;

export const RenderResult = z
  .object({ out: StorageRef, bytes: z.int().nonnegative(), durationMs: Ms })
  .meta({ id: "RenderResult", title: "RenderResult" });
export type RenderResult = z.infer<typeof RenderResult>;
