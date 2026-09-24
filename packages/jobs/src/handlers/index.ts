import type { JobType } from "@editor/schemas";
import type { JobHandler } from "../context";
import { buildTimelineJob } from "./build-timeline";
import { ingest } from "./ingest";
import { renderJob } from "./render";
import { transcribe } from "./transcribe";

export const HANDLERS: Partial<Record<JobType, JobHandler>> = {
  ingest,
  transcribe,
  build_timeline: buildTimelineJob,
  render_preview: renderJob("preview"),
  render_final: renderJob("final"),
};
