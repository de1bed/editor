import { describe, expect, it } from "vitest";
import { assColor, assTime, timelineToAss } from "../src/ass";
import { groupWordsIntoCues } from "../src/captions";
import { FIXTURE_TRANSCRIPT, fixtureTimeline } from "./helpers";

describe("groupWordsIntoCues", () => {
  it("respects max words and sentence ends", () => {
    const cues = groupWordsIntoCues(FIXTURE_TRANSCRIPT.words, { maxWordsPerLine: 3, maxLines: 1 });
    for (const c of cues) expect(c.words.length).toBeLessThanOrEqual(3);
    // "trabajo." ends a sentence: the next cue starts with "fue"
    const i = cues.findIndex((c) => c.words.some((w) => w.text === "trabajo."));
    expect(cues[i]!.words.at(-1)!.text).toBe("trabajo.");
    expect(cues[i + 1]!.words[0]!.text).toBe("fue");
  });
  it("breaks on long pauses", () => {
    const words = [
      { id: "a", text: "uno", startMs: 0, endMs: 200, speaker: null, confidence: 1 },
      { id: "b", text: "dos", startMs: 2000, endMs: 2200, speaker: null, confidence: 1 },
    ];
    expect(groupWordsIntoCues(words, { maxWordsPerLine: 5, maxLines: 1 })).toHaveLength(2);
  });
  it("is deterministic", () => {
    expect(groupWordsIntoCues(FIXTURE_TRANSCRIPT.words, { maxWordsPerLine: 2, maxLines: 2 })).toEqual(
      groupWordsIntoCues(FIXTURE_TRANSCRIPT.words, { maxWordsPerLine: 2, maxLines: 2 }),
    );
  });
});

describe("ASS generation", () => {
  it("formats times and colors", () => {
    expect(assTime(0)).toBe("0:00:00.00");
    expect(assTime(3_723_456)).toBe("1:02:03.46");
    expect(assColor("#FFD400")).toBe("&H0000D4FF&");
    expect(assColor("#000000", 0.5)).toBe("&H80000000&");
  });

  it("emits a style and one event per spoken word (karaoke)", () => {
    const t = fixtureTimeline();
    const ass = timelineToAss(t);
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toMatch(/Style: Caption,Montserrat ExtraBold,84,/);
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues).toHaveLength(FIXTURE_TRANSCRIPT.words.length);
    // Masked profanity is drawn, the original is not.
    expect(ass).toContain("M*****");
    expect(ass).not.toMatch(/MIERDA/);
  });

  it("shifts captions to output time after a cut", () => {
    // Keep 3.0–5.0 s: the first kept word ("cuento", 3.0 s) must start at 0.
    const t = fixtureTimeline([{ startMs: 3000, endMs: 5000 }]);
    const first = timelineToAss(t).split("\n").find((l) => l.startsWith("Dialogue:"))!;
    expect(first.startsWith("Dialogue: 0,0:00:00.")).toBe(true);
  });

  it("matches snapshot", () => {
    expect(timelineToAss(fixtureTimeline([{ startMs: 0, endMs: 3000 }]))).toMatchSnapshot();
  });
});
