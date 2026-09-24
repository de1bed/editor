import { z } from "zod";
import { Hex, Id, Ms, Rational, Unit } from "./common";
import { BlurEffect, CaptionStyle, ReframeMode, StyleSettings, TransitionType } from "./style";

export const TIMELINE_SCHEMA_VERSION = "1" as const;

export const Segment = z
  .object({
    id: Id,
    sourceStartMs: Ms,
    sourceEndMs: Ms,
    speed: z.literal(1).default(1),
    transitionIn: z.object({ type: TransitionType, durationMs: Ms }).optional(),
  })
  .meta({ id: "Segment" });
export type Segment = z.infer<typeof Segment>;

export const ReframeKeyframe = z
  .object({
    /** Source time. */
    tMs: Ms,
    /** Crop center, normalized to the source frame. */
    cx: Unit,
    cy: Unit,
    /** 1 = crop uses full source height; >1 zooms in. */
    zoom: z.number().min(1).max(4).default(1),
  })
  .meta({ id: "ReframeKeyframe" });
export type ReframeKeyframe = z.infer<typeof ReframeKeyframe>;

export const ReframeTrack = z
  .object({
    id: Id,
    sourceStartMs: Ms,
    sourceEndMs: Ms,
    mode: ReframeMode,
    speakerId: z.string().optional(),
    keyframes: z.array(ReframeKeyframe).min(1),
    interpolation: z.enum(["hold", "linear", "smooth"]).default("linear"),
  })
  .meta({ id: "ReframeTrack" });
export type ReframeTrack = z.infer<typeof ReframeTrack>;

export const CaptionWord = z
  .object({
    wordId: Id,
    text: z.string(),
    /** What is actually drawn (e.g. masked profanity "p***"). Defaults to `text`. */
    displayText: z.string().optional(),
    sourceStartMs: Ms,
    sourceEndMs: Ms,
    emphasis: z.boolean().default(false),
    censored: z.boolean().default(false),
    /** Manual decision that wins over the automatic word lists. */
    censorOverride: z.enum(["censor", "allow"]).optional(),
  })
  .meta({ id: "CaptionWord" });
export type CaptionWord = z.infer<typeof CaptionWord>;

export const CaptionCue = z
  .object({
    id: Id,
    sourceStartMs: Ms,
    sourceEndMs: Ms,
    words: z.array(CaptionWord).min(1),
    styleOverride: CaptionStyle.partial().optional(),
  })
  .meta({ id: "CaptionCue" });
export type CaptionCue = z.infer<typeof CaptionCue>;

export const BlurKeyframe = z
  .object({ tMs: Ms, x: Unit, y: Unit, w: Unit, h: Unit })
  .meta({ id: "BlurKeyframe" });
export type BlurKeyframe = z.infer<typeof BlurKeyframe>;

export const BlurKind = z.enum(["face", "plate", "logo", "screen", "custom"]);
export type BlurKind = z.infer<typeof BlurKind>;

export const BlurRegion = z
  .object({
    id: Id,
    label: z.string().default(""),
    kind: BlurKind,
    sourceStartMs: Ms,
    sourceEndMs: Ms,
    shape: z.enum(["rect", "ellipse", "mask"]).default("rect"),
    keyframes: z.array(BlurKeyframe).min(1),
    mask: z.object({ assetId: Id, format: z.literal("coco_rle_jsonl"), fps: z.number().positive() }).optional(),
    effect: BlurEffect.default({ type: "gaussian", strength: 30 }),
    featherPx: z.number().min(0).max(100).default(0),
    detectionTrackId: Id.optional(),
  })
  .meta({ id: "BlurRegion" });
export type BlurRegion = z.infer<typeof BlurRegion>;

export const AudioEvent = z
  .object({
    id: Id,
    type: z.enum(["bleep", "mute", "duck"]),
    sourceStartMs: Ms,
    sourceEndMs: Ms,
    reason: z.enum(["censorship", "user"]),
    wordId: Id.optional(),
    gainDb: z.number().optional(),
    bleepHz: z.int().min(100).max(8000).optional(),
  })
  .meta({ id: "AudioEvent" });
export type AudioEvent = z.infer<typeof AudioEvent>;

