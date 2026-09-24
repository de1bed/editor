import type { JobStatus, JobType } from "@editor/schemas";
import { must, type Db, DbError } from "./client";

export interface JobRow {
  id: string;
  userId: string;
  projectId: string | null;
  parentJobId: string | null;
  type: JobType;
  status: JobStatus;
  progress: number;
  step: string | null;
  idempotencyKey: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  runner: string | null;
  runnerRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

type Row = Record<string, unknown>;

const toJob = (r: Row): JobRow => ({
  id: r.id as string,
  userId: r.user_id as string,
  projectId: (r.project_id as string) ?? null,
  parentJobId: (r.parent_job_id as string) ?? null,
  type: r.type as JobType,
  status: r.status as JobStatus,
  progress: Number(r.progress ?? 0),
  step: (r.step as string) ?? null,
  idempotencyKey: r.idempotency_key as string,
  input: (r.input as Record<string, unknown>) ?? {},
  output: (r.output as Record<string, unknown>) ?? null,
  error: (r.error as string) ?? null,
  attempts: Number(r.attempts ?? 0),
  runner: (r.runner as string) ?? null,
  runnerRunId: (r.runner_run_id as string) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

export const jobs = {
  /**
   * Idempotent enqueue. Returns the job and whether it must be dispatched:
   * new jobs and failed/canceled ones (reset to queued) need a runner;
   * queued/running/succeeded ones are returned as they are.
   */
  async enqueue(
    db: Db,
    j: { userId: string; projectId: string | null; type: JobType; input: Record<string, unknown>; idempotencyKey: string; parentJobId?: string | null },
  ): Promise<{ job: JobRow; dispatch: boolean }> {
    const ins = await db
      .from("jobs")
      .insert({
        user_id: j.userId,
        project_id: j.projectId,
        type: j.type,
        input: j.input,
        idempotency_key: j.idempotencyKey,
        parent_job_id: j.parentJobId ?? null,
      })
      .select()
      .single();
    if (!ins.error) return { job: toJob(ins.data), dispatch: true };
    if (ins.error.code !== "23505") throw new DbError(`enqueue ${j.type}: ${ins.error.message}`, ins.error.code);

    const existing = toJob(must(await db.from("jobs").select().eq("idempotency_key", j.idempotencyKey).single(), "existing job"));
    if (existing.status === "failed" || existing.status === "canceled") {
      const reset = await db
        .from("jobs")
        .update({ status: "queued", error: null, progress: 0, step: null, finished_at: null })
        .eq("id", existing.id)
        .in("status", ["failed", "canceled"])
        .select()
        .maybeSingle();
      if (reset.data) return { job: toJob(reset.data), dispatch: true };
    }
    return { job: existing, dispatch: false };
  },

  async get(db: Db, id: string) {
    return toJob(must(await db.from("jobs").select().eq("id", id).single(), `job ${id}`));
  },

  async listForProject(db: Db, projectId: string, limit = 50) {
    const r = await db.from("jobs").select().eq("project_id", projectId).order("created_at", { ascending: false }).limit(limit);
    return must(r, "list jobs").map(toJob);
  },

  /**
   * Claims a job for execution. Returns null if it is finished, or if another
   * run holds it (status running/waiting with a heartbeat newer than `staleMs`).
   */
  async start(db: Db, id: string, runner: string, runId: string | null, staleMs = 10 * 60_000): Promise<JobRow | null> {
    const cur = await jobs.get(db, id);
    if (cur.status === "succeeded" || cur.status === "canceled") return null;
    const live = (cur.status === "running" || cur.status === "waiting") && Date.now() - Date.parse(cur.updatedAt) < staleMs;
    if (live) return null;
    const r = await db
      .from("jobs")
      .update({
        status: "running",
        attempts: cur.attempts + 1,
        runner,
        runner_run_id: runId,
        started_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", id)
      .eq("updated_at", cur.updatedAt) // optimistic: someone else may have claimed it
      .select()
      .maybeSingle();
    if (r.error) throw new DbError(r.error.message, r.error.code);
    return r.data ? toJob(r.data) : null;
  },

  async progress(db: Db, id: string, progress: number, step?: string | null, status?: "running" | "waiting") {
    const row: Row = { progress: Math.max(0, Math.min(1, progress)) };
    if (step !== undefined) row.step = step;
    if (status) row.status = status;
    await db.from("jobs").update(row).eq("id", id);
  },

  async succeed(db: Db, id: string, output: Record<string, unknown>) {
    must(
      await db
        .from("jobs")
        .update({ status: "succeeded", progress: 1, output, error: null, step: "done", finished_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single(),
      `finish job ${id}`,
    );
  },

  async fail(db: Db, id: string, error: string) {
    await db.from("jobs").update({ status: "failed", error: error.slice(0, 8000), finished_at: new Date().toISOString() }).eq("id", id);
  },

  async cancel(db: Db, id: string) {
    await db.from("jobs").update({ status: "canceled", finished_at: new Date().toISOString() }).eq("id", id).in("status", ["queued", "running", "waiting"]);
  },

  async isCanceled(db: Db, id: string): Promise<boolean> {
    const r = await db.from("jobs").select("status").eq("id", id).single();
    return r.data?.status === "canceled";
  },
};
