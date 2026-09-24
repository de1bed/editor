import type { JobType } from "@editor/schemas";
import { type Db, jobs, type JobRow, serviceClient } from "@editor/db";
import { type JobContext, JobCanceledError, type JobHandler, PermanentJobError } from "./context";
import { config } from "./env";
import { HANDLERS } from "./handlers";
import { idempotencyKey } from "./keys";
import { LocalMediaWorker } from "./media/local";
import { ModalMediaWorker } from "./media/modal";
import type { MediaWorker } from "./media/worker";
import { inlineRuntime, type JobRuntime } from "./runtime";

export interface EnqueueOptions {
  userId: string;
  projectId: string | null;
  type: JobType;
  input: Record<string, unknown>;
  idempotencyKey?: string;
  parentJobId?: string | null;
  db?: Db;
}

type Dispatcher = (job: JobRow) => Promise<void>;
let dispatcherOverride: Dispatcher | null = null;

/** Tests and the Trigger.dev tasks module can replace how jobs are dispatched. */
export function setDispatcher(d: Dispatcher | null) {
  dispatcherOverride = d;
}

/** Creates (or reuses) a job and hands it to the configured runner. */
export async function enqueueJob(o: EnqueueOptions): Promise<JobRow> {
  const db = o.db ?? serviceClient();
  const { job, dispatch } = await jobs.enqueue(db, {
    userId: o.userId,
    projectId: o.projectId,
    type: o.type,
    input: o.input,
    idempotencyKey: o.idempotencyKey ?? idempotencyKey(o.type, o.input),
    parentJobId: o.parentJobId ?? null,
  });
  if (dispatch) await dispatchJob(job);
  return job;
}

export async function dispatchJob(job: JobRow): Promise<void> {
  if (dispatcherOverride) return dispatcherOverride(job);
  if (config.runner === "trigger") {
    const { tasks } = await import("@trigger.dev/sdk");
    await tasks.trigger("run-job", { jobId: job.id }, { tags: [`job:${job.type}`, `user:${job.userId}`], queue: queueFor(job.type) });
    return;
  }
  // Inline: run in this process, after the current request finishes.
  setImmediate(() => {
    runJob(job.id, inlineRuntime).catch((e) => console.error(`[jobs] ${job.type} ${job.id} failed:`, e));
  });
}

function queueFor(type: JobType): string {
  return type === "render_preview" || type === "render_final" ? "render" : type === "transcribe" || type === "detect_objects" || type === "analyze_faces" ? "gpu" : "default";
}

export function mediaWorkerFor(runtime: JobRuntime, db: Db, job: JobRow, progress: (f: number, step?: string) => void): MediaWorker {
  if (config.mediaWorker === "modal") {
    return new ModalMediaWorker(runtime, { heartbeat: () => jobs.progress(db, job.id, job.progress) });
  }
  return new LocalMediaWorker(db, progress);
}

/**
 * Executes a job by id. Safe to call more than once (claims the job first;
 * finished or live-claimed jobs are skipped). Returns the output, or null
 * if the job was not run. Rethrows retryable errors so the runner can retry.
 */
export async function runJob(
  jobId: string,
  runtime: JobRuntime,
  deps: { db?: Db; media?: MediaWorker; handlers?: Partial<Record<JobType, JobHandler>> } = {},
): Promise<Record<string, unknown> | null> {
  const db = deps.db ?? serviceClient();
  const job = await jobs.start(db, jobId, runtime.name, runtime.runId);
  if (!job) return null;

  let last = 0;
  const progress = async (fraction: number, step?: string) => {
    const now = Date.now();
    if (step === undefined && fraction < 1 && now - last < 1500) return;
    last = now;
    job.progress = fraction;
    await jobs.progress(db, job.id, fraction, step);
  };
  const ctx: JobContext = {
    db,
    job,
    runtime,
    media: deps.media ?? mediaWorkerFor(runtime, db, job, (f, s) => void progress(f, s)),
    progress,
    enqueue: (type, input, opts) =>
      enqueueJob({ db, userId: job.userId, projectId: job.projectId, type, input, idempotencyKey: opts?.idempotencyKey, parentJobId: job.id }),
    checkCanceled: async () => {
      if (await jobs.isCanceled(db, job.id)) throw new JobCanceledError();
    },
  };

  const handler = (deps.handlers ?? HANDLERS)[job.type];
  try {
    if (!handler) throw new PermanentJobError(`no handler for job type ${job.type}`);
    const output = await handler(ctx, job.input);
    await jobs.succeed(db, job.id, output);
    return output;
  } catch (e) {
    if (e instanceof JobCanceledError) return null;
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    await jobs.fail(db, job.id, msg);
    if (e instanceof PermanentJobError) return null;
    throw e;
  }
}
