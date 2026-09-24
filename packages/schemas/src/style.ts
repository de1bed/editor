import { z } from "zod";
import { Hex, Id, Lang } from "./common";

export const CaptionAnimation = z.enum(["none", "word_by_word", "karaoke_highlight", "pop", "bounce", "typewriter"]);
export type CaptionAnimation = z.infer<typeof CaptionAnimation>;

export const CaptionStyle = z
  .object({
    fontFamily: z.string().default("Montserrat"),
    fontWeight: z.int().min(100).max(900).default(800),
    /** Font size in px relative to a 1080px-wide frame. */
    fontSizePx: z.number().min(8).max(300).default(72),
    textColor: Hex.default("#FFFFFF"),
    highlightColor: Hex.default("#FFD400"),
    strokeColor: Hex.default("#000000"),
    strokeWidthPx: z.number().min(0).max(30).default(6),
    shadow: z
      .object({ color: Hex, blurPx: z.number().min(0), offsetPx: z.number().min(0) })
      .nullable()
      .default({ color: "#000000", blurPx: 0, offsetPx: 3 }),
    background: z
      .object({ color: Hex, opacity: z.number().min(0).max(1), paddingPx: z.number().min(0), radiusPx: z.number().min(0) })
      .nullable()
      .default(null),
    position: z
      .object({ anchor: z.enum(["top", "middle", "bottom"]), offsetYPct: z.number().min(0).max(50) })
      .default({ anchor: "bottom", offsetYPct: 22 }),
    maxWordsPerLine: z.int().min(1).max(12).default(3),
    maxLines: z.int().min(1).max(3).default(1),
    uppercase: z.boolean().default(true),
    animation: CaptionAnimation.default("karaoke_highlight"),
    emphasis: z
      .object({ enabled: z.boolean(), color: Hex, scale: z.number().min(1).max(2) })
      .default({ enabled: true, color: "#00E5FF", scale: 1.15 }),
  })
  .meta({ id: "CaptionStyle" });
export type CaptionStyle = z.infer<typeof CaptionStyle>;

export const TransitionType = z.enum(["cut", "crossfade", "zoom_punch", "whip"]);
export const ReframeMode = z.enum(["track", "fixed", "split", "fit_blur_bg"]);
export const BlurEffect = z
  .object({ type: z.enum(["gaussian", "pixelate", "solid"]), strength: z.number().min(0).max(100) })
  .meta({ id: "BlurEffect" });
export type BlurEffect = z.infer<typeof BlurEffect>;

export const CensorshipSettings = z
  .object({
    enabled: z.boolean().default(true),
    languages: z.array(Lang).default(["es", "en"]),
    audio: z.enum(["bleep", "mute"]).default("bleep"),
    bleepHz: z.int().min(200).max(4000).default(1000),
    /** Extra margin around each censored word to absorb alignment error. */
    paddingMs: z.int().min(0).max(500).default(40),
    captionMask: z.enum(["asterisks", "first_letter", "grawlix", "none"]).default("first_letter"),
    addWords: z.record(z.string(), z.array(z.string())).default({}),
    allowWords: z.record(z.string(), z.array(z.string())).default({}),
    autoBlur: z
      .object({ faces: z.boolean(), plates: z.boolean(), screens: z.boolean(), logos: z.boolean() })
      .default({ faces: false, plates: false, screens: false, logos: false }),
    blurEffect: BlurEffect.default({ type: "gaussian", strength: 30 }),
  })
  .meta({ id: "CensorshipSettings" });
export type CensorshipSettings = z.infer<typeof CensorshipSettings>;

export const StyleSettings = z
  .object({
    captions: CaptionStyle.default(CaptionStyle.parse({})),
    pacing: z
      .object({
        clipDurationSec: z.object({ min: z.number().positive(), ideal: z.number().positive(), max: z.number().positive() }),
        maxShotLengthSec: z.number().positive(),
        removeSilencesAboveMs: z.int().positive().nullable(),
        removeFillers: z.boolean(),
      })
      .default({ clipDurationSec: { min: 20, ideal: 40, max: 75 }, maxShotLengthSec: 8, removeSilencesAboveMs: null, removeFillers: false }),
    zooms: z
      .object({ perMinute: z.number().min(0).max(60), scale: z.number().min(1).max(2), style: z.enum(["punch", "smooth"]) })
      .default({ perMinute: 4, scale: 1.12, style: "punch" }),
    transitions: z
      .object({ type: TransitionType, durationMs: z.int().min(0).max(2000) })
      .default({ type: "cut", durationMs: 0 }),
    music: z
      .object({ enabled: z.boolean(), moods: z.array(z.string()), gainDb: z.number(), duckUnderSpeechDb: z.number() })
      .default({ enabled: false, moods: [], gainDb: -18, duckUnderSpeechDb: -10 }),
    hook: z
      .object({
        type: z.enum(["question", "bold_claim", "cold_open", "text_overlay", "none"]),
        maxHookSec: z.number().positive(),
        textOverlay: z.boolean(),
      })
      .default({ type: "bold_claim", maxHookSec: 3, textOverlay: false }),
    reframe: z
      .object({ defaultMode: ReframeMode, smoothing: z.number().min(0).max(1), splitWhenTwoSpeakers: z.boolean() })
      .default({ defaultMode: "track", smoothing: 0.7, splitWhenTwoSpeakers: false }),
    censorship: CensorshipSettings.default(CensorshipSettings.parse({})),
  })
  .meta({ id: "StyleSettings", title: "StyleSettings" });
export type StyleSettings = z.infer<typeof StyleSettings>;
export type StyleSettingsInput = z.input<typeof StyleSettings>;

export const StyleArea = z.enum(["clip_selection", "captions", "reframe", "censorship", "blur", "pacing", "audio", "general"]);
export type StyleArea = z.infer<typeof StyleArea>;

export const LearnedRule = z
  .object({
    id: Id,
    text: z.string().min(1),
    appliesTo: StyleArea,
    confidence: z.number().min(0).max(1),
    evidence: z.array(Id).default([]),
    active: z.boolean().default(true),
  })
  .meta({ id: "LearnedRule" });
export type LearnedRule = z.infer<typeof LearnedRule>;

export const Provenance = z.object({
  source: z.enum(["default", "explicit", "inferred"]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(Id).default([]),
});
export type Provenance = z.infer<typeof Provenance>;

export const StyleProfileVersion = z
  .object({
    id: Id,
    profileId: Id,
    version: z.int().positive(),
    parentVersionId: Id.nullable(),
    settings: StyleSettings,
    learnedRules: z.array(LearnedRule).default([]),
    /** Keyed by JSON pointer into `settings` (e.g. "/captions/fontSizePx"). */
    provenance: z.record(z.string(), Provenance).default({}),
    changeSummary: z.string().default(""),
    createdBy: z.enum(["user", "agent", "system"]),
    createdAt: z.string(),
  })
  .meta({ id: "StyleProfileVersion", title: "StyleProfileVersion" });
export type StyleProfileVersion = z.infer<typeof StyleProfileVersion>;

export const StyleProfile = z
  .object({ id: Id, userId: Id, name: z.string(), activeVersionId: Id.nullable(), createdAt: z.string() })
  .meta({ id: "StyleProfile" });
export type StyleProfile = z.infer<typeof StyleProfile>;

export function defaultStyleSettings(): StyleSettings {
  return StyleSettings.parse({});
}
