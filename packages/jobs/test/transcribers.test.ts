import { describe, expect, it } from "vitest";
import { finalizeTranscript } from "../src/transcribers";
import { speakerTurns } from "../src/handlers/build-timeline";

describe("finalizeTranscript", () => {
  it("assigns ids, keeps times monotonic, builds sentences and speakers", () => {
    const t = finalizeTranscript(
      [
        { text: "Hola", startMs: 100, endMs: 300, speaker: "S0", confidence: 0.9 },
        { text: "mundo.", startMs: 320, endMs: 600, speaker: "S0", confidence: 0.9 },
        { text: " ", startMs: 600, endMs: 610, speaker: "S0", confidence: 0.9 },
        { text: "¿Qué", startMs: 590, endMs: 800, speaker: "S1", confidence: 1.2 },
        { text: "tal?", startMs: 810, endMs: 1000, speaker: "S1", confidence: 0.8 },
      ],
      { assetId: "a", language: "es", provider: "deepgram", providerVersion: "v1", durationMs: 950 },
    );
    expect(t.words.map((w) => w.id)).toEqual(["w0", "w1", "w2", "w3"]);
    expect(t.words[2]!.startMs).toBe(590);
    expect(t.words[3]!.endMs).toBe(950); // clamped to duration
    expect(t.words[2]!.confidence).toBe(1);
    expect(t.sentences.map((s) => s.wordIds.length)).toEqual([2, 2]);
    expect(t.speakers).toEqual([{ id: "S0", label: "Hablante 1" }, { id: "S1", label: "Hablante 2" }]);
  });
});

describe("speakerTurns", () => {
  it("merges consecutive words of the same speaker within the range", () => {
    const w = (speaker: string, s: number, e: number) => ({ speaker, startMs: s, endMs: e });
    expect(speakerTurns([w("A", 0, 500), w("A", 600, 900), w("B", 1000, 1500), w("A", 5000, 5200)], 100, 4000)).toEqual([
      { speaker: "A", startMs: 0, endMs: 900 },
      { speaker: "B", startMs: 1000, endMs: 1500 },
    ]);
  });
});
