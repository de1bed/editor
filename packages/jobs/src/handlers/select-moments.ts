import { selectMoments } from "@editor/agent";
import { assets, clips, transcripts } from "@editor/db";
import { llm } from "@editor/llm";
import { PermanentJobError, type JobHandler } from "../context";
import { retrieveExamples } from "../feedback";
import { int, projectStyle, str } from "./common";

/** Transcript → N ranked clip proposals (LLM) → a timeline + preview for each. */
export const selectMomentsJob: JobHandler = async (ctx, input) => {
  const projectId = str(input, "projectId");
  const assetId = str(input, "assetId");
  const count = int(input, "count", 5);
  const source = await assets.get(ctx.db, assetId);
  const transcript = await transcripts.forAsset(ctx.db, assetId);
  if (!transcript) throw new PermanentJobError("no transcript yet");
  if (transcript.words.length < 20) return { clips: [], reason: "transcript too short" };
  const style = await projectStyle(ctx.db, projectId);

  await ctx.progress(0.05, "llm");
  const summary = transcript.words.slice(0, 400).map((w) => w.text).join(" ");
  const examples = await retrieveExamples(ctx.db, source.userId, `Selección de clips para: ${summary}`, "clip_selection");
  const { moments, usage } = await selectMoments({
    transcript,
    style: style.settings,
    learnedRules: style.learnedRules,
    examples,
    count,
    llm: llm(),
    onProgress: (f) => void ctx.progress(0.05 + 0.8 * f),
  });

  // Idempotent on retry: a proposal with the same range is reused.
  const existing = await clips.list(ctx.db, projectId);
  const created: string[] = [];
  for (const [rank, m] of moments.entries()) {
    let clip = existing.find((c) => c.sourceAssetId === assetId && c.sourceStartMs === m.startMs && c.sourceEndMs === m.endMs);
    clip ??= await clips.create(ctx.db, {
      userId: source.userId,
      projectId,
      sourceAssetId: assetId,
      sourceStartMs: m.startMs,
      sourceEndMs: m.endMs,
      title: m.title,
      justification: m.justification,
      scores: m.scores,
      rank: rank + 1,
      createdBy: "llm",
    });
    created.push(clip.id);
    await ctx.enqueue("build_timeline", { clipId: clip.id });
  }
  return { clips: created, usage };
};
