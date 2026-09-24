import { hashValue } from "@editor/core";
import type { JobType } from "@editor/schemas";

/** Bump when a handler's output format changes, so old results are not reused. */
export const HANDLER_VERSION: Partial<Record<JobType, number>> = { ingest: 1, transcribe: 1, build_timeline: 1, render_preview: 1, render_final: 1 };

export function idempotencyKey(type: JobType, input: Record<string, unknown>): string {
  return `${type}:v${HANDLER_VERSION[type] ?? 1}:${hashValue(input).slice(0, 32)}`;
}
