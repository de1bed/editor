import type { CaptionCue, CaptionStyle, Word } from "@editor/schemas";

export interface GroupOptions {
  maxWordsPerLine: number;
  maxLines: number;
  /** Break a cue when the silence between words exceeds this. */
  maxGapMs?: number;
  /** Keep captions on screen a little after the last word, without overlapping the next cue. */
  tailMs?: number;
}

const SENTENCE_END = /[.!?…]["»”']?$/;

/**
 * Groups transcript words into caption cues. Deterministic: the same words and
 * options always give the same cues and ids.
 */
export function groupWordsIntoCues(words: readonly Word[], opts: GroupOptions): CaptionCue[] {
  const maxWords = Math.max(1, opts.maxWordsPerLine * opts.maxLines);
  const maxGap = opts.maxGapMs ?? 600;
  const tail = opts.tailMs ?? 250;
  const groups: Word[][] = [];
  let current: Word[] = [];
  for (const w of words) {
    if (!w.text.trim()) continue;
    const prev = current[current.length - 1];
    const breakHere =
      prev !== undefined &&
      (current.length >= maxWords ||
        w.startMs - prev.endMs > maxGap ||
        SENTENCE_END.test(prev.text) ||
        (w.speaker !== null && prev.speaker !== null && w.speaker !== prev.speaker));
    if (breakHere) {
      groups.push(current);
      current = [];
    }
    current.push(w);
  }
  if (current.length) groups.push(current);

  return groups.map((g, i) => {
    const first = g[0]!;
    const last = g[g.length - 1]!;
    const next = groups[i + 1]?.[0];
    const end = Math.max(last.endMs, Math.min(last.endMs + tail, next ? next.startMs : last.endMs + tail));
    return {
      id: `cue_${first.id}`,
      sourceStartMs: first.startMs,
      sourceEndMs: Math.max(end, first.startMs + 1),
      words: g.map((w) => ({
        wordId: w.id,
        text: w.text.trim(),
        sourceStartMs: w.startMs,
        sourceEndMs: Math.max(w.endMs, w.startMs),
        emphasis: false,
        censored: false,
      })),
    };
  });
}

export function groupOptionsFromStyle(style: CaptionStyle): GroupOptions {
  return { maxWordsPerLine: style.maxWordsPerLine, maxLines: style.maxLines };
}

/** Words fully or partially inside [startMs, endMs). */
export function wordsInRange(words: readonly Word[], startMs: number, endMs: number): Word[] {
  return words.filter((w) => w.endMs > startMs && w.startMs < endMs);
}