export const MusicCue = z
  .object({
    id: Id,
    assetId: Id,
    outputStartMs: Ms,
    outputEndMs: Ms,
    offsetMs: Ms.default(0),
    gainDb: z.number().default(-18),
    duckUnderSpeechDb: z.number().default(-10),
    fadeInMs: Ms.default(500),
    fadeOutMs: Ms.default(1000),
  })
  .meta({ id: "MusicCue" });
export type MusicCue = z.infer<typeof MusicCue>;

export const Overlay = z
  .discriminatedUnion("type", [
    z.object({
      id: Id,
      type: z.literal("zoom"),
      outputStartMs: Ms,
      outputEndMs: Ms,
      scale: z.number().min(1).max(3),
      easing: z.enum(["linear", "ease_in_out", "punch"]).default("punch"),
    }),
    z.object({
      id: Id,
      type: z.literal("text"),
      outputStartMs: Ms,
      outputEndMs: Ms,
      text: z.string().min(1),
      style: z.enum(["hook", "title"]).default("hook"),
      position: z.enum(["top", "middle", "bottom"]).default("top"),
      color: Hex.optional(),
    }),
  ])
  .meta({ id: "Overlay" });
export type Overlay = z.infer<typeof Overlay>;

export const ClipScores = z
  .object({
    hook: z.number().min(0).max(10),
    payoff: z.number().min(0).max(10),
    standalone: z.number().min(0).max(10),
    emotion: z.number().min(0).max(10),
    durationFit: z.number().min(0).max(10),
    total: z.number().min(0).max(10),
  })
  .meta({ id: "ClipScores" });
export type ClipScores = z.infer<typeof ClipScores>;

export const TimelineShape = z
  .object({
    schemaVersion: z.literal(TIMELINE_SCHEMA_VERSION),
    id: Id,
    projectId: Id,
    clipId: Id,
    version: z.int().nonnegative(),
    source: z.object({
      assetId: Id,
      proxyAssetId: Id.optional(),
      durationMs: Ms,
      width: z.int().positive(),
      height: z.int().positive(),
      fps: Rational,
    }),
    output: z
      .object({
        width: z.int().positive().max(4096),
        height: z.int().positive().max(4096),
        fps: z.int().min(1).max(120),
        maxDurationMs: Ms.optional(),
      })
      .default({ width: 1080, height: 1920, fps: 30 }),
    style: z.object({ styleProfileVersionId: Id.nullable(), resolved: StyleSettings }),
    meta: z
      .object({
        title: z.string().default(""),
        hookText: z.string().optional(),
        justification: z.string().optional(),
        scores: ClipScores.optional(),
        createdBy: z.enum(["llm", "user", "system"]).default("system"),
      })
      .default({ title: "", createdBy: "system" }),
    segments: z.array(Segment).min(1),
    reframe: z.array(ReframeTrack).default([]),
    captions: z.object({ enabled: z.boolean(), cues: z.array(CaptionCue) }).default({ enabled: true, cues: [] }),
    blurs: z.array(BlurRegion).default([]),
    audio: z
      .object({ masterGainDb: z.number().default(0), events: z.array(AudioEvent).default([]), music: z.array(MusicCue).default([]) })
      .default({ masterGainDb: 0, events: [], music: [] }),
    overlays: z.array(Overlay).default([]),
  })
  .meta({ id: "Timeline", title: "Timeline" });

type TimelineShapeT = z.infer<typeof TimelineShape>;

