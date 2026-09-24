import { describe, expect, it } from "vitest";
import { timelineToOtio, timelineToSrt } from "../src/otio";
import { fixtureTimeline } from "./helpers";

describe("OTIO / SRT export", () => {
  const t = fixtureTimeline([
    { startMs: 1000, endMs: 3000 },
    { startMs: 5000, endMs: 7000 },
  ]);

  it("emits one clip per segment on V1 and A1 with exact source ranges", () => {
    const otio = timelineToOtio(t, { mediaUrl: "file:///media/episode.mp4" }) as any;
    expect(otio.OTIO_SCHEMA).toBe("Timeline.1");
    const [v, a] = otio.tracks.children;
    expect(v.kind).toBe("Video");
    expect(a.kind).toBe("Audio");
    expect(v.children).toHaveLength(2);
    const r = v.children[0].source_range;
    expect(r.start_time).toEqual({ OTIO_SCHEMA: "RationalTime.1", rate: 30, value: Math.round((t.segments[0]!.sourceStartMs / 1000) * 30) });
    expect(v.children[0].media_reference.target_url).toBe("file:///media/episode.mp4");
    // the bleep for "mierda" (4.0–4.4 s) is outside both segments; no marker
    expect(v.children.flatMap((c: any) => c.markers)).toHaveLength(0);
  });

  it("marks censored words inside kept segments", () => {
    const t2 = fixtureTimeline([{ startMs: 3500, endMs: 6000 }]);
    const otio = timelineToOtio(t2, { mediaUrl: "file:///x.mp4" }) as any;
    const markers = otio.tracks.children[0].children[0].markers;
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ name: "BEEP", color: "RED" });
  });

  it("writes SRT in output time with masked words", () => {
    const srt = timelineToSrt(fixtureTimeline([{ startMs: 3500, endMs: 6000 }]));
    expect(srt.startsWith("1\n00:00:00,")).toBe(true);
    expect(srt).toContain("m*****");
    expect(srt).not.toContain("mierda");
  });
});
