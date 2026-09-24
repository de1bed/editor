import { z } from "zod";
import { Id, Lang, Ms } from "./common";

export const Word = z
  .object({
    id: Id,
    text: z.string(),
    startMs: Ms,
    endMs: Ms,
    speaker: z.string().nullable().default(null),
    confidence: z.number().min(0).max(1).default(1),
  })
  .meta({ id: "Word" });
export type Word = z.infer<typeof Word>;

export const Sentence = z
  .object({ id: Id, startMs: Ms, endMs: Ms, wordIds: z.array(Id), speaker: z.string().nullable().default(null) })
  .meta({ id: "Sentence" });
export type Sentence = z.infer<typeof Sentence>;

export const TranscriptProvider = z.enum(["whisperx", "deepgram", "assemblyai", "fixture"]);

export const Transcript = z
  .object({
    assetId: Id,
    language: Lang,
    provider: TranscriptProvider,
    providerVersion: z.string().default(""),
    durationMs: Ms,
    words: z.array(Word),
    speakers: z.array(z.object({ id: z.string(), label: z.string() })).default([]),
    sentences: z.array(Sentence).default([]),
  })
  .meta({ id: "Transcript", title: "Transcript" });
export type Transcript = z.infer<typeof Transcript>;
