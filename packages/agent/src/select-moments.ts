import type { LearnedRule, StyleSettings, Transcript } from "@editor/schemas";
import { formatTimecode } from "@editor/core";
import type { LLMProvider, Usage } from "@editor/llm";
import { z } from "zod";

export interface MomentProposal {
  startMs: number;
  endMs: number;
  title: string;
  hookText: string;
  justification: string;
  scores: { hook: number; payoff: number; standalone: number; emotion: number; durationFit: number; total: number };
}

const BlockOutput = z.object({
  moments: z
    .array(
      z.object({
        startSentence: z.string().describe("id of the first sentence, e.g. s12"),
        endSentence: z.string().describe("id of the last sentence (inclusive)"),
        title: z.string().describe("short catchy title in the transcript language"),
        hook: z.string().describe("the opening line that grabs attention (quote)"),
        justification: z.string().describe("one or two sentences: why this works as a standalone short"),
        hookScore: z.number().describe("0-10: do the first seconds make people stop scrolling?"),
        payoffScore: z.number().describe("0-10: does it end on a complete thought/punchline, not mid-idea?"),
        standaloneScore: z.number().describe("0-10: understandable without the rest of the video"),
        emotionScore: z.number().describe("0-10: humor, surprise, controversy, insight, emotion"),
      }),
    )
    .describe("best candidate moments in this block, best first"),
});

export interface SelectMomentsOptions {
  transcript: Transcript;
  style: StyleSettings;
  learnedRules?: LearnedRule[];
  /** Summaries of past approvals/rejections retrieved by similarity (style learning). */
  examples?: string[];
  count: number;
  /** Transcript block size sent per LLM call. */
  blockMs?: number;
  llm: LLMProvider;
  onProgress?: (fraction: number) => void;
}

/**
 * Finds the best short-form moments of a long transcript. The LLM only picks
 * sentence ranges and scores them; times always come from the transcript, so
 * clips start and end on sentence boundaries.
 */
export async function selectMoments(o: SelectMomentsOptions): Promise<{ moments: MomentProposal[]; usage: Usage }> {
  const { transcript, style } = o;
  const sentences = transcript.sentences.length ? transcript.sentences : synthesizeSentences(transcript);
  const byId = new Map(sentences.map((s, i) => [s.id, { s, i }]));
  const wordText = new Map(transcript.words.map((w) => [w.id, w.text]));
  const speakers = new Map(transcript.speakers.map((s) => [s.id, s.label]));
  const dur = style.pacing.clipDurationSec;
  const blockMs = o.blockMs ?? 12 * 60_000;
  const overlapMs = (dur.max + 15) * 1000;

  // Blocks overlap by one max-length clip so no moment is lost at a boundary.
  const blocks: (typeof sentences)[] = [];
  for (let start = 0; start < transcript.durationMs; start += blockMs) {
    const b = sentences.filter((s) => s.startMs >= start - (start ? overlapMs : 0) && s.startMs < start + blockMs);
    if (b.length) blocks.push(b);
  }
  const perBlock = Math.max(3, Math.ceil((o.count * 2) / Math.max(1, blocks.length)));
  const rules = (o.learnedRules ?? []).filter((r) => r.active && (r.appliesTo === "clip_selection" || r.appliesTo === "general"));

  const system = [
    "You are a senior short-form video editor. From a long video transcript you pick moments that work as vertical clips (TikTok, Reels, Shorts).",
    `Target duration: ${dur.min}–${dur.max} s (ideal ${dur.ideal} s). Preferred hook style: ${style.hook.type.replace("_", " ")}; the hook must land within ${style.hook.maxHookSec} s.`,
    "A great clip opens with a strong hook, stays understandable without context, and ends on a complete thought or punchline.",
    "Reference sentences only by their ids. Never invent text. Titles and justifications in the transcript's language.",
    rules.length ? `This creator's learned preferences:\n${rules.map((r) => `- ${r.text}`).join("\n")}` : "",
    o.examples?.length ? `Past decisions by this creator (follow the pattern):\n${o.examples.map((e) => `- ${e}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const candidates: MomentProposal[] = [];
  let done = 0;
  // Blocks are independent: score them concurrently (bounded).
  await mapLimit(blocks, 4, async (block) => {
    const lines = block.map((s) => {
      const text = s.wordIds.map((id) => wordText.get(id) ?? "").join(" ");
      const who = s.speaker ? `${speakers.get(s.speaker) ?? s.speaker}: ` : "";
      return `[${s.id} ${formatTimecode(s.startMs)}–${formatTimecode(s.endMs)}] ${who}${text}`;
    });
    const res = await o.llm.generateObject({
      system,
      name: "moments",
      model: "fast",
      schema: BlockOutput,
      messages: [{ role: "user", content: `Transcript block:\n${lines.join("\n")}\n\nPropose up to ${perBlock} moments.` }],
    });
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    for (const m of res.object.moments) {
      const a = byId.get(m.startSentence);
      const b = byId.get(m.endSentence);
      if (!a || !b || b.i < a.i) continue;
      const startMs = a.s.startMs;
      const endMs = b.s.endMs;
      const lenSec = (endMs - startMs) / 1000;
      if (lenSec < dur.min * 0.6 || lenSec > dur.max * 1.4) continue;
      const clamp = (x: number) => Math.max(0, Math.min(10, x));
      const durationFit = clamp(10 - (Math.abs(lenSec - dur.ideal) / Math.max(1, dur.max - dur.min)) * 10);
      const scores = { hook: clamp(m.hookScore), payoff: clamp(m.payoffScore), standalone: clamp(m.standaloneScore), emotion: clamp(m.emotionScore), durationFit, total: 0 };
      scores.total = round(0.3 * scores.hook + 0.25 * scores.payoff + 0.2 * scores.standalone + 0.15 * scores.emotion + 0.1 * scores.durationFit);
      candidates.push({ startMs, endMs, title: m.title.trim(), hookText: m.hook.trim(), justification: m.justification.trim(), scores });
    }
    o.onProgress?.(++done / blocks.length);
  });

  return { moments: pickNonOverlapping(candidates, o.count), usage };
}

/** Highest total first; drops candidates overlapping an already picked one by more than 30%. */
export function pickNonOverlapping(candidates: MomentProposal[], count: number): MomentProposal[] {
  const picked: MomentProposal[] = [];
  for (const c of [...candidates].sort((a, b) => b.scores.total - a.scores.total)) {
    const clash = picked.some((p) => {
      const inter = Math.min(p.endMs, c.endMs) - Math.max(p.startMs, c.startMs);
      return inter > 0.3 * Math.min(p.endMs - p.startMs, c.endMs - c.startMs);
    });
    if (!clash) picked.push(c);
    if (picked.length >= count) break;
  }
  return picked;
}

/** Transcripts without sentence segmentation: split on punctuation and pauses. */
function synthesizeSentences(t: Transcript): Transcript["sentences"] {
  const out: Transcript["sentences"] = [];
  let cur: Transcript["words"] = [];
  const flush = () => {
    if (cur.length) out.push({ id: `s${out.length}`, startMs: cur[0]!.startMs, endMs: cur[cur.length - 1]!.endMs, wordIds: cur.map((w) => w.id), speaker: cur[0]!.speaker });
    cur = [];
  };
  for (const w of t.words) {
    const last = cur[cur.length - 1];
    if (last && (w.startMs - last.endMs > 1200 || cur.length >= 40)) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.text)) flush();
  }
  flush();
  return out;
}

async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
}

const round = (x: number) => Math.round(x * 100) / 100;
