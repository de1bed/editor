import type { BlurRegion, RenderPlan, ReframeTrack, Segment, Timeline } from "@editor/schemas";
import { timelineToAss } from "./ass";
import { FONT_FACES } from "./fonts";
import { hashValue } from "./hash";
import { mapSegments, mapSourceRange, outputDurationMs } from "./time";

export interface CompileOptions {
  quality: "preview" | "final";
  /** Size of the video that will actually be decoded (proxy for preview, original for final). */
  inputSize: { width: number; height: number };
  /** False when the decoded file has no audio stream (silence is generated instead). */
  inputHasAudio?: boolean;
  /** Preview is rendered at this fraction of the output size. */
  previewScale?: number;
}

const QUALITY = {
  preview: { preset: "veryfast", crf: "30", audioBitrate: "96k" },
  final: { preset: "medium", crf: "19", audioBitrate: "192k" },
} as const;

/**
 * Timeline → RenderPlan: a single FFmpeg invocation with placeholders.
 * Pure and deterministic: same timeline + options → same plan and hash.
 *
 * Graph: one input per segment (fast input seeking), per-segment blur →
 * reframe → scale, concat, zoom overlays, burned-in ASS captions; audio gets
 * censorship mutes per segment, then bleeps and music are mixed in output time.
 */
