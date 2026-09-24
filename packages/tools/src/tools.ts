import { describeStyle, StyleChange } from "@editor/agent";
import { applyOps, detectionToBlur, EditOpError, timelineToAss, timelineToOtio, timelineToSrt } from "@editor/core";
import {
  assets,
  clips,
  DbError,
  detections,
  getDetection,
  jobs,
  MEDIA_BUCKET,
  paths,
  projects,
  renders,
  signedUrl,
  styleProfiles,
  timelines,
  transcripts,
  uploadText,
} from "@editor/db";
import { saveStyleUpdate } from "@editor/jobs";
import { BlurKind, CensorshipSettings, EditOp, type EditOpInput, StyleArea } from "@editor/schemas";
import { z } from "zod";
import { assertOwner, defineTool, type ToolContext, ToolError, type ToolSpec } from "./context";
import { describeTimeline, describeTranscript } from "./views";

const Uuid = z.string().min(1).describe("id");

// ------------------------------------------------------------------ helpers

async function ownedClip(ctx: ToolContext, clipId: string) {
  const clip = await clips.get(ctx.db, clipId).catch(() => {
    throw new ToolError(`clip ${clipId} not found`);
  });
  assertOwner(ctx, clip, "clip");
  return clip;
}

async function ownedProject(ctx: ToolContext, projectId: string) {
  const p = await projects.get(ctx.db, projectId).catch(() => {
    throw new ToolError(`project ${projectId} not found`);
  });
  assertOwner(ctx, p, "project");
  return p;
}

/** Applies ops to the current version, commits a new version and queues a preview. */
export async function commitOps(ctx: ToolContext, clipId: string, ops: EditOpInput[], expectedVersion?: number) {
  const clip = await ownedClip(ctx, clipId);
  if (expectedVersion !== undefined && expectedVersion !== clip.currentVersion) {
    throw new ToolError(`the clip is at version ${clip.currentVersion}, not ${expectedVersion}; re-read it with get_timeline`);
  }
  const { timeline } = await timelines.get(ctx.db, clipId, clip.currentVersion);
  let result;
  try {
    result = applyOps(timeline, ops);
  } catch (e) {
    if (e instanceof EditOpError) throw new ToolError(e.message);
    throw e;
  }
  let version: number;
  try {
    version = await timelines.commit(ctx.db, {
      clipId,
      expectedVersion: clip.currentVersion,
      timeline: result.timeline,
      ops: result.ops,
      jsonPatch: result.jsonPatch,
      author: "agent",
      messageId: ctx.messageId ?? null,
    });
  } catch (e) {
    if (e instanceof DbError && e.isConflict) throw new ToolError("the clip changed concurrently; re-read it and retry");
    throw e;
  }
  ctx.onCommit?.({ clipId, before: clip.currentVersion, after: version, ops: result.ops });
  const job = await ctx.enqueue("render_preview", { clipId, version }, clip.projectId);
  return { version, previewJobId: job.id, changedPaths: [...new Set(result.jsonPatch.map((p) => p.path.split("/").slice(0, 3).join("/")))].slice(0, 20) };
}

async function waitForJob(ctx: ToolContext, jobId: string, seconds: number) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const j = await jobs.get(ctx.db, jobId);
    if (j.status === "succeeded" || j.status === "failed" || j.status === "canceled" || Date.now() > deadline) return j;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// ------------------------------------------------------------------ tools