/** Semantic checks that JSON Schema cannot express. Shared by Zod parsing and `validateTimeline`. */
export function checkTimelineInvariants(t: TimelineShapeT, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  const ids = new Set<string>();
  const unique = (id: string, path: (string | number)[]) => {
    if (ids.has(id)) issue(path, `duplicate id "${id}"`);
    ids.add(id);
  };
  const range = (s: number, e: number, path: (string | number)[], what: string) => {
    if (e <= s) issue(path, `${what}: end (${e}) must be greater than start (${s})`);
    if (e > t.source.durationMs) issue(path, `${what}: end (${e}) exceeds source duration (${t.source.durationMs})`);
  };
  const sorted = (kfs: { tMs: number }[], path: (string | number)[]) => {
    for (let i = 1; i < kfs.length; i++) {
      if (kfs[i]!.tMs < kfs[i - 1]!.tMs) issue([...path, i, "tMs"], "keyframes must be sorted by tMs");
    }
  };

  let outputMs = 0;
  t.segments.forEach((s, i) => {
    unique(s.id, ["segments", i, "id"]);
    range(s.sourceStartMs, s.sourceEndMs, ["segments", i], "segment");
    outputMs += Math.max(0, s.sourceEndMs - s.sourceStartMs);
    if (s.transitionIn && i === 0 && s.transitionIn.type !== "cut") {
      issue(["segments", 0, "transitionIn"], "first segment cannot have a transition");
    }
    if (s.transitionIn && s.transitionIn.durationMs * 2 > s.sourceEndMs - s.sourceStartMs) {
      issue(["segments", i, "transitionIn", "durationMs"], "transition longer than half the segment");
    }
  });
  if (t.output.maxDurationMs !== undefined && outputMs > t.output.maxDurationMs) {
    issue(["segments"], `output duration ${outputMs}ms exceeds maxDurationMs ${t.output.maxDurationMs}`);
  }

  t.reframe.forEach((r, i) => {
    unique(r.id, ["reframe", i, "id"]);
    range(r.sourceStartMs, r.sourceEndMs, ["reframe", i], "reframe track");
    sorted(r.keyframes, ["reframe", i, "keyframes"]);
  });
  for (let i = 0; i < t.reframe.length; i++) {
    for (let j = i + 1; j < t.reframe.length; j++) {
      const a = t.reframe[i]!;
      const b = t.reframe[j]!;
      if (a.sourceStartMs < b.sourceEndMs && b.sourceStartMs < a.sourceEndMs) {
        issue(["reframe", j], `reframe track "${b.id}" overlaps "${a.id}"`);
      }
    }
  }

  const wordIds = new Set<string>();
  t.captions.cues.forEach((c, i) => {
    unique(c.id, ["captions", "cues", i, "id"]);
    range(c.sourceStartMs, c.sourceEndMs, ["captions", "cues", i], "caption cue");
    c.words.forEach((w, j) => {
      wordIds.add(w.wordId);
      if (w.sourceEndMs < w.sourceStartMs) issue(["captions", "cues", i, "words", j], "word end before start");
      if (w.sourceStartMs < c.sourceStartMs || w.sourceEndMs > c.sourceEndMs) {
        issue(["captions", "cues", i, "words", j], `word "${w.text}" outside its cue`);
      }
      if (j > 0 && w.sourceStartMs < c.words[j - 1]!.sourceStartMs) {
        issue(["captions", "cues", i, "words", j], "words must be in chronological order");
      }
    });
  });

  t.blurs.forEach((b, i) => {
    unique(b.id, ["blurs", i, "id"]);
    range(b.sourceStartMs, b.sourceEndMs, ["blurs", i], "blur region");
    sorted(b.keyframes, ["blurs", i, "keyframes"]);
    b.keyframes.forEach((k, j) => {
      if (k.x + k.w > 1.0001 || k.y + k.h > 1.0001) issue(["blurs", i, "keyframes", j], "box extends outside the frame");
      if (k.w <= 0 || k.h <= 0) issue(["blurs", i, "keyframes", j], "box must have positive size");
    });
    if (b.shape === "mask" && !b.mask) issue(["blurs", i, "mask"], "shape 'mask' requires mask data");
  });

  t.audio.events.forEach((e, i) => {
    unique(e.id, ["audio", "events", i, "id"]);
    range(e.sourceStartMs, e.sourceEndMs, ["audio", "events", i], "audio event");
    if (e.reason === "censorship" && e.wordId && t.captions.cues.length > 0 && !wordIds.has(e.wordId)) {
      issue(["audio", "events", i, "wordId"], `censorship event references unknown word "${e.wordId}"`);
    }
  });
  t.audio.music.forEach((m, i) => {
    unique(m.id, ["audio", "music", i, "id"]);
    if (m.outputEndMs <= m.outputStartMs) issue(["audio", "music", i], "music end must be after start");
  });
  t.overlays.forEach((o, i) => {
    unique(o.id, ["overlays", i, "id"]);
    if (o.outputEndMs <= o.outputStartMs) issue(["overlays", i], "overlay end must be after start");
    if (o.outputEndMs > outputMs) issue(["overlays", i], `overlay ends after the clip (${outputMs}ms)`);
  });
}

export const Timeline = TimelineShape.superRefine(checkTimelineInvariants);
export type Timeline = z.infer<typeof TimelineShape>;
export type TimelineInput = z.input<typeof TimelineShape>;
