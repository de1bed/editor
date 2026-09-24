import type { AudioEvent, CaptionCue, CensorshipSettings, Timeline } from "@editor/schemas";
import { buildMatcher, maskWord } from "./censorship/index";

/**
 * Marks profane words in the captions (masked displayText) and creates one
 * bleep/mute event per word, with padding, clamped to the source.
 * Idempotent: censorship events are recomputed; user events are kept; a
 * word's `censorOverride` wins over the lists.
 */
export function applyCensorship(timeline: Timeline, settings: CensorshipSettings = timeline.style.resolved.censorship): Timeline {
  const matcher = buildMatcher(settings);
  const keep = timeline.audio.events.filter((e) => e.reason !== "censorship");
  const events: AudioEvent[] = [];

  const cues: CaptionCue[] = timeline.captions.cues.map((cue) => ({
    ...cue,
    words: cue.words.map((w) => {
      const censor =
        w.censorOverride === "censor" || (w.censorOverride !== "allow" && settings.enabled && matcher.isProfane(w.text));
      if (!censor) {
        if (!w.censored) return w;
        const { displayText: _masked, ...rest } = w;
        return { ...rest, censored: false };
      }
      events.push({
        id: `cens_${w.wordId}`,
        type: settings.audio,
        sourceStartMs: Math.max(0, w.sourceStartMs - settings.paddingMs),
        sourceEndMs: Math.min(timeline.source.durationMs, Math.max(w.sourceEndMs, w.sourceStartMs + 1) + settings.paddingMs),
        reason: "censorship",
        wordId: w.wordId,
        ...(settings.audio === "bleep" ? { bleepHz: settings.bleepHz } : {}),
      });
      return { ...w, censored: true, displayText: maskWord(w.text, settings.captionMask) };
    }),
  }));

  // Two cues can contain the same word only if the timeline is malformed; dedupe defensively.
  const seen = new Set<string>();
  const unique = events.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  return { ...timeline, captions: { ...timeline.captions, cues }, audio: { ...timeline.audio, events: [...keep, ...unique] } };
}
