import type { JobType } from "@editor/schemas";
import type { Db, JobRow } from "@editor/db";
import type { MediaWorker } from "./media/worker";
import type { JobRuntime } from "./runtime";

export interface JobContext {
  db: Db;
  job: JobRow;
  runtime: JobRuntime;
  media: MediaWorker;
  /** Reports progress in [0,1] (throttled). */
  progress(fraction: number, step?: string): Promise<void>;
  /** Enqueues a follow-up job (idempotent; parent = this job). */
  enqueue(type: JobType, input: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<JobRow>;
  /** Throws JobCanceledError when the user canceled this job. */
  checkCanceled(): Promise<void>;
}

export class JobCanceledError extends Error {
  constructor() {
    super("job canceled");
    this.name = "JobCanceledError";
  }
}

/** Errors that retrying cannot fix (bad input, missing config). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export type JobHandler = (ctx: JobContext, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
