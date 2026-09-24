import type { JobType } from "@editor/schemas";
import type { JobHandler } from "../context";
import { buildTimelineJob } from "./build-timeline";
import { detectObjectsJob } from "./detect";
import { fetchUrl } from "./fetch-url";
import { ingest } from "./ingest";
import { learnStyleJob } from "./learn-style";
import { renderJob } from "./render";
import { selectMomentsJob } from "./select-moments";
import { transcribe } from "./transcribe";

export const HANDLERS: Partial<Record<JobType, JobHandler>> = {
  fetch_url: fetchUrl,
  ingest,
  transcribe,
  build_timeline: buildTimelineJob,
  select_moments: selectMomentsJob,
  detect_objects: detectObjectsJob,
  learn_style: learnStyleJob,
  render_preview: renderJob("preview"),
  render_final: renderJob("final"),
};
