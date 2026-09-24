import { type Clip, type Db, feedback, type FeedbackInsert, timelines } from "@editor/db";
import { embeddings } from "@editor/llm";

/**
 * Past decisions similar to `query` (pgvector), phrased for a prompt.
 * Returns [] when embeddings are not configured.
 */
export async function retrieveExamples(db: Db, userId: string, query: string, area?: string, count = 6): Promise<string[]> {
  const e = embeddings();
  if (!e) return [];
  try {
    const [vec] = await e.embed([query]);
    const { data, error } = await db.rpc("match_feedback", { p_user_id: userId, p_embedding: vec, p_count: count, p_area: area ?? null });
    if (error || !data) return [];
    return (data as { kind: string; scope: string; user_text: string | null; context: { summary?: string }; similarity: number }[])
      .filter((r) => r.similarity > 0.3)
      .map((r) => `${KIND[r.kind] ?? r.kind}${r.user_text ? ` — "${r.user_text}"` : ""}: ${r.context.summary ?? ""}`.slice(0, 400));
  } catch {
    return []; // retrieval is an enhancement, never a blocker
  }
}

const KIND: Record<string, string> = { approve: "Aprobó", reject: "Rechazó", correction: "Corrigió", instruction: "Pidió" };


export interface RecordFeedbackInput extends Omit<FeedbackInsert, "projectId" | "clipId" | "context" | "embedding" | "embeddingModel"> {
  clip: Clip;
  summaryExtra?: string;
}

/**
 * Stores an EditFeedback row with an embedding of its context, so future
 * proposals can retrieve similar past decisions. Never throws on embedding
 * failures (the row is still stored).
 */
export async function recordFeedback(db: Db, f: RecordFeedbackInput): Promise<string> {
  const { clip } = f;
  let excerpt = "";
  try {
    const tl = (await timelines.get(db, clip.id)).timeline;
    excerpt = tl.captions.cues.flatMap((c) => c.words.map((w) => w.text)).slice(0, 80).join(" ");
  } catch {
    // no timeline yet
  }
  const lenSec = Math.round((clip.sourceEndMs - clip.sourceStartMs) / 1000);
  const summary = [
    `Clip "${clip.title}" de ${lenSec} s`,
    clip.scores?.total !== undefined ? `(puntuación ${clip.scores.total})` : "",
    clip.justification ? `— ${clip.justification}` : "",
    f.userText ? `Usuario: "${f.userText}"` : "",
    f.summaryExtra ?? "",
    excerpt ? `Texto: ${excerpt}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  let embedding: number[] | null = null;
  let model: string | null = null;
  const e = embeddings();
  if (e) {
    try {
      [embedding = null] = await e.embed([summary]);
      model = e.model;
    } catch {
      embedding = null;
    }
  }
  return feedback.insert(db, {
    ...f,
    projectId: clip.projectId,
    clipId: clip.id,
    context: { summary, transcriptExcerpt: excerpt, clipFeatures: { durationSec: lenSec, ...(clip.scores ?? {}) } },
    embedding,
    embeddingModel: model,
  });
}