export function compileTimeline(t: Timeline, opts: CompileOptions): RenderPlan {
  const scale = opts.quality === "preview" ? (opts.previewScale ?? 0.5) : 1;
  const W = even(t.output.width * scale);
  const H = even(t.output.height * scale);
  const fps = t.output.fps;
  const hasAudio = opts.inputHasAudio ?? true;
  const q = QUALITY[opts.quality];
  const mapped = mapSegments(t.segments);
  const durationMs = outputDurationMs(t.segments);
  const variant = opts.quality === "preview" && t.source.proxyAssetId ? "proxy" : "source";
  const srcAssetId = variant === "proxy" ? t.source.proxyAssetId! : t.source.assetId;

  const args: string[] = ["-hide_banner", "-nostdin", "-y"];
  const filters: string[] = [];
  const inputs: RenderPlan["inputs"] = { src: { assetId: srcAssetId, variant } };

  // ---- inputs: one per segment, seeked on the input side (fast and frame-accurate when re-encoding)
  for (const s of t.segments) {
    args.push("-ss", sec(s.sourceStartMs), "-t", sec(s.sourceEndMs - s.sourceStartMs), "-i", "{{input:src}}");
  }
  let nextInput = t.segments.length;
  const musicInputs: number[] = [];
  for (const m of t.audio.music) {
    const key = `music_${m.id}`;
    inputs[key] = { assetId: m.assetId, variant: "music" };
    args.push("-stream_loop", "-1", "-i", `{{input:${key}}}`);
    musicInputs.push(nextInput++);
  }

  // ---- per-segment chains
  t.segments.forEach((seg, i) => {
    let label = `${i}:v`;
    const chain = (body: string, out: string) => {
      filters.push(`[${label}]${body}[${out}]`);
      label = out;
    };
    chain("setpts=PTS-STARTPTS", `v${i}s`);

    // Blur regions (source time → t + offset)
    let piece = 0;
    for (const region of t.blurs) {
      for (const p of blurPieces(region, seg)) {
        const id = `v${i}b${piece++}`;
        const box = pieceGeometry(p);
        const cropW = `trunc(${num(box.w)}*iw/2)*2`;
        const cropH = `trunc(${num(box.h)}*ih/2)*2`;
        const cx = lerpExpr(p.t0, p.t1, box.cx0, box.cx1, seg.sourceStartMs);
        const cy = lerpExpr(p.t0, p.t1, box.cy0, box.cy1, seg.sourceStartMs);
        const effect = blurEffectFilter(region, box, opts.inputSize);
        const shape = region.shape === "ellipse" ? `,${ellipseAlpha()}` : "";
        filters.push(`[${label}]split[${id}m][${id}c]`);
        filters.push(
          `[${id}c]crop=w='${cropW}':h='${cropH}':x='clip((${cx})*iw-out_w/2,0,iw-out_w)':y='clip((${cy})*ih-out_h/2,0,ih-out_h)',${effect}${shape}[${id}e]`,
        );
        const a = sec(p.t0 - seg.sourceStartMs);
        const b = sec(p.t1 - seg.sourceStartMs);
        filters.push(
          `[${id}m][${id}e]overlay=x='clip((${cx})*W-w/2,0,W-w)':y='clip((${cy})*H-h/2,0,H-h)':enable='between(t,${a},${b})':eval=frame[${id}]`,
        );
        label = id;
      }
    }

    // Reframe to the output aspect
    const aspect = t.output.width / t.output.height;
    const rf = reframeForSegment(t.reframe, seg, t.style.resolved.reframe.defaultMode);
    if (rf.mode === "fit_blur_bg") {
      filters.push(`[${label}]split[v${i}bg][v${i}fg]`);
      filters.push(`[v${i}bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=${Math.round(W / 20)}[v${i}bgb]`);
      filters.push(`[v${i}fg]scale=${W}:-2[v${i}fgs]`);
      filters.push(`[v${i}bgb][v${i}fgs]overlay=(W-w)/2:(H-h)/2[v${i}r]`);
      label = `v${i}r`;
    } else {
      const z = num(rf.zoom);
      const cw = `trunc(min(iw,ih/${z}*${num(aspect)})/2)*2`;
      const ch = `trunc(min(iw,ih/${z}*${num(aspect)})/${num(aspect)}/2)*2`;
      const cx = piecewiseExpr(rf.points.map((p) => ({ tMs: p.tMs, v: p.cx })), rf.interpolation, seg.sourceStartMs);
      const cy = piecewiseExpr(rf.points.map((p) => ({ tMs: p.tMs, v: p.cy })), rf.interpolation, seg.sourceStartMs);
      chain(`crop=w='${cw}':h='${ch}':x='clip((${cx})*iw-out_w/2,0,iw-out_w)':y='clip((${cy})*ih-out_h/2,0,ih-out_h)'`, `v${i}r`);
    }
    chain(`scale=${W}:${H}:flags=lanczos,setsar=1,fps=${fps},format=yuv420p`, `v${i}`);

    // Audio: normalize, then mute censored ranges (bleeps are mixed later)
    const aIn = hasAudio ? `[${i}:a]` : "";
    const aSrc = hasAudio
      ? `${aIn}asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${sec(seg.sourceEndMs - seg.sourceStartMs)}`;
    const mutes = t.audio.events
      .filter((e) => e.type === "mute" || e.type === "bleep" || e.type === "duck")
      .map((e) => ({ e, s: Math.max(e.sourceStartMs, seg.sourceStartMs), en: Math.min(e.sourceEndMs, seg.sourceEndMs) }))
      .filter((x) => x.en > x.s)
      .map(({ e, s, en }) => {
        const vol = e.type === "duck" ? `${e.gainDb ?? -12}dB` : "0";
        return `volume=${vol}:enable='between(t,${sec(s - seg.sourceStartMs)},${sec(en - seg.sourceStartMs)})'`;
      });
    filters.push(`${aSrc}${mutes.length ? "," + mutes.join(",") : ""}[a${i}]`);
  });

  // ---- concat
  const n = t.segments.length;
  filters.push(`${t.segments.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${n}:v=1:a=1[vc][ac]`);

  // ---- zoom overlays (output time)
  let vLabel = "vc";
  const zooms = t.overlays.filter((o) => o.type === "zoom");
  if (zooms.length) {
    const z = zooms
      .map((o) => {
        const a = sec(o.outputStartMs);
        const b = sec(o.outputEndMs);
        const s = num(o.scale - 1);
        const ramp =
          o.easing === "punch"
            ? `min(1,(it-${a})/0.08)`
            : o.easing === "ease_in_out"
              ? `sin(PI*(it-${a})/(${b}-${a}))`
              : "1";
        return `between(it,${a},${b})*${s}*${ramp}`;
      })
      .join("+");
    filters.push(`[vc]zoompan=z='1+${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${fps}[vz]`);
    vLabel = "vz";
  }

  // ---- captions and text overlays
  const ass = timelineToAss(t);
  const needsAss = (t.captions.enabled && t.captions.cues.length > 0) || t.overlays.some((o) => o.type === "text");
  if (needsAss) {
    filters.push(`[${vLabel}]ass=filename='{{file:captions.ass}}':fontsdir='{{fontsdir}}'[vout]`);
  } else {
    filters.push(`[${vLabel}]null[vout]`);
  }

  // ---- bleeps (output time)
  const mixIn: string[] = ["[ac]"];
  let b = 0;
  for (const e of t.audio.events) {
    if (e.type !== "bleep") continue;
    for (const iv of mapSourceRange(mapped, e.sourceStartMs, e.sourceEndMs)) {
      const id = `bl${b++}`;
      filters.push(
        `sine=frequency=${e.bleepHz ?? 1000}:sample_rate=48000:duration=${sec(iv.outputEndMs - iv.outputStartMs)},volume=-8dB,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${iv.outputStartMs}:all=1[${id}]`,
      );
      mixIn.push(`[${id}]`);
    }
  }
  let aLabel = "ac";
  if (mixIn.length > 1) {
    filters.push(`${mixIn.join("")}amix=inputs=${mixIn.length}:normalize=0:duration=first[am]`);
    aLabel = "am";
  }

  // ---- music with ducking under speech
  t.audio.music.forEach((m, k) => {
    const idx = musicInputs[k]!;
    const len = m.outputEndMs - m.outputStartMs;
    const fo = Math.min(m.fadeOutMs, len);
    filters.push(
      `[${idx}:a]atrim=start=${sec(m.offsetMs)}:duration=${sec(len)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${m.gainDb}dB,afade=t=in:d=${sec(Math.min(m.fadeInMs, len))},afade=t=out:st=${sec(len - fo)}:d=${sec(fo)},adelay=${m.outputStartMs}:all=1[mu${k}]`,
    );
    const ratio = Math.min(20, Math.max(1, Math.round(Math.abs(m.duckUnderSpeechDb) / 1.5)));
    filters.push(`[${aLabel}]asplit[sp${k}][sc${k}]`);
    filters.push(`[mu${k}][sc${k}]sidechaincompress=threshold=0.03:ratio=${ratio}:attack=20:release=400[mud${k}]`);
    filters.push(`[sp${k}][mud${k}]amix=inputs=2:normalize=0:duration=first[amu${k}]`);
    aLabel = `amu${k}`;
  });

  filters.push(`[${aLabel}]volume=${t.audio.masterGainDb}dB,alimiter=limit=0.95[aout]`);

  args.push(
    "-filter_complex",
    filters.join(";\n"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    q.preset,
    "-crf",
    q.crf,
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-c:a",
    "aac",
    "-b:a",
    q.audioBitrate,
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    "-t",
    sec(durationMs),
    "{{output}}",
  );

  const files: Record<string, string> = needsAss ? { "captions.ass": ass } : {};
  const fonts = FONT_FACES.map((f) => f.file);
  const body = {
    version: 1 as const,
    quality: opts.quality,
    inputs,
    files,
    fonts,
    args,
    output: { container: "mp4" as const, width: W, height: H, fps, durationMs },
  };
  return { ...body, hash: hashValue(body) };
}

// ---------------------------------------------------------------- helpers

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/** Milliseconds → seconds string with ms precision. */
function sec(ms: number): string {
  return (ms / 1000).toFixed(3);
}

function num(n: number): string {
  return Number(n.toFixed(5)).toString();
}

interface Point {
  tMs: number;
  v: number;
}

/**
 * Piecewise function of time as an FFmpeg expression. `t` inside the filter is
 * segment-local; source time is t + offset.
 */
export function piecewiseExpr(points: Point[], interpolation: "hold" | "linear" | "smooth", offsetMs: number): string {
  const pts = simplify(points, 0.002);
  if (pts.length === 0) return "0.5";
  if (pts.length === 1) return num(pts[0]!.v);
  const T = `(t+${sec(offsetMs)})`;
  let expr = num(pts[pts.length - 1]!.v);
  for (let i = pts.length - 2; i >= 0; i--) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const t0 = sec(a.tMs);
    const t1 = sec(b.tMs);
    let seg: string;
    if (interpolation === "hold" || b.tMs - a.tMs <= 1 || a.v === b.v) {
      seg = num(a.v);
    } else {
      const u = `((${T}-${t0})/(${t1}-${t0}))`;
      const f = interpolation === "smooth" ? `(${u}*${u}*(3-2*${u}))` : u;
      seg = `(${num(a.v)}+(${num(b.v - a.v)})*${f})`;
    }
    expr = `if(lt(${T},${t1}),${seg},${expr})`;
  }
  return `if(lt(${T},${sec(pts[0]!.tMs)}),${num(pts[0]!.v)},${expr})`;
}

