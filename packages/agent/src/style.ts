import { type LearnedRule, type Provenance, StyleArea, StyleSettings } from "@editor/schemas";
import type { LLMProvider } from "@editor/llm";
import { z } from "zod";

/**
 * Style settings the agent may change, as JSON pointers. A flat list of
 * (path, value) changes is far easier for a model to produce reliably than a
 * deep partial object, and every result is re-validated with Zod.
 */
export const STYLE_PATHS = {
  "/captions/fontFamily": "string: Montserrat | Bebas Neue",
  "/captions/fontWeight": "number 100-900",
  "/captions/fontSizePx": "number, px at 1080 wide (typical 60-120)",
  "/captions/textColor": "#RRGGBB",
  "/captions/highlightColor": "#RRGGBB (active word)",
  "/captions/strokeColor": "#RRGGBB",
  "/captions/strokeWidthPx": "number 0-30",
  "/captions/position/anchor": "top | middle | bottom",
  "/captions/position/offsetYPct": "number 0-50 (% of height from the anchored edge)",
  "/captions/maxWordsPerLine": "integer 1-12",
  "/captions/maxLines": "integer 1-3",
  "/captions/uppercase": "boolean",
  "/captions/animation": "none | word_by_word | karaoke_highlight | pop | bounce | typewriter",
  "/captions/emphasis/enabled": "boolean",
  "/captions/emphasis/color": "#RRGGBB",
  "/pacing/clipDurationSec/min": "seconds",
  "/pacing/clipDurationSec/ideal": "seconds",
  "/pacing/clipDurationSec/max": "seconds",
  "/pacing/removeFillers": "boolean",
  "/zooms/perMinute": "number 0-60",
  "/zooms/scale": "number 1-2",
  "/transitions/type": "cut | crossfade | zoom_punch | whip",
  "/hook/type": "question | bold_claim | cold_open | text_overlay | none",
  "/hook/maxHookSec": "seconds",
  "/hook/textOverlay": "boolean",
  "/reframe/defaultMode": "track | fixed | fit_blur_bg",
  "/reframe/smoothing": "number 0-1",
  "/music/enabled": "boolean",
  "/censorship/enabled": "boolean",
  "/censorship/audio": "bleep | mute",
  "/censorship/captionMask": "asterisks | first_letter | grawlix | none",
  "/censorship/paddingMs": "integer 0-500",
  "/censorship/autoBlur/faces": "boolean",
  "/censorship/autoBlur/plates": "boolean",
  "/censorship/autoBlur/screens": "boolean",
  "/censorship/autoBlur/logos": "boolean",
  "/censorship/blurEffect/type": "gaussian | pixelate | solid",
} as const;
export type StylePath = keyof typeof STYLE_PATHS;
const PATHS = Object.keys(STYLE_PATHS) as [StylePath, ...StylePath[]];

export const StyleChange = z.object({
  path: z.enum(PATHS),
  value: z.union([z.string(), z.number(), z.boolean()]),
});
export type StyleChange = z.infer<typeof StyleChange>;

export class StyleChangeError extends Error {}

/** Applies pointer changes and validates the result. Throws StyleChangeError with readable issues. */
export function applyStyleChanges(settings: StyleSettings, changes: StyleChange[]): StyleSettings {
  const draft = structuredClone(settings) as unknown as Record<string, unknown>;
  for (const c of changes) {
    const keys = c.path.split("/").slice(1);
    let node = draft;
    for (const k of keys.slice(0, -1)) node = node[k] as Record<string, unknown>;
    const last = keys[keys.length - 1]!;
    const current = node[last];
    // Coerce "84" → 84 and "true" → true when the field is numeric/boolean.
    let v: unknown = c.value;
    if (typeof current === "number" && typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) v = Number(v);
    if (typeof current === "boolean" && typeof v === "string") v = v === "true";
    if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) v = v.toUpperCase();
    node[last] = v;
  }
  const r = StyleSettings.safeParse(draft);
  if (!r.success) throw new StyleChangeError(r.error.issues.map((i) => `${i.path.join("/")}: ${i.message}`).join("; "));
  const d = r.data.pacing.clipDurationSec;
  if (!(d.min <= d.ideal && d.ideal <= d.max)) throw new StyleChangeError("clip duration must satisfy min ≤ ideal ≤ max");
  return r.data;
}

