import { EditOp, type EditOpInput, type JsonPatchOp, type Timeline } from "@editor/schemas";
import { groupWordsIntoCues } from "./captions";
import { applyCensorship } from "./censor";
import { jsonDiff } from "./json-diff";
import { validateTimeline } from "./validate";

export class EditOpError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(details.length ? `${message}\n${details.join("\n")}` : message);
    this.name = "EditOpError";
  }
}

export interface ApplyResult {
  timeline: Timeline;
  jsonPatch: JsonPatchOp[];
  ops: EditOp[];
}

/**
 * Applies typed edit operations atomically: either every op applies and the
 * result validates, or an EditOpError explains what is wrong. The input is
 * never mutated. The result's version is input.version + 1.
 */
export function applyOps(timeline: Timeline, rawOps: EditOpInput[]): ApplyResult {
  const ops = rawOps.map((o, i) => {
    const r = EditOp.safeParse(o);
    if (!r.success) throw new EditOpError(`op #${i} is malformed`, r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`));
    return r.data;
  });

  let t: Timeline = structuredClone(timeline);
  let recensor = false;
  ops.forEach((op, i) => {
    try {
      const r = applyOne(t, op);
      t = r.timeline;
      recensor ||= r.recensor;
    } catch (e) {
      if (e instanceof EditOpError) throw new EditOpError(`op #${i} (${op.op}): ${e.message}`, e.details);
      throw e;
    }
  });
  if (recensor) t = applyCensorship(t);
  t.version = timeline.version + 1;

  const v = validateTimeline(t);
  if (!v.ok) throw new EditOpError("the edit would produce an invalid timeline", v.errors);
  return { timeline: v.timeline, jsonPatch: jsonDiff(timeline, v.timeline), ops };
}