/** Drops keyframes that linear interpolation already predicts (keeps expressions short). */
export function simplify(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;
  const out: Point[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1]!;
    const p = points[i]!;
    const b = points[i + 1]!;
    const span = b.tMs - a.tMs;
    const predicted = span > 0 ? a.v + ((b.v - a.v) * (p.tMs - a.tMs)) / span : a.v;
    // Keep hard jumps (two points ≤1ms apart) and anything off the line.
    if (Math.abs(predicted - p.v) > epsilon || b.tMs - p.tMs <= 1 || p.tMs - a.tMs <= 1) out.push(p);
  }
  out.push(points[points.length - 1]!);
  return out;
}

function lerpExpr(t0: number, t1: number, v0: number, v1: number, offsetMs: number): string {
  if (t1 <= t0 || v0 === v1) return num(v0);
  return piecewiseExpr(
    [
      { tMs: t0, v: v0 },
      { tMs: t1, v: v1 },
    ],
    "linear",
    offsetMs,
  );
}

interface BlurPiece {
  t0: number;
  t1: number;
  k0: BlurRegion["keyframes"][number];
  k1: BlurRegion["keyframes"][number];
}

/** Splits a region into pieces between keyframes, clipped to a segment. */
export function blurPieces(region: BlurRegion, seg: Segment): BlurPiece[] {
  const start = Math.max(region.sourceStartMs, seg.sourceStartMs);
  const end = Math.min(region.sourceEndMs, seg.sourceEndMs);
  if (end <= start) return [];
  const kf = region.keyframes;
  const pieces: BlurPiece[] = [];
  const first = kf[0]!;
  const last = kf[kf.length - 1]!;
  const push = (t0: number, t1: number, k0: BlurPiece["k0"], k1: BlurPiece["k1"]) => {
    const a = Math.max(t0, start);
    const b = Math.min(t1, end);
    if (b > a) pieces.push({ t0: a, t1: b, k0: interpolateBox(k0, k1, t0, t1, a), k1: interpolateBox(k0, k1, t0, t1, b) });
  };
  push(Number.NEGATIVE_INFINITY, first.tMs, first, first);
  for (let i = 0; i < kf.length - 1; i++) push(kf[i]!.tMs, kf[i + 1]!.tMs, kf[i]!, kf[i + 1]!);
  push(last.tMs, Number.POSITIVE_INFINITY, last, last);
  return pieces;
}