export function describeStyle(s: StyleSettings, rules: LearnedRule[] = []): string {
  const c = s.captions;
  const lines = [
    `Subtítulos: ${c.fontFamily} ${c.fontWeight}, ${c.fontSizePx}px, texto ${c.textColor}, resaltado ${c.highlightColor}, borde ${c.strokeColor} ${c.strokeWidthPx}px, ${c.position.anchor} ${c.position.offsetYPct}%, ${c.maxWordsPerLine} palabras/línea × ${c.maxLines}, ${c.uppercase ? "MAYÚSCULAS" : "normal"}, animación ${c.animation}.`,
    `Clips: ${s.pacing.clipDurationSec.min}-${s.pacing.clipDurationSec.max}s (ideal ${s.pacing.clipDurationSec.ideal}s). Hook: ${s.hook.type}, máx ${s.hook.maxHookSec}s. Zooms: ${s.zooms.perMinute}/min ×${s.zooms.scale}. Transición: ${s.transitions.type}.`,
    `Encuadre: ${s.reframe.defaultMode}. Censura: ${s.censorship.enabled ? `${s.censorship.audio}, máscara ${s.censorship.captionMask}, ${s.censorship.languages.join("/")}` : "off"}. Auto-blur: ${Object.entries(s.censorship.autoBlur).filter(([, v]) => v).map(([k]) => k).join(", ") || "ninguno"}.`,
  ];
  const active = rules.filter((r) => r.active);
  if (active.length) lines.push(`Reglas aprendidas: ${active.map((r) => `"${r.text}" (${r.appliesTo}, ${Math.round(r.confidence * 100)}%)`).join("; ")}.`);
  return lines.join("\n");
}

// ------------------------------------------------------------------ interpreting one message

export const FeedbackInterpretation = z.object({
  kind: z.enum(["approve", "reject", "correction", "instruction"]),
  area: StyleArea,
  scope: z.enum(["this_clip", "project", "always"]).describe("'always' only when the user states a general preference (siempre, de ahora en adelante, en todos mis videos, I always want…)"),
  summary: z.string().describe("one sentence, in the user's language, describing what they wanted"),
  explicitPreference: z
    .object({
      changes: z.array(StyleChange).describe("profile changes implied by the preference; empty if it cannot be expressed as settings"),
      rule: z.string().nullable().describe("a general preference that settings cannot express (e.g. 'prefers hooks that start with a question'), else null"),
    })
    .nullable()
    .describe("only when scope is 'always'"),
});
export type FeedbackInterpretation = z.infer<typeof FeedbackInterpretation>;

export async function interpretFeedback(
  llm: LLMProvider,
  input: { userMessage: string; appliedOps: unknown[]; styleSummary: string },
): Promise<FeedbackInterpretation> {
  const { object } = await llm.generateObject({
    name: "feedback",
    model: "fast",
    schema: FeedbackInterpretation,
    system: [
      "You classify a video creator's chat message to a clip-editing assistant, to learn their style.",
      "Decide whether it is a one-off correction for this clip or a lasting preference, and map lasting preferences to profile settings.",
      `Profile settings you may change (JSON pointer: type):\n${Object.entries(STYLE_PATHS).map(([p, t]) => `${p}: ${t}`).join("\n")}`,
      `Current profile:\n${input.styleSummary}`,
    ].join("\n\n"),
    messages: [{ role: "user", content: `Message: ${input.userMessage}\nEdit operations applied: ${JSON.stringify(input.appliedOps).slice(0, 4000)}` }],
  });
  return object;
}

// ------------------------------------------------------------------ learning from accumulated feedback

