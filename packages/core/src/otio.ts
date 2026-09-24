import type { Timeline } from "@editor/schemas";
import { mapSegments, mapSourceRange } from "./time";

type RT = { OTIO_SCHEMA: "RationalTime.1"; rate: number; value: number };
type TR = { OTIO_SCHEMA: "TimeRange.1"; start_time: RT; duration: RT };

const rt = (ms: number, rate: number): RT => ({ OTIO_SCHEMA: "RationalTime.1", rate, value: Math.round((ms / 1000) * rate) });
const tr = (startMs: number, durMs: number, rate: number): TR => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(startMs, rate), duration: rt(durMs, rate) });

export interface OtioOptions {
  /** URL or path the NLE will relink to (e.g. file:///Volumes/media/episode12.mp4). */
  mediaUrl: string;
  name?: string;
}

/**
 * Timeline → OpenTimelineIO JSON (.otio) for DaVinci Resolve / Premiere
 * (via the OTIO plugin). Cuts are exact, on the original media; bleeps, blurs
 * and speaker shots become markers; captions travel as SRT/ASS alongside.
 * The 9:16 reframing and blur pixels cannot be represented in OTIO and are
 * described in the metadata.
 */
export function timelineToOtio(t: Timeline, o: OtioOptions): Record<string, unknown> {
  const rate = Math.round((t.source.fps.num / t.source.fps.den) * 1000) / 1000;
  const mapped = mapSegments(t.segments);
  const markersFor = (segStart: number, segEnd: number) => {
    const markers: Record<string, unknown>[] = [];
    const add = (name: string, s: number, e: number, color: string, comment: string) => {
      const a = Math.max(s, segStart);
      const b = Math.min(e, segEnd);
      if (b > a) markers.push({ OTIO_SCHEMA: "Marker.2", name, color, comment, metadata: {}, marked_range: tr(a, b - a, rate) });
    };
    for (const ev of t.audio.events) add(ev.type === "bleep" ? "BEEP" : ev.type.toUpperCase(), ev.sourceStartMs, ev.sourceEndMs, "RED", ev.wordId ? `censura ${ev.wordId}` : ev.reason);
    for (const b of t.blurs) add(`BLUR ${b.label || b.kind}`, b.sourceStartMs, b.sourceEndMs, "PURPLE", `${b.effect.type} ${b.kind}`);
    for (const r of t.reframe) if (r.speakerId) add(`CAM ${r.speakerId}`, r.sourceStartMs, r.sourceEndMs, "CYAN", `reframe ${r.mode}`);
    return markers;
  };
  const clip = (i: number, kind: "V" | "A") => {
    const s = mapped[i]!.segment;
    return {
      OTIO_SCHEMA: "Clip.1",
      name: `${t.meta.title || "clip"} ${kind}${i + 1}`,
      source_range: tr(s.sourceStartMs, s.sourceEndMs - s.sourceStartMs, rate),
      media_reference: {
        OTIO_SCHEMA: "ExternalReference.1",
        target_url: o.mediaUrl,
        available_range: tr(0, t.source.durationMs, rate),
        metadata: {},
      },
      effects: [],
      markers: kind === "V" ? markersFor(s.sourceStartMs, s.sourceEndMs) : [],
      enabled: true,
      metadata: { editor: { segmentId: s.id } },
    };
  };
  const track = (kind: "Video" | "Audio") => ({
    OTIO_SCHEMA: "Track.1",
    name: kind === "Video" ? "V1" : "A1",
    kind,
    source_range: null,
    effects: [],
    markers: [],
    enabled: true,
    metadata: {},
    children: mapped.map((_, i) => clip(i, kind === "Video" ? "V" : "A")),
  });
  return {
    OTIO_SCHEMA: "Timeline.1",
    name: o.name ?? (t.meta.title || "clip"),
    global_start_time: rt(0, rate),
    tracks: { OTIO_SCHEMA: "Stack.1", name: "tracks", source_range: null, effects: [], markers: [], enabled: true, metadata: {}, children: [track("Video"), track("Audio")] },
    metadata: {
      editor: {
        timelineId: t.id,
        version: t.version,
        output: t.output,
        note: "Vertical 9:16 reframing, blur and burned captions are not representable in OTIO: see the markers and the .srt/.ass sidecars.",
        reframe: t.reframe,
        blurs: t.blurs.map((b) => ({ id: b.id, label: b.label, kind: b.kind, sourceStartMs: b.sourceStartMs, sourceEndMs: b.sourceEndMs, keyframes: b.keyframes })),
      },
    },
  };
}

/** Captions in output time as SubRip (masked text for censored words). */
export function timelineToSrt(t: Timeline): string {
  const mapped = mapSegments(t.segments);
  const entries: { start: number; end: number; text: string }[] = [];
  for (const cue of t.captions.cues) {
    const iv = mapSourceRange(mapped, cue.sourceStartMs, cue.sourceEndMs);
    for (const i of iv) {
      const words = cue.words.filter((w) => w.sourceStartMs >= i.sourceStartMs && w.sourceStartMs < i.sourceEndMs);
      if (words.length) entries.push({ start: i.outputStartMs, end: i.outputEndMs, text: words.map((w) => w.displayText ?? w.text).join(" ") });
    }
  }
  entries.sort((a, b) => a.start - b.start);
  const ts = (ms: number) => {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  return entries.map((e, i) => `${i + 1}\n${ts(e.start)} --> ${ts(e.end)}\n${e.text}\n`).join("\n");
}