function interpolateBox(k0: BlurPiece["k0"], k1: BlurPiece["k1"], t0: number, t1: number, t: number): BlurPiece["k0"] {
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return { ...k0, tMs: t };
  const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  const l = (a: number, b: number) => a + (b - a) * u;
  return { tMs: t, x: l(k0.x, k1.x), y: l(k0.y, k1.y), w: l(k0.w, k1.w), h: l(k0.h, k1.h) };
}

function pieceGeometry(p: BlurPiece) {
  return {
    w: Math.min(1, Math.max(p.k0.w, p.k1.w)),
    h: Math.min(1, Math.max(p.k0.h, p.k1.h)),
    cx0: p.k0.x + p.k0.w / 2,
    cy0: p.k0.y + p.k0.h / 2,
    cx1: p.k1.x + p.k1.w / 2,
    cy1: p.k1.y + p.k1.h / 2,
  };
}

function blurEffectFilter(region: BlurRegion, box: { w: number; h: number }, input: { width: number; height: number }): string {
  const minSide = Math.max(2, Math.min(box.w * input.width, box.h * input.height));
  const k = region.effect.strength / 100;
  switch (region.effect.type) {
    case "gaussian":
      return `gblur=sigma=${Math.max(2, Math.round(minSide * 0.25 * k))}:steps=2`;
    case "pixelate": {
      const block = Math.max(2, Math.round((minSide / 4) * k));
      return `pixelize=width=${block}:height=${block}`;
    }
    case "solid":
      return "drawbox=x=0:y=0:w=iw:h=ih:color=black@1:t=fill";
  }
}