export const LearnedUpdate = z.object({
  changes: z.array(StyleChange.extend({ evidence: z.array(z.string()).describe("ids of the feedback items that support this change") })),
  rules: z.array(
    z.object({
      text: z.string(),
      appliesTo: StyleArea,
      evidence: z.array(z.string()),
      confidence: z.number(),
    }),
  ),
  deactivateRuleIds: z.array(z.string()).describe("ids of existing rules contradicted by recent feedback"),
  summary: z.string().describe("one sentence in Spanish describing what was learned, or empty"),
});
export type LearnedUpdate = z.infer<typeof LearnedUpdate>;

export interface FeedbackItem {
  id: string;
  kind: string;
  area: string;
  scope: string;
  userText: string | null;
  summary: string;
  ops?: unknown[];
}

/**
 * Proposes profile updates from recent implicit feedback. Only changes backed
 * by at least `minEvidence` distinct feedback items survive, so one-off
 * corrections never rewrite the profile.
 */
export async function learnFromFeedback(
  llm: LLMProvider,
  input: { settings: StyleSettings; rules: LearnedRule[]; items: FeedbackItem[]; minEvidence?: number },
): Promise<LearnedUpdate> {
  const min = input.minEvidence ?? 2;
  const ids = new Set(input.items.map((i) => i.id));
  const { object } = await llm.generateObject({
    name: "style_update",
    model: "main",
    effort: "medium",
    schema: LearnedUpdate,
    system: [
      "You maintain a video creator's style profile. From their recent approvals, rejections and corrections, infer consistent preferences.",
      `Only propose a change when at least ${min} different feedback items point the same way; cite their ids as evidence. Ignore one-off corrections.`,
      `Settings (JSON pointer: type):\n${Object.entries(STYLE_PATHS).map(([p, t]) => `${p}: ${t}`).join("\n")}`,
      `Current profile:\n${describeStyle(input.settings, input.rules)}`,
      `Existing rules: ${JSON.stringify(input.rules.map((r) => ({ id: r.id, text: r.text, active: r.active })))}`,
    ].join("\n\n"),
    messages: [
      {
        role: "user",
        content: input.items.map((i) => `[${i.id}] ${i.kind}/${i.area}/${i.scope}: ${i.userText ? `"${i.userText}" — ` : ""}${i.summary}${i.ops?.length ? ` ops=${JSON.stringify(i.ops).slice(0, 400)}` : ""}`).join("\n"),
      },
    ],
  });
  const enough = (evidence: string[]) => new Set(evidence.filter((e) => ids.has(e))).size >= min;
  return {
    changes: object.changes.filter((c) => enough(c.evidence)),
    rules: object.rules.filter((r) => enough(r.evidence)),
    deactivateRuleIds: object.deactivateRuleIds.filter((id) => input.rules.some((r) => r.id === id)),
    summary: object.summary,
  };
}

/**
 * Deterministic numeric learning: the ideal clip duration drifts toward the
 * durations the user approves (EMA), once there are at least 3 approvals.
 */
export function durationFromApprovals(settings: StyleSettings, approvedDurationsSec: number[], alpha = 0.3): StyleChange[] {
  if (approvedDurationsSec.length < 3) return [];
  const mean = approvedDurationsSec.reduce((a, b) => a + b, 0) / approvedDurationsSec.length;
  const d = settings.pacing.clipDurationSec;
  const ideal = Math.round(d.ideal + alpha * (mean - d.ideal));
  if (Math.abs(ideal - d.ideal) < 2) return [];
  const changes: StyleChange[] = [{ path: "/pacing/clipDurationSec/ideal", value: ideal }];
  if (ideal < d.min) changes.push({ path: "/pacing/clipDurationSec/min", value: Math.max(5, ideal - 10) });
  if (ideal > d.max) changes.push({ path: "/pacing/clipDurationSec/max", value: ideal + 15 });
  return changes;
}

/** Provenance entries for a set of changes (why each setting has its value). */
export function provenanceFor(changes: StyleChange[], source: Provenance["source"], confidence: number, evidence: string[]): Record<string, Provenance> {
  return Object.fromEntries(changes.map((c) => [c.path, { source, confidence, evidence }]));
}
