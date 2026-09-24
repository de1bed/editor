/** What differs between running a job inline (dev server) and on Trigger.dev. */
export interface JobRuntime {
  name: "inline" | "trigger" | "test";
  runId: string | null;
  /** Durable wait on Trigger.dev (checkpointed, no compute billed); setTimeout inline. */
  sleep(ms: number): Promise<void>;
}

export const inlineRuntime: JobRuntime = {
  name: "inline",
  runId: null,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};