function ellipseAlpha(): string {
  return "format=yuva420p,geq=lum='p(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lte(pow(2*X/W-1,2)+pow(2*Y/H-1,2),1),255,0)'";
}

interface SegmentReframe {
  mode: ReframeTrack["mode"];
  zoom: number;
  interpolation: ReframeTrack["interpolation"];
  points: { tMs: number; cx: number; cy: number }[];
}

/**
 * Crop path for one segment: keyframes of every reframe track that overlaps it,
 * held flat at track edges (hard cut between speakers). No track → centered.
 */
export function reframeForSegment(tracks: readonly ReframeTrack[], seg: Segment, defaultMode: ReframeTrack["mode"]): SegmentReframe {
  const overlapping = tracks
    .filter((r) => r.sourceStartMs < seg.sourceEndMs && r.sourceEndMs > seg.sourceStartMs)
    .sort((a, b) => a.sourceStartMs - b.sourceStartMs);
  if (overlapping.length === 0) {
    return { mode: defaultMode === "fit_blur_bg" ? "fit_blur_bg" : "fixed", zoom: 1, interpolation: "hold", points: [{ tMs: seg.sourceStartMs, cx: 0.5, cy: 0.5 }] };
  }
  const first = overlapping[0]!;
  const points: SegmentReframe["points"] = [];
  for (const tr of overlapping) {
    const kfs = tr.keyframes;
    const at = (tMs: number) => valueAt(kfs, tMs);
    const s = Math.max(tr.sourceStartMs, seg.sourceStartMs);
    const e = Math.min(tr.sourceEndMs, seg.sourceEndMs);
    const startV = at(s);
    points.push({ tMs: s, cx: startV.cx, cy: startV.cy });
    for (const k of kfs) if (k.tMs > s && k.tMs < e - 1) points.push({ tMs: k.tMs, cx: k.cx, cy: k.cy });
    const endV = at(e - 1);
    points.push({ tMs: e - 1, cx: endV.cx, cy: endV.cy });
  }
  const zoom = first.keyframes.reduce((acc, k) => acc + k.zoom, 0) / first.keyframes.length;
  return {
    mode: first.mode === "fit_blur_bg" ? "fit_blur_bg" : first.mode === "split" ? "track" : first.mode,
    zoom,
    interpolation: first.interpolation,
    points,
  };
}

function valueAt(kfs: ReframeTrack["keyframes"], tMs: number): { cx: number; cy: number } {
  const first = kfs[0]!;
  if (tMs <= first.tMs) return first;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]!;
    const b = kfs[i + 1]!;
    if (tMs >= a.tMs && tMs <= b.tMs) {
      const u = b.tMs === a.tMs ? 0 : (tMs - a.tMs) / (b.tMs - a.tMs);
      return { cx: a.cx + (b.cx - a.cx) * u, cy: a.cy + (b.cy - a.cy) * u };
    }
  }
  return kfs[kfs.length - 1]!;
}
