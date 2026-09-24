import type { BlurRegion, DetectionTrack, Timeline } from "@editor/schemas";
import { outputToSource } from "./time";
import { reframeForSegment } from "./compile";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The part of the source frame visible in the output at a source instant,
 * normalized to the source (mirrors the crop the compiler generates).
 * For fit_blur_bg the whole frame is visible (letterboxed).
 */
export function cropWindowAt(t: Timeline, sourceMs: number): Rect & { letterboxed: boolean } {
  const seg = t.segments.find((s) => sourceMs >= s.sourceStartMs && sourceMs < s.sourceEndMs) ?? t.segments[0]!;
  const rf = reframeForSegment(t.reframe, seg, t.style.resolved.reframe.defaultMode);
  if (rf.mode === "fit_blur_bg") return { x: 0, y: 0, w: 1, h: 1, letterboxed: true };
  const srcW = t.source.width;
  const srcH = t.source.height;
  const aspect = t.output.width / t.output.height;
  const cropWpx = Math.min(srcW, (srcH / rf.zoom) * aspect);
  const cropHpx = cropWpx / aspect;
  let cx = rf.points[0]!.cx;
  let cy = rf.points[0]!.cy;
  for (let i = 0; i < rf.points.length; i++) {
    const a = rf.points[i]!;
    const b = rf.points[i + 1];
    if (!b || sourceMs < a.tMs) break;
    if (sourceMs <= b.tMs) {
      const u = rf.interpolation === "hold" || b.tMs === a.tMs ? 0 : (sourceMs - a.tMs) / (b.tMs - a.tMs);
      cx = a.cx + (b.cx - a.cx) * u;
      cy = a.cy + (b.cy - a.cy) * u;
      break;
    }
    cx = b.cx;
    cy = b.cy;
  }
  const x = Math.min(Math.max(cx * srcW - cropWpx / 2, 0), srcW - cropWpx) / srcW;
  const y = Math.min(Math.max(cy * srcH - cropHpx / 2, 0), srcH - cropHpx) / srcH;
  return { x, y, w: cropWpx / srcW, h: cropHpx / srcH, letterboxed: false };
}

/** A box drawn on the output (normalized to the 9:16 frame) at `outputMs` → source-normalized box. */
export function outputBoxToSource(t: Timeline, outputMs: number, box: Rect): { sourceMs: number; box: Rect } | null {
  const at = outputToSource(t.segments, outputMs);
  if (!at) return null;
  const win = cropWindowAt(t, at.sourceMs);
  if (win.letterboxed) {
    // Full frame scaled to the output width, centered vertically.
    const frameH = (t.source.height / t.source.width) * (t.output.width / t.output.height);
    const top = (1 - frameH) / 2;
    const y = (box.y - top) / frameH;
    const h = box.h / frameH;
    return { sourceMs: at.sourceMs, box: clampRect({ x: box.x, y, w: box.w, h }) };
  }
  return {
    sourceMs: at.sourceMs,
    box: clampRect({ x: win.x + box.x * win.w, y: win.y + box.y * win.h, w: box.w * win.w, h: box.h * win.h }),
  };
}

export function clampRect(r: Rect): Rect {
  const x = Math.min(Math.max(r.x, 0), 1);
  const y = Math.min(Math.max(r.y, 0), 1);
  return { x, y, w: Math.max(0.001, Math.min(r.w, 1 - x)), h: Math.max(0.001, Math.min(r.h, 1 - y)) };
}

/** Detection track → blur region over the part of the track inside [startMs, endMs). */
export function detectionToBlur(d: DetectionTrack, opts: { id: string; effect?: BlurRegion["effect"]; startMs?: number; endMs?: number }): BlurRegion | null {
  const start = Math.max(d.startMs, opts.startMs ?? 0);
  const end = Math.min(d.endMs, opts.endMs ?? Number.MAX_SAFE_INTEGER);
  if (end <= start) return null;
  const kfs = d.keyframes.map((k) => ({ tMs: k.tMs, ...clampRect(k) })).sort((a, b) => a.tMs - b.tMs);
  return {
    id: opts.id,
    label: d.query,
    kind: d.kind === "person" ? "custom" : d.kind,
    sourceStartMs: start,
    sourceEndMs: end,
    shape: d.kind === "face" ? "ellipse" : "rect",
    keyframes: kfs,
    effect: opts.effect ?? { type: "gaussian", strength: 30 },
    featherPx: 0,
    detectionTrackId: d.id,
  };
}