function applyOne(t: Timeline, op: EditOp): { timeline: Timeline; recensor: boolean } {
  const segIndex = (id: string) => {
    const i = t.segments.findIndex((s) => s.id === id);
    if (i < 0) throw new EditOpError(`segment "${id}" not found (have: ${t.segments.map((s) => s.id).join(", ")})`);
    return i;
  };
  const findWord = (wordId: string) => {
    for (const cue of t.captions.cues) {
      const w = cue.words.find((x) => x.wordId === wordId);
      if (w) return { cue, w };
    }
    throw new EditOpError(`word "${wordId}" is not in the captions`);
  };

  switch (op.op) {
    case "trim_segment": {
      const s = t.segments[segIndex(op.segmentId)]!;
      if (op.sourceStartMs !== undefined) s.sourceStartMs = op.sourceStartMs;
      if (op.sourceEndMs !== undefined) s.sourceEndMs = op.sourceEndMs;
      return { timeline: t, recensor: false };
    }
    case "split_segment": {
      const i = segIndex(op.segmentId);
      const s = t.segments[i]!;
      if (op.atSourceMs <= s.sourceStartMs || op.atSourceMs >= s.sourceEndMs) {
        throw new EditOpError(`split point ${op.atSourceMs} is outside segment [${s.sourceStartMs}, ${s.sourceEndMs})`);
      }
      const right = { ...s, id: uniqueId(t.segments.map((x) => x.id), `${s.id}b`), sourceStartMs: op.atSourceMs };
      delete right.transitionIn;
      s.sourceEndMs = op.atSourceMs;
      t.segments.splice(i + 1, 0, right);
      return { timeline: t, recensor: false };
    }
    case "delete_segment": {
      const i = segIndex(op.segmentId);
      if (t.segments.length === 1) throw new EditOpError("cannot delete the only segment");
      t.segments.splice(i, 1);
      const first = t.segments[0]!;
      if (first.transitionIn) delete first.transitionIn;
      return { timeline: t, recensor: false };
    }
    case "insert_segment": {
      if (t.segments.some((s) => s.id === op.segment.id)) throw new EditOpError(`segment id "${op.segment.id}" already exists`);
      const at = op.afterSegmentId === null ? 0 : segIndex(op.afterSegmentId) + 1;
      t.segments.splice(at, 0, op.segment);
      return { timeline: t, recensor: false };
    }
    case "reorder_segments": {
      const ids = t.segments.map((s) => s.id).sort();
      const wanted = [...op.order].sort();
      if (ids.length !== wanted.length || ids.some((id, i) => id !== wanted[i])) {
        throw new EditOpError(`order must list every segment exactly once (${t.segments.map((s) => s.id).join(", ")})`);
      }
      const byId = new Map(t.segments.map((s) => [s.id, s]));
      t.segments = op.order.map((id) => byId.get(id)!);
      if (t.segments[0]!.transitionIn) delete t.segments[0]!.transitionIn;
      return { timeline: t, recensor: false };
    }
    case "set_transition": {
      const s = t.segments[segIndex(op.segmentId)]!;
      if (op.transition) s.transitionIn = op.transition;
      else delete s.transitionIn;
      return { timeline: t, recensor: false };
    }
    case "edit_caption_word": {
      const { w } = findWord(op.wordId);
      if (op.text !== undefined) w.text = op.text;
      if (op.displayText === null) delete w.displayText;
      else if (op.displayText !== undefined) w.displayText = op.displayText;
      if (op.emphasis !== undefined) w.emphasis = op.emphasis;
      return { timeline: t, recensor: op.text !== undefined };
    }
    case "set_caption_style": {
      if (!op.cueIds) {
        t.style.resolved.captions = { ...t.style.resolved.captions, ...op.patch };
      } else {
        for (const id of op.cueIds) {
          const cue = t.captions.cues.find((c) => c.id === id);
          if (!cue) throw new EditOpError(`cue "${id}" not found`);
          cue.styleOverride = { ...(cue.styleOverride ?? {}), ...op.patch };
        }
      }
      return { timeline: t, recensor: false };
    }
    case "set_captions_enabled":
      t.captions.enabled = op.enabled;
      return { timeline: t, recensor: false };
    case "regroup_captions": {
      if (op.maxWordsPerLine) t.style.resolved.captions.maxWordsPerLine = op.maxWordsPerLine;
      const words = t.captions.cues.flatMap((c) => c.words);
      const byId = new Map(words.map((w) => [w.wordId, w]));
      const cues = groupWordsIntoCues(
        words.map((w) => ({ id: w.wordId, text: w.text, startMs: w.sourceStartMs, endMs: w.sourceEndMs, speaker: null, confidence: 1 })),
        { maxWordsPerLine: t.style.resolved.captions.maxWordsPerLine, maxLines: t.style.resolved.captions.maxLines },
      );
      // Keep per-word edits (emphasis, overrides, masks).
      t.captions.cues = cues.map((c) => ({ ...c, words: c.words.map((w) => byId.get(w.wordId) ?? w) }));
      return { timeline: t, recensor: false };
    }
    case "censor_word": {
      const { w } = findWord(op.wordId);
      w.censorOverride = "censor";
      if (op.audio) t.style.resolved.censorship.audio = op.audio;
      return { timeline: t, recensor: true };
    }
    case "uncensor_word": {
      const { w } = findWord(op.wordId);
      w.censorOverride = "allow";
      return { timeline: t, recensor: true };
    }
    case "add_blur":
      if (t.blurs.some((b) => b.id === op.region.id)) throw new EditOpError(`blur "${op.region.id}" already exists`);
      t.blurs.push(op.region);
      return { timeline: t, recensor: false };
    case "update_blur": {
      const i = t.blurs.findIndex((b) => b.id === op.id);
      if (i < 0) throw new EditOpError(`blur "${op.id}" not found`);
      t.blurs[i] = { ...t.blurs[i]!, ...op.patch };
      return { timeline: t, recensor: false };
    }
    case "remove_blur": {
      const n = t.blurs.length;
      t.blurs = t.blurs.filter((b) => b.id !== op.id);
      if (t.blurs.length === n) throw new EditOpError(`blur "${op.id}" not found`);
      return { timeline: t, recensor: false };
    }
    case "set_reframe": {
      const others = t.reframe.filter((r) => r.id !== op.track.id);
      // A new track wins over the parts of existing tracks it overlaps.
      const trimmed = others.flatMap((r) => subtractRange(r, op.track.sourceStartMs, op.track.sourceEndMs));
      t.reframe = [...trimmed, op.track].sort((a, b) => a.sourceStartMs - b.sourceStartMs);
      return { timeline: t, recensor: false };
    }
    case "remove_reframe":
      t.reframe = t.reframe.filter((r) => r.id !== op.id);
      return { timeline: t, recensor: false };
    case "add_overlay":
      if (t.overlays.some((o) => o.id === op.overlay.id)) throw new EditOpError(`overlay "${op.overlay.id}" already exists`);
      t.overlays.push(op.overlay);
      return { timeline: t, recensor: false };
    case "remove_overlay":
      t.overlays = t.overlays.filter((o) => o.id !== op.id);
      return { timeline: t, recensor: false };
    case "set_music":
      t.audio.music = op.cue ? [op.cue] : [];
      return { timeline: t, recensor: false };
    case "set_meta":
      if (op.title !== undefined) t.meta.title = op.title;
      if (op.hookText !== undefined) t.meta.hookText = op.hookText;
      return { timeline: t, recensor: false };
  }
}

function uniqueId(existing: string[], base: string): string {
  let id = base;
  let n = 2;
  while (existing.includes(id)) id = `${base}${n++}`;
  return id;
}

function subtractRange<T extends { id: string; sourceStartMs: number; sourceEndMs: number; keyframes: { tMs: number }[] }>(
  r: T,
  start: number,
  end: number,
): T[] {
  if (r.sourceEndMs <= start || r.sourceStartMs >= end) return [r];
  const out: T[] = [];
  const clip = (s: number, e: number, suffix: string) => {
    const kfs = r.keyframes.filter((k) => k.tMs >= s && k.tMs < e);
    const kept = kfs.length ? kfs : [{ ...r.keyframes[0]!, tMs: s }];
    out.push({ ...r, id: `${r.id}${suffix}`, sourceStartMs: s, sourceEndMs: e, keyframes: kept });
  };
  if (r.sourceStartMs < start) clip(r.sourceStartMs, start, "");
  if (r.sourceEndMs > end) clip(end, r.sourceEndMs, r.sourceStartMs < start ? "_b" : "");
  return out;
}
