import type { Segment } from "@editor/schemas";

export interface MappedSegment {
  segment: Segment;
  index: number;
  outputStartMs: number;
  outputEndMs: number;
}

/** Output placement of each segment (segments play back-to-back, hard cuts). */
export function mapSegments(segments: readonly Segment[]): MappedSegment[] {
  let cursor = 0;
  return segments.map((segment, index) => {
    const len = segment.sourceEndMs - segment.sourceStartMs;
    const m = { segment, index, outputStartMs: cursor, outputEndMs: cursor + len };
    cursor += len;
    return m;
  });
}

export function outputDurationMs(segments: readonly Segment[]): number {
  return segments.reduce((acc, s) => acc + (s.sourceEndMs - s.sourceStartMs), 0);
}

export interface OutputInterval {
  segmentIndex: number;
  sourceStartMs: number;
  sourceEndMs: number;
  outputStartMs: number;
  outputEndMs: number;
}

/**
 * Projects a source-time range onto the output. A range can land in several
 * places (it may be split by a cut, or a segment may be reused).
 */
export function mapSourceRange(segments: readonly Segment[] | MappedSegment[], startMs: number, endMs: number): OutputInterval[] {
  const mapped = isMapped(segments) ? segments : mapSegments(segments);
  const out: OutputInterval[] = [];
  for (const m of mapped) {
    const s = Math.max(startMs, m.segment.sourceStartMs);
    const e = Math.min(endMs, m.segment.sourceEndMs);
    if (e > s) {
      const offset = m.outputStartMs - m.segment.sourceStartMs;
      out.push({ segmentIndex: m.index, sourceStartMs: s, sourceEndMs: e, outputStartMs: s + offset, outputEndMs: e + offset });
    }
  }
  return out;
}

/** First output position of a source instant, or null if it was cut out. */
export function sourceToOutput(segments: readonly Segment[] | MappedSegment[], sourceMs: number): number | null {
  const mapped = isMapped(segments) ? segments : mapSegments(segments);
  for (const m of mapped) {
    if (sourceMs >= m.segment.sourceStartMs && sourceMs < m.segment.sourceEndMs) {
      return m.outputStartMs + (sourceMs - m.segment.sourceStartMs);
    }
  }
  return null;
}

/** Source instant shown at a given output time, or null past the end. */
export function outputToSource(segments: readonly Segment[] | MappedSegment[], outputMs: number): { sourceMs: number; segmentIndex: number } | null {
  const mapped = isMapped(segments) ? segments : mapSegments(segments);
  for (const m of mapped) {
    if (outputMs >= m.outputStartMs && outputMs < m.outputEndMs) {
      return { sourceMs: m.segment.sourceStartMs + (outputMs - m.outputStartMs), segmentIndex: m.index };
    }
  }
  return null;
}

function isMapped(x: readonly Segment[] | MappedSegment[]): x is MappedSegment[] {
  return x.length > 0 && "outputStartMs" in (x[0] as object);
}

export function formatTimecode(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const a = Math.abs(ms);
  const h = Math.floor(a / 3_600_000);
  const m = Math.floor((a % 3_600_000) / 60_000);
  const s = Math.floor((a % 60_000) / 1000);
  const r = Math.floor(a % 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${sign}${h > 0 ? `${h}:` : ""}${pad(m)}:${pad(s)}.${pad(r, 3)}`;
}
