import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobRow } from "@editor/db";

// In-memory stand-in for the jobs repository.
const store = new Map<string, JobRow>();
let seq = 0;
vi.mock("@editor/db", () => {
  const now = () => new Date().toISOString();
  const jobs = {
    enqueue: vi.fn(async (_db: unknown, j: Omit<JobRow, "id">) => {
      const existing = [...store.values()].find((x) => x.idempotencyKey === j.idempotencyKey);
      if (existing) {
        if (existing.status === "failed") {
          existing.status = "queued";
          return { job: existing, dispatch: true };
        }
        return { job: existing, dispatch: false };
      }
      const job = { ...j, id: `job${++seq}`, status: "queued", progress: 0, attempts: 0, output: null, error: null, step: null, runner: null, runnerRunId: null, createdAt: now(), updatedAt: now() } as JobRow;
      store.set(job.id, job);
      return { job, dispatch: true };
    }),
    start: vi.fn(async (_db: unknown, id: string) => {
      const j = store.get(id)!;
      if (j.status === "succeeded" || j.status === "running") return null;
      j.status = "running";
      j.attempts++;
      return { ...j };
    }),
    progress: vi.fn(async (_db: unknown, id: string, p: number) => {
      store.get(id)!.progress = p;
    }),
    succeed: vi.fn(async (_db: unknown, id: string, output: Record<string, unknown>) => {
      Object.assign(store.get(id)!, { status: "succeeded", output, progress: 1 });
    }),
    fail: vi.fn(async (_db: unknown, id: string, error: string) => {
      Object.assign(store.get(id)!, { status: "failed", error });
    }),
    isCanceled: vi.fn(async (_db: unknown, id: string) => store.get(id)!.status === "canceled"),
  };
  return { jobs, serviceClient: () => ({}) };
});

const { enqueueJob, runJob, setDispatcher } = await import("../src/engine");
const { PermanentJobError } = await import("../src/context");
const { idempotencyKey } = await import("../src/keys");

const runtime = { name: "test" as const, runId: null, sleep: async () => {} };
const media = {} as never;
const db = {} as never;

describe("job engine", () => {
  const dispatched: string[] = [];
  beforeEach(() => {
    store.clear();
    dispatched.length = 0;
    setDispatcher(async (j) => void dispatched.push(j.id));
  });

  it("enqueue is idempotent by input", async () => {
    const a = await enqueueJob({ db, userId: "u", projectId: "p", type: "ingest", input: { assetId: "x" } });
    const b = await enqueueJob({ db, userId: "u", projectId: "p", type: "ingest", input: { assetId: "x" } });
    expect(a.id).toBe(b.id);
    expect(dispatched).toEqual([a.id]);
    expect(idempotencyKey("ingest", { assetId: "x" })).toMatch(/^ingest:v1:[0-9a-f]{32}$/);
  });

  it("runs a handler, records output and chains follow-ups", async () => {
    const job = await enqueueJob({ db, userId: "u", projectId: "p", type: "ingest", input: { assetId: "x" } });
    const out = await runJob(job.id, runtime, {
      db,
      media,
      handlers: {
        ingest: async (ctx) => {
          await ctx.progress(0.5, "half");
          const next = await ctx.enqueue("transcribe", { assetId: "x" });
          return { next: next.id };
        },
      },
    });
    expect(store.get(job.id)).toMatchObject({ status: "succeeded", progress: 1 });
    const next = store.get(out!.next as string)!;
    expect(next).toMatchObject({ type: "transcribe", parentJobId: job.id, userId: "u" });
    // running it again is a no-op
    expect(await runJob(job.id, runtime, { db, media, handlers: {} })).toBeNull();
  });

  it("marks failures; retryable errors are rethrown, permanent ones are not", async () => {
    const a = await enqueueJob({ db, userId: "u", projectId: "p", type: "render_preview", input: { clipId: "c" } });
    await expect(
      runJob(a.id, runtime, { db, media, handlers: { render_preview: async () => { throw new Error("network down"); } } }),
    ).rejects.toThrow("network down");
    expect(store.get(a.id)).toMatchObject({ status: "failed", error: "Error: network down" });

    const b = await enqueueJob({ db, userId: "u", projectId: "p", type: "render_final", input: { clipId: "c" } });
    await expect(
      runJob(b.id, runtime, { db, media, handlers: { render_final: async () => { throw new PermanentJobError("bad input"); } } }),
    ).resolves.toBeNull();
    expect(store.get(b.id)!.status).toBe("failed");

    // re-enqueueing a failed job resets it and dispatches again (retry from the UI)
    dispatched.length = 0;
    await enqueueJob({ db, userId: "u", projectId: "p", type: "render_preview", input: { clipId: "c" } });
    expect(dispatched).toEqual([a.id]);
  });
});
