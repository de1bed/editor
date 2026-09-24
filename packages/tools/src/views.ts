import type { Timeline, Transcript } from "@editor/schemas";
import { formatTimecode, mapSegments, outputDurationMs } from "@editor/core";

/**
 * Compact, LLM-friendly view of a timeline: ids and times the model needs to
 * write EditOps, without the full JSON (which would waste context).
 */
export function describeTimeline(t: Timeline): string {
  const mapped = mapSegments(t.segments);
  const c = t.style.resolved.captions;
  const lines: string[] = [];
  lines.push(`Timeline v${t.version} · ${Math.round(outputDurationMs(t.segments) / 100) / 10}s · ${t.output.width}x${t.output.height}`);
  lines.push(`Segments (output order):`);
  for (const m of mapped) {
    const s = m.segment;
    lines.push(`  ${s.id}: source ${s.sourceStartMs}-${s.sourceEndMs}ms → output ${formatTimecode(m.outputStartMs)}-${formatTimecode(m.outputEndMs)}${s.transitionIn ? ` (${s.transitionIn.type})` : ""}`);
  }
  lines.push(
    `Caption style: ${c.fontFamily} ${c.fontWeight} ${c.fontSizePx}px text ${c.textColor} highlight ${c.highlightColor} stroke ${c.strokeColor}/${c.strokeWidthPx} ${c.position.anchor}@${c.position.offsetYPct}% ${c.maxWordsPerLine}w×${c.maxLines} ${c.uppercase ? "UPPER" : "normal"} anim=${c.animation} captions=${t.captions.enabled ? "on" : "off"}`,
  );
  lines.push(`Caption words (wordId:text@sourceMs, [C]=censored, [E]=emphasis), one cue per line:`);
  for (const cue of t.captions.cues) {
    lines.push("  " + cue.words.map((w) => `${w.wordId}:${w.displayText ?? w.text}@${w.sourceStartMs}${w.censored ? "[C]" : ""}${w.emphasis ? "[E]" : ""}`).join(" "));
  }
  const cs = t.style.resolved.censorship;
  lines.push(`Censorship: ${cs.enabled ? `on (${cs.audio}, mask ${cs.captionMask}, langs ${cs.languages.join("/")})` : "off"}; ${t.audio.events.length} audio events`);
  lines.push(`Reframe: ${t.reframe.length ? t.reframe.map((r) => `${r.id} ${r.mode} ${r.sourceStartMs}-${r.sourceEndMs}${r.speakerId ? ` speaker ${r.speakerId}` : ""}`).join("; ") : `none (default ${t.style.resolved.reframe.defaultMode}, centered)`}`);
  lines.push(`Blurs: ${t.blurs.length ? t.blurs.map((b) => `${b.id} "${b.label}" ${b.kind} ${b.sourceStartMs}-${b.sourceEndMs} ${b.effect.type}`).join("; ") : "none"}`);
  lines.push(`Overlays: ${t.overlays.length ? t.overlays.map((o) => `${o.id} ${o.type} ${o.outputStartMs}-${o.outputEndMs}${o.type === "text" ? ` "${o.text}"` : ` ×${o.scale}`}`).join("; ") : "none"}`);
  lines.push(`Music: ${t.audio.music.length ? t.audio.music.map((m) => m.assetId).join(", ") : "none"}. Source duration ${t.source.durationMs}ms.`);
  return lines.join("\n");
}

/** Transcript lines with sentence ids and times, optionally limited to a range. */
export function describeTranscript(t: Transcript, startMs = 0, endMs = Number.MAX_SAFE_INTEGER, maxChars = 30_000): string {
  const text = new Map(t.words.map((w) => [w.id, w.text]));
  const label = new Map(t.speakers.map((s) => [s.id, s.label]));
  const out: string[] = [];
  let size = 0;
  for (const s of t.sentences) {
    if (s.endMs <= startMs || s.startMs >= endMs) continue;
    const line = `[${s.id} ${s.startMs}-${s.endMs}ms] ${s.speaker ? `${label.get(s.speaker) ?? s.speaker}: ` : ""}${s.wordIds.map((id) => text.get(id)).join(" ")}`;
    size += line.length;
    if (size > maxChars) {
      out.push("… (truncated; request a narrower range)");
      break;
    }
    out.push(line);
  }
  return out.join("\n");
}
