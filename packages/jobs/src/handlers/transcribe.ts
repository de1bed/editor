import { Transcript } from "@editor/schemas";
import { assets, downloadJson, paths, projects, signedUrl, transcripts } from "@editor/db";
import { PermanentJobError, type JobHandler } from "../context";
import { config } from "../env";
import { apiTranscriber } from "../transcribers";
import { mediaRef, ref, str } from "./common";

/** Audio → word-level transcript with speakers. WhisperX on Modal, or Deepgram/AssemblyAI. */
export const transcribe: JobHandler = async (ctx, input) => {
  const assetId = str(input, "assetId");
  const source = await assets.get(ctx.db, assetId);
  const project = await projects.get(ctx.db, source.projectId);
  const language = (input.language as string | undefined) ?? project.settings.language ?? null;
  const diarize = project.settings.diarize ?? true;
  if (!source.durationMs) throw new PermanentJobError("source has not been ingested yet");

  let transcript: Transcript;
  const provider = config.transcriber;
  await ctx.progress(0.02, `transcribe:${provider}`);
  if (provider === "whisperx") {
    const audio = await assets.derived(ctx.db, assetId, "audio");
    if (!audio) throw new PermanentJobError("audio track missing: run ingest first");
    const out = mediaRef(paths.transcript(source.userId, source.projectId, assetId, "whisperx"));
    const res = await ctx.media.transcribe({ jobId: ctx.job.id, assetId, audio: ref(audio), out, language, diarize, minSpeakers: null, maxSpeakers: null });
    transcript = Transcript.parse(await downloadJson(ctx.db, res.out));
  } else {
    // Providers fetch the media themselves; the proxy (small, has audio) is enough.
    const proxy = await assets.derived(ctx.db, assetId, "proxy");
    const url = await signedUrl(ctx.db, ref(proxy ?? source), 6 * 3600);
    transcript = await apiTranscriber(provider).transcribe(url, { assetId, language, diarize, durationMs: source.durationMs, sleep: ctx.runtime.sleep });
  }
  transcript = { ...transcript, assetId };
  await transcripts.upsert(ctx.db, { userId: source.userId, assetId, transcript });
  await projects.update(ctx.db, source.projectId, { status: "ready" });

  const out: Record<string, unknown> = { words: transcript.words.length, language: transcript.language, speakers: transcript.speakers.length };
  const clipCount = project.settings.clipCount ?? 0;
  if (clipCount > 0) {
    const next = await ctx.enqueue("select_moments", { projectId: source.projectId, assetId, count: clipCount });
    out.selectJobId = next.id;
  }
  return out;
};