export const TOOLS = [
  defineTool({
    name: "list_projects",
    description: "List the user's projects (id, name, status).",
    scope: "read",
    input: z.object({}),
    run: async (ctx) => (await projects.list(ctx.db, ctx.userId)).map((p) => ({ id: p.id, name: p.name, status: p.status, createdAt: p.createdAt })),
  }),
  defineTool({
    name: "list_clips",
    description: "List the clips of a project with their ranges, scores, status and current version.",
    scope: "read",
    input: z.object({ projectId: Uuid }),
    run: async (ctx, { projectId }) => {
      await ownedProject(ctx, projectId);
      return (await clips.list(ctx.db, projectId)).map((c) => ({ id: c.id, title: c.title, status: c.status, rank: c.rank, startMs: c.sourceStartMs, endMs: c.sourceEndMs, scores: c.scores, version: c.currentVersion, justification: c.justification }));
    },
  }),
  defineTool({
    name: "get_transcript",
    description: "Transcript of a project's source video as sentence lines '[sentenceId startMs-endMs] Speaker: text'. Use startMs/endMs to read a range of a long video.",
    scope: "read",
    input: z.object({ projectId: Uuid, startMs: z.int().nonnegative().optional(), endMs: z.int().positive().optional() }),
    run: async (ctx, { projectId, startMs, endMs }) => {
      await ownedProject(ctx, projectId);
      const source = (await assets.listForProject(ctx.db, projectId)).find((a) => a.kind === "source");
      const t = source ? await transcripts.forAsset(ctx.db, source.id) : null;
      if (!t) throw new ToolError("no transcript yet");
      return { language: t.language, durationMs: t.durationMs, text: describeTranscript(t, startMs, endMs) };
    },
  }),
  defineTool({
    name: "propose_clips",
    description: "Ask the clip selector to propose the best short-form moments of a project (async job; clips appear with list_clips).",
    scope: "edit",
    input: z.object({ projectId: Uuid, count: z.int().min(1).max(20).default(5) }),
    run: async (ctx, { projectId, count }) => {
      await ownedProject(ctx, projectId);
      const source = (await assets.listForProject(ctx.db, projectId)).find((a) => a.kind === "source");
      if (!source) throw new ToolError("project has no source video");
      const job = await ctx.enqueue("select_moments", { projectId, assetId: source.id, count, run: crypto.randomUUID() }, projectId);
      return { jobId: job.id, status: job.status };
    },
  }),
  defineTool({
    name: "get_timeline",
    description:
      "Current timeline of a clip in a compact form: segments, caption words with ids, style, censorship, reframing, blurs, overlays. Set raw=true for the full JSON.",
    scope: "read",
    input: z.object({ clipId: Uuid, raw: z.boolean().default(false) }),
    run: async (ctx, { clipId, raw }) => {
      await ownedClip(ctx, clipId);
      const { timeline } = await timelines.get(ctx.db, clipId);
      return raw ? timeline : { version: timeline.version, summary: describeTimeline(timeline) };
    },
  }),
  defineTool({
    name: "patch_timeline",
    description:
      "Edit a clip with typed operations (applied atomically, validated, saved as a new version, preview re-rendered). Ops: trim_segment, split_segment, delete_segment, insert_segment, reorder_segments, set_transition, edit_caption_word, set_caption_style, set_captions_enabled, regroup_captions, censor_word, uncensor_word, set_censorship, add_blur, update_blur, remove_blur, set_reframe, remove_reframe, set_reframe_mode, add_overlay, remove_overlay, set_music, set_meta. Times are source milliseconds unless the field says output. If it fails, read the error, fix the ops and retry.",
    scope: "edit",
    input: z.object({ clipId: Uuid, ops: z.array(EditOp).min(1).max(50), expectedVersion: z.int().nonnegative().optional() }),
    run: async (ctx, { clipId, ops, expectedVersion }) => commitOps(ctx, clipId, ops, expectedVersion),
  }),
  defineTool({
    name: "add_blur_region",
    description:
      "Blur an area of a clip. Either pass detectionTrackId (from detect_objects; follows the object over time) or a static box normalized to the SOURCE frame. Defaults to the whole clip duration.",
    scope: "edit",
    input: z.object({
      clipId: Uuid,
      detectionTrackId: z.string().optional(),
      box: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.001).max(1), h: z.number().min(0.001).max(1) }).optional(),
      label: z.string().max(100).default(""),
      kind: BlurKind.default("custom"),
      startMs: z.int().nonnegative().optional(),
      endMs: z.int().positive().optional(),
      effect: z.enum(["gaussian", "pixelate", "solid"]).default("gaussian"),
      strength: z.number().min(0).max(100).default(30),
    }),
    run: async (ctx, a) => {
      await ownedClip(ctx, a.clipId);
      const { timeline } = await timelines.get(ctx.db, a.clipId);
      const start = a.startMs ?? Math.min(...timeline.segments.map((s) => s.sourceStartMs));
      const end = a.endMs ?? Math.max(...timeline.segments.map((s) => s.sourceEndMs));
      const id = `blur_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      const effect = { type: a.effect, strength: a.strength };
      let region;
      if (a.detectionTrackId) {
        const d = await getDetection(ctx.db, a.detectionTrackId);
        assertOwner(ctx, d, "detection");
        region = detectionToBlur(d, { id, effect, startMs: start, endMs: end });
        if (!region) throw new ToolError("the detection does not overlap that time range");
        if (a.label) region.label = a.label;
      } else if (a.box) {
        region = { id, label: a.label, kind: a.kind, sourceStartMs: start, sourceEndMs: end, keyframes: [{ tMs: start, ...a.box }], effect };
      } else {
        throw new ToolError("pass detectionTrackId or box");
      }
      return commitOps(ctx, a.clipId, [{ op: "add_blur", region }]);
    },
  }),
  defineTool({
    name: "detect_objects",
    description:
      "Find something in a clip from a text description (e.g. 'logo on the cap', 'license plate', 'face of the man on the left'). Runs an open-vocabulary detector + tracker; waits up to waitSeconds, then returns tracks (use their id with add_blur_region) or a jobId to check later with get_detections.",
    scope: "edit",
    input: z.object({ clipId: Uuid, query: z.string().min(2).max(200), kind: BlurKind.default("custom"), waitSeconds: z.int().min(0).max(240).default(120) }),
    run: async (ctx, { clipId, query, kind, waitSeconds }) => {
      const clip = await ownedClip(ctx, clipId);
      const job = await ctx.enqueue("detect_objects", { clipId, query, kind, version: clip.currentVersion }, clip.projectId);
      const done = await waitForJob(ctx, job.id, waitSeconds);
      if (done.status === "failed") throw new ToolError(`detection failed: ${done.error}`);
      if (done.status !== "succeeded") return { jobId: job.id, status: done.status, note: "still running; call get_detections later" };
      return { jobId: job.id, tracks: summarizeTracks(await detections.forJob(ctx.db, job.id)) };
    },
  }),
  defineTool({
    name: "get_detections",
    description: "Results of a detect_objects job.",
    scope: "read",
    input: z.object({ jobId: Uuid }),
    run: async (ctx, { jobId }) => {
      const job = await jobs.get(ctx.db, jobId);
      assertOwner(ctx, job, "job");
      return { status: job.status, error: job.error, tracks: job.status === "succeeded" ? summarizeTracks(await detections.forJob(ctx.db, jobId)) : [] };
    },
  }),
  defineTool({
    name: "set_censorship",
    description: "Change the clip's censorship: enabled, audio ('bleep'|'mute'), captionMask, languages, addWords/allowWords per language, paddingMs. Word lists are re-applied.",
    scope: "edit",
    input: z.object({ clipId: Uuid, patch: CensorshipSettings.partial() }),
    run: async (ctx, { clipId, patch }) => commitOps(ctx, clipId, [{ op: "set_censorship", patch }]),
  }),
  defineTool({
    name: "get_style_profile",
    description: "The user's learned style profile (current version, settings, learned rules).",
    scope: "read",
    input: z.object({}),
    run: async (ctx) => {
      const { profileId, version } = await styleProfiles.getOrCreateDefault(ctx.db, ctx.userId);
      return { profileId, version: version.version, summary: describeStyle(version.settings, version.learnedRules), settings: version.settings, rules: version.learnedRules };
    },
  }),
  defineTool({
    name: "update_style_profile",
    description:
      "Save a lasting preference in the user's style profile (applies to future clips; creates a new profile version). Use only when the user expresses a general preference ('siempre', 'en todos mis videos'), not for one-off edits. changes are JSON-pointer settings; rule is for preferences settings cannot express.",
    scope: "edit",
    input: z.object({
      changes: z.array(StyleChange).default([]),
      rule: z.object({ text: z.string().min(3).max(300), appliesTo: StyleArea }).optional(),
      summary: z.string().min(3).max(300),
    }),
    run: async (ctx, { changes, rule, summary }) => updateProfile(ctx, { changes, rule, summary, source: "explicit" }),
  }),
  defineTool({
    name: "render_preview",
    description: "Queue a low-resolution preview render of the clip's current version.",
    scope: "render",
    input: z.object({ clipId: Uuid }),
    run: async (ctx, { clipId }) => {
      const clip = await ownedClip(ctx, clipId);
      const job = await ctx.enqueue("render_preview", { clipId, version: clip.currentVersion }, clip.projectId);
      return { jobId: job.id, status: job.status };
    },
  }),
  defineTool({
    name: "render_final",
    description: "Queue the final 1080x1920 render of the clip's current version. Check with get_clip for the download URL.",
    scope: "render",
    input: z.object({ clipId: Uuid }),
    run: async (ctx, { clipId }) => {
      const clip = await ownedClip(ctx, clipId);
      const job = await ctx.enqueue("render_final", { clipId, version: clip.currentVersion }, clip.projectId);
      return { jobId: job.id, status: job.status };
    },
  }),
  defineTool({
    name: "get_clip",
    description: "A clip's metadata and its latest renders (with temporary download URLs when ready).",
    scope: "read",
    input: z.object({ clipId: Uuid }),
    run: async (ctx, { clipId }) => {
      const clip = await ownedClip(ctx, clipId);
      const list = await renders.list(ctx.db, clipId);
      const out = [];
      for (const r of list.slice(0, 5)) {
        let url: string | null = null;
        if (r.status === "succeeded" && r.assetId) {
          const a = await assets.get(ctx.db, r.assetId);
          url = await signedUrl(ctx.db, { bucket: a.bucket, path: a.path }, 3600);
        }
        out.push({ id: r.id, quality: r.quality, version: r.timelineVersion, status: r.status, error: r.error, url });
      }
      return { clip, renders: out };
    },
  }),
  defineTool({
    name: "get_job",
    description: "Status, progress and output of a background job.",
    scope: "read",
    input: z.object({ jobId: Uuid }),
    run: async (ctx, { jobId }) => {
      const j = await jobs.get(ctx.db, jobId);
      assertOwner(ctx, j, "job");
      return { id: j.id, type: j.type, status: j.status, progress: j.progress, step: j.step, output: j.output, error: j.error };
    },
  }),
  defineTool({
    name: "export_otio",
    description:
      "Export the clip's cuts as OpenTimelineIO (.otio) to open in DaVinci Resolve / Premiere, plus captions as .srt and .ass. Returns temporary download URLs. mediaUrl is where the NLE finds the original file (defaults to its filename for relinking).",
    scope: "read",
    input: z.object({ clipId: Uuid, mediaUrl: z.string().max(1000).optional() }),
    run: async (ctx, { clipId, mediaUrl }) => {
      const clip = await ownedClip(ctx, clipId);
      const { timeline } = await timelines.get(ctx.db, clipId);
      const source = await assets.get(ctx.db, timeline.source.assetId);
      const media = mediaUrl ?? `file:///${encodeURIComponent(source.originalFilename ?? "source.mp4")}`;
      const base = `v${timeline.version}`;
      const files: [string, string, string][] = [
        [`${base}.otio`, JSON.stringify(timelineToOtio(timeline, { mediaUrl: media, name: clip.title }), null, 2), "application/json"],
        [`${base}.srt`, timelineToSrt(timeline), "text/plain"],
        [`${base}.ass`, timelineToAss(timeline), "text/plain"],
      ];
      const urls: Record<string, string> = {};
      for (const [name, text, type] of files) {
        const ref = { bucket: MEDIA_BUCKET, path: paths.export(clip.userId, clip.projectId, clipId, name) };
        await uploadText(ctx.db, ref, text, type);
        urls[name.split(".").pop()!] = await signedUrl(ctx.db, ref, 24 * 3600);
      }
      return { version: timeline.version, urls, note: "Relink the media in your NLE if the file path differs." };
    },
  }),
] as ToolSpec<any>[];

function summarizeTracks(tracks: Awaited<ReturnType<typeof detections.forJob>>) {
  return tracks.slice(0, 10).map((d) => ({ id: d.id, query: d.query, kind: d.kind, startMs: d.startMs, endMs: d.endMs, score: d.score, firstBox: d.keyframes[0] }));
}

/** Creates a new style-profile version from changes and/or a rule. */
export async function updateProfile(
  ctx: ToolContext,
  u: { changes: StyleChange[]; rule?: { text: string; appliesTo: z.infer<typeof StyleArea> } | undefined; summary: string; source: "explicit" | "inferred"; evidence?: string[]; confidence?: number },
) {
  try {
    return await saveStyleUpdate(ctx.db, ctx.userId, ctx.source === "agent" ? "agent" : "user", { ...u, rules: u.rule ? [u.rule] : [] });
  } catch (e) {
    throw new ToolError(`invalid style update: ${(e as Error).message}`);
  }
}

export function toolByName(name: string) {
  return TOOLS.find((t) => t.name === name);
}
