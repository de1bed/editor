import { logger, task, wait } from "@trigger.dev/sdk";
import { runJob } from "../engine";
import type { JobRuntime } from "../runtime";

/**
 * Single generic task: the job row in Postgres is the source of truth (type,
 * input, status); this task only executes it. Retries re-enter runJob, which
 * re-claims the job and resumes from the handler's idempotent steps.
 */
export const runJobTask = task({
  id: "run-job",
  maxDuration: 4 * 60 * 60,
  retry: { maxAttempts: 3, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000, factor: 3 },
  run: async (payload: { jobId: string }, { ctx }) => {
    const runtime: JobRuntime = {
      name: "trigger",
      runId: ctx.run.id,
      // Waits longer than a few seconds are checkpointed: no compute is billed while Modal works.
      sleep: (ms) => (ms >= 5000 ? wait.for({ seconds: Math.ceil(ms / 1000) }) : new Promise((r) => setTimeout(r, ms))),
    };
    logger.info("running job", { jobId: payload.jobId });
    return runJob(payload.jobId, runtime);
  },
});
