import { type Transcript, Transcript as TranscriptSchema, type Word } from "@editor/schemas";

export interface ApiTranscriber {
  name: "deepgram" | "assemblyai";
  /** `url` must be fetchable by the provider (signed storage URL). */
  transcribe(url: string, opts: { assetId: string; language: string | null; diarize: boolean; durationMs: number; sleep: (ms: number) => Promise<void> }): Promise<Transcript>;
}

export function apiTranscriber(name: "deepgram" | "assemblyai"): ApiTranscriber {
  return name === "deepgram" ? deepgram : assemblyai;
}

const SENTENCE_END = /[.!?…]["»”')]*$/;

/** Shared post-processing: ids, monotonic times, sentences, speakers. */
export function finalizeTranscript(
  raw: { text: string; startMs: number; endMs: number; speaker: string | null; confidence: number }[],
  meta: { assetId: string; language: string; provider: Transcript["provider"]; providerVersion: string; durationMs: number },
): Transcript {
  const words: Word[] = [];
  for (const w of raw) {
    const text = w.text.trim();
    if (!text) continue;
    const prev = words[words.length - 1];
    const start = Math.max(0, Math.round(w.startMs), prev ? prev.startMs : 0);
    words.push({
      id: `w${words.length}`,
      text,
      startMs: Math.min(start, meta.durationMs),
      endMs: Math.min(Math.max(start, Math.round(w.endMs)), meta.durationMs),
      speaker: w.speaker,
      confidence: Math.max(0, Math.min(1, w.confidence)),
    });
  }
  const sentences: Transcript["sentences"] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    sentences.push({ id: `s${sentences.length}`, startMs: cur[0]!.startMs, endMs: cur[cur.length - 1]!.endMs, wordIds: cur.map((w) => w.id), speaker: cur[0]!.speaker });
    cur = [];
  };
  for (const w of words) {
    const last = cur[cur.length - 1];
    if (last && (w.speaker !== last.speaker || w.startMs - last.endMs > 1500)) flush();
    cur.push(w);
    if (SENTENCE_END.test(w.text)) flush();
  }
  flush();
  const speakers = [...new Set(words.map((w) => w.speaker).filter((s): s is string => !!s))].sort();
  return TranscriptSchema.parse({
    assetId: meta.assetId,
    language: meta.language,
    provider: meta.provider,
    providerVersion: meta.providerVersion,
    durationMs: meta.durationMs,
    words,
    speakers: speakers.map((id, i) => ({ id, label: `Hablante ${i + 1}` })),
    sentences,
  });
}

const deepgram: ApiTranscriber = {
  name: "deepgram",
  async transcribe(url, opts) {
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) throw new Error("DEEPGRAM_API_KEY is not set");
    const q = new URLSearchParams({
      model: process.env.DEEPGRAM_MODEL ?? "nova-3",
      smart_format: "true",
      punctuate: "true",
      diarize: String(opts.diarize),
      profanity_filter: "false", // we censor ourselves, with exact word timings
    });
    if (opts.language) q.set("language", opts.language);
    else q.set("detect_language", "true");
    const res = await fetch(`https://api.deepgram.com/v1/listen?${q}`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) throw new Error(`deepgram: HTTP ${res.status} ${await res.text()}`);
    const j = (await res.json()) as {
      metadata?: { model_info?: Record<string, { version?: string }> };
      results: {
        channels: {
          detected_language?: string;
          alternatives: { words: { word: string; punctuated_word?: string; start: number; end: number; confidence: number; speaker?: number }[] }[];
        }[];
      };
    };
    const ch = j.results.channels[0]!;
    const words = ch.alternatives[0]?.words ?? [];
    return finalizeTranscript(
      words.map((w) => ({
        text: w.punctuated_word ?? w.word,
        startMs: w.start * 1000,
        endMs: w.end * 1000,
        speaker: w.speaker === undefined ? null : `S${w.speaker}`,
        confidence: w.confidence,
      })),
      { assetId: opts.assetId, language: opts.language ?? ch.detected_language ?? "en", provider: "deepgram", providerVersion: "v1", durationMs: opts.durationMs },
    );
  },
};

const assemblyai: ApiTranscriber = {
  name: "assemblyai",
  async transcribe(url, opts) {
    const key = process.env.ASSEMBLYAI_API_KEY;
    if (!key) throw new Error("ASSEMBLYAI_API_KEY is not set");
    const headers = { Authorization: key, "Content-Type": "application/json" };
    const create = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers,
      body: JSON.stringify({
        audio_url: url,
        speaker_labels: opts.diarize,
        filter_profanity: false,
        punctuate: true,
        format_text: true,
        ...(opts.language ? { language_code: opts.language } : { language_detection: true }),
      }),
    });
    if (!create.ok) throw new Error(`assemblyai: HTTP ${create.status} ${await create.text()}`);
    const { id } = (await create.json()) as { id: string };
    for (let delay = 2000; ; delay = Math.min(15_000, delay * 1.5)) {
      await opts.sleep(delay);
      const r = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, { headers });
      const j = (await r.json()) as {
        status: string;
        error?: string;
        language_code?: string;
        words?: { text: string; start: number; end: number; confidence: number; speaker?: string | null }[];
      };
      if (j.status === "error") throw new Error(`assemblyai: ${j.error}`);
      if (j.status !== "completed") continue;
      return finalizeTranscript(
        (j.words ?? []).map((w) => ({ text: w.text, startMs: w.start, endMs: w.end, speaker: w.speaker ?? null, confidence: w.confidence })),
        { assetId: opts.assetId, language: opts.language ?? j.language_code ?? "en", provider: "assemblyai", providerVersion: "v2", durationMs: opts.durationMs },
      );
    }
  },
};
