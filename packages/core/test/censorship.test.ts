import { describe, expect, it } from "vitest";
import { CensorshipSettings } from "@editor/schemas";
import { buildMatcher, maskWord, normalizeWord } from "../src/censorship/index";
import { applyCensorship } from "../src/censor";
import { fixtureTimeline } from "./helpers";

const settings = CensorshipSettings.parse({});

describe("censorship lists", () => {
  const m = buildMatcher(settings);
  it.each(["mierda", "Mierda,", "MIERDAAA", "puuuuta", "p0lla", "cabrón", "chingadera", "Pendejos", "fucking", "motherfucker", "shit!", "B1tch"])(
    "flags %s",
    (w) => expect(m.isProfane(w)).toBe(true),
  );
  it.each(["hola", "pola", "computadora", "class", "assessment", "culture", "concha"])("does not flag %s", (w) =>
    expect(m.isProfane(w)).toBe(false),
  );
  it("respects allow and add lists", () => {
    const m2 = buildMatcher(CensorshipSettings.parse({ allowWords: { es: ["pendejo"] }, addWords: { es: ["caramba"] } }));
    expect(m2.isProfane("pendejo")).toBe(false);
    expect(m2.isProfane("caramba")).toBe(true);
  });
  it("only uses enabled languages", () => {
    const m3 = buildMatcher(CensorshipSettings.parse({ languages: ["es"] }));
    expect(m3.isProfane("fuck")).toBe(false);
    expect(m3.isProfane("mierda")).toBe(true);
  });
  it("normalizes", () => expect(normalizeWord("¡Cabrón!")).toBe("cabron"));
  it("masks", () => {
    expect(maskWord("mierda,", "first_letter")).toBe("m*****,");
    expect(maskWord("mierda", "asterisks")).toBe("******");
    expect(maskWord("mierda", "none")).toBe("mierda");
    expect(maskWord("shit", "grawlix")).toBe("#$%&");
  });
});

describe("applyCensorship", () => {
  it("bleeps and masks the fixture profanity with padding", () => {
    const t = fixtureTimeline();
    const e = t.audio.events.find((x) => x.wordId === "w7");
    expect(e).toMatchObject({ type: "bleep", reason: "censorship", sourceStartMs: 4000 - 40, sourceEndMs: 4400 + 40, bleepHz: 1000 });
    const w = t.captions.cues.flatMap((c) => c.words).find((x) => x.wordId === "w7")!;
    expect(w).toMatchObject({ censored: true, displayText: "m*****" });
  });
  it("is idempotent and honours overrides", () => {
    const t = fixtureTimeline();
    expect(applyCensorship(t)).toEqual(t);
    const allowed = structuredClone(t);
    allowed.captions.cues.flatMap((c) => c.words).find((x) => x.wordId === "w7")!.censorOverride = "allow";
    const r = applyCensorship(allowed);
    expect(r.audio.events).toHaveLength(0);
    expect(r.captions.cues.flatMap((c) => c.words).find((x) => x.wordId === "w7")).not.toHaveProperty("displayText");
  });
  it("mute mode and disabled", () => {
    const t = fixtureTimeline();
    expect(applyCensorship(t, CensorshipSettings.parse({ audio: "mute" })).audio.events[0]!.type).toBe("mute");
    expect(applyCensorship(t, CensorshipSettings.parse({ enabled: false })).audio.events).toHaveLength(0);
  });
});
