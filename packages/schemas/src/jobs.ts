import { z } from "zod";

export const JobType = z.enum([
  "fetch_url",
  "ingest",
  "transcribe",
  "select_moments",
  "analyze_faces",
  "build_timeline",
  "detect_objects",
  "render_preview",
  "render_final",
  "learn_style",
]);
export type JobType = z.infer<typeof JobType>;

export const JobStatus = z.enum(["queued", "running", "waiting", "succeeded", "failed", "canceled"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const Job = z
  .object({
    id: z.string(),
    userId: z.string(),
    projectId: z.string().nullable(),
    type: JobType,
    status: JobStatus,
    progress: z.number().min(0).max(1),
    step: z.string().nullable(),
    idempotencyKey: z.string(),
    input: z.record(z.string(), z.unknown()),
    output: z.record(z.string(), z.unknown()).nullable(),
    error: z.string().nullable(),
    attempts: z.int().nonnegative(),
  })
  .meta({ id: "Job", title: "Job" });
export type Job = z.infer<typeof Job>;
