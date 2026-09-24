import type { FaceAnalysis, FaceTrack, ReframeTrack, StyleSettings } from "@editor/schemas";

export interface PlanReframeOptions {
  startMs: number;
  endMs: number;
  /** Diarized speaker turns inside the range. */
  turns: { speaker: string; startMs: number; endMs: number }[];
  outputAspect: number;
  sourceAspect: number;
  settings: StyleSettings["reframe"];
  /** Turns shorter than this do not trigger a camera switch. */
  minShotMs?: number;
}

/**
 * Face analysis → reframe tracks ("camera shots"). Each shot follows one face:
 * the face of whoever is speaking (diarization ↔ face matching done by the
 * worker), held through short interjections so the camera does not flicker.
 * Returns [] when no crop is needed or no face was found (centered crop).
 */
export function planReframe(analysis: FaceAnalysis, o: PlanReframeOptions): ReframeTrack[] {
  if (o.sourceAspect <= o.outputAspect + 1e-3) return [];
  if (o.settings.defaultMode === "fit_blur_bg") {
    return [{ id: "rf_0", sourceStartMs: o.startMs, sourceEndMs: o.endMs, mode: "fit_blur_bg", keyframes: [{ tMs: o.startMs, cx: 0.5, cy: 0.5, zoom: 1 }], interpolation: "hold" }];
  }
  const faces = analysis.tracks.filter((t) => t.endMs > o.startMs && t.startMs < o.endMs);
  if (faces.length === 0) return [];
  const minShot = o.minShotMs ?? 1200;

  // Who is on camera, over time.
  const bySpeaker = new Map<string, FaceTrack>();
  for (const f of faces) if (f.speakerId && !bySpeaker.has(f.speakerId)) bySpeaker.set(f.speakerId, f);
  const dominant = [...faces].sort((a, b) => weight(b) - weight(a))[0]!;

  type Shot = { face: FaceTrack; startMs: number; endMs: number };
  const shots: Shot[] = [];
  const push = (face: FaceTrack, s: number, e: number) => {
    const last = shots[shots.length - 1];
    if (last && last.face.id === face.id) last.endMs = Math.max(last.endMs, e);
    else shots.push({ face, startMs: s, endMs: e });
  };
  let cursor = o.startMs;
  let current = dominant;
  if (o.settings.defaultMode === "track" && bySpeaker.size > 0) {
    const turns = o.turns.filter((t) => t.endMs > o.startMs && t.startMs < o.endMs).sort((a, b) => a.startMs - b.startMs);
    const first = turns.find((t) => bySpeaker.has(t.speaker));
    if (first) current = bySpeaker.get(first.speaker)!;
    for (const t of turns) {
      const face = bySpeaker.get(t.speaker);
      if (!face || face.id === current.id || t.endMs - t.startMs < minShot) continue;
      const cut = Math.max(cursor, Math.min(o.endMs, t.startMs));
      if (cut > cursor) push(current, cursor, cut);
      cursor = cut;
      current = face;
    }
  }
  push(current, cursor, o.endMs);

  // Merge shots that ended up too short (e.g. cut right at the range start).
  const merged: Shot[] = [];
  for (const s of shots) {
    const prev = merged[merged.length - 1];
    if (prev && s.endMs - s.startMs < minShot / 2) prev.endMs = s.endMs;
    else merged.push({ ...s });
  }

  return merged
    .filter((s) => s.endMs > s.startMs)
    .map((s, i) => ({
      id: `rf_${i}`,
      sourceStartMs: s.startMs,
      sourceEndMs: s.endMs,
      mode: o.settings.defaultMode === "fixed" ? ("fixed" as const) : ("track" as const),
      ...(s.face.speakerId ? { speakerId: s.face.speakerId } : {}),
      keyframes: cameraPath(s.face, s.startMs, s.endMs, o.settings.smoothing, o.settings.defaultMode === "fixed"),
      interpolation: "linear" as const,
    }));
}

function weight(f: FaceTrack): number {
  const area = f.keyframes.reduce((a, k) => a + k.w * k.h, 0) / f.keyframes.length;
  return area * (f.endMs - f.startMs);
}

/**
 * Smoothed crop centers following a face: exponential smoothing plus a dead
 * zone (small head movements do not move the camera), then only the keyframes
 * where the path changes direction or speed are kept.
 */
export function cameraPath(face: FaceTrack, startMs: number, endMs: number, smoothing: number, fixed: boolean): ReframeTrack["keyframes"] {
  const pts = face.keyframes.map((k) => ({ tMs: k.tMs, cx: k.x + k.w / 2, cy: Math.max(0, k.y + k.h / 2 - k.h * 0.15) }));
  const at = (t: number) => {
    const inside = pts.filter((p) => p.tMs >= startMs && p.tMs <= endMs);
    if (inside.length) return inside;
    const nearest = pts.reduce((b, p) => (Math.abs(p.tMs - t) < Math.abs(b.tMs - t) ? p : b));
    return [nearest];
  };
  const inRange = at(startMs);
  if (fixed || inRange.length === 1) {
    const cx = inRange.reduce((a, p) => a + p.cx, 0) / inRange.length;
    const cy = inRange.reduce((a, p) => a + p.cy, 0) / inRange.length;
    return [{ tMs: startMs, cx: clamp01(cx), cy: clamp01(cy), zoom: 1 }];
  }
  const alpha = 1 - Math.min(0.95, Math.max(0, smoothing));
  const deadZone = 0.03;
  let cam = { cx: inRange[0]!.cx, cy: inRange[0]!.cy };
  const out: ReframeTrack["keyframes"] = [{ tMs: startMs, cx: clamp01(cam.cx), cy: clamp01(cam.cy), zoom: 1 }];
  for (const p of inRange) {
    const dx = p.cx - cam.cx;
    const dy = p.cy - cam.cy;
    if (Math.abs(dx) > deadZone || Math.abs(dy) > deadZone) {
      cam = { cx: cam.cx + alpha * dx, cy: cam.cy + alpha * dy };
    }
    if (p.tMs > out[out.length - 1]!.tMs) out.push({ tMs: p.tMs, cx: clamp01(cam.cx), cy: clamp01(cam.cy), zoom: 1 });
  }
  return thin(out);
}

function thin(k: ReframeTrack["keyframes"]): ReframeTrack["keyframes"] {
  if (k.length <= 2) return k;
  const out = [k[0]!];
  for (let i = 1; i < k.length - 1; i++) {
    const a = out[out.length - 1]!;
    const b = k[i + 1]!;
    const p = k[i]!;
    const u = (p.tMs - a.tMs) / (b.tMs - a.tMs || 1);
    const ex = Math.abs(a.cx + (b.cx - a.cx) * u - p.cx);
    const ey = Math.abs(a.cy + (b.cy - a.cy) * u - p.cy);
    if (ex > 0.004 || ey > 0.004) out.push(p);
  }
  out.push(k[k.length - 1]!);
  return out;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
