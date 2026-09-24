import { describeStyle, interpretFeedback } from "@editor/agent";
import { chat, clips, feedback, styleProfiles, timelines } from "@editor/db";
import { maybeLearnStyle, recordFeedback, retrieveExamples, saveStyleUpdate } from "@editor/jobs";
import { llm, type ToolCallRecord, type ToolDef } from "@editor/llm";
import type { ToolContext } from "./context";
import { TOOLS } from "./tools";
import { describeTimeline } from "./views";

/** Tools the in-app assistant gets while editing one clip (the MCP server exposes all of them). */
const CLIP_TOOLS = ["get_timeline", "patch_timeline", "add_blur_region", "detect_objects", "get_detections", "set_censorship", "get_style_profile", "update_style_profile", "get_transcript", "export_otio", "render_final"];

export interface ChatTurnResult {
  reply: string;
  userMessageId: string;
  assistantMessageId: string;
  versionBefore: number;
  versionAfter: number;
  toolCalls: { name: string; ok: boolean; error?: string }[];
  learned: { summary: string; profileVersion: number } | null;
}

/**
 * One chat turn on a clip: the model edits the timeline only through tools
 * (typed EditOps → new versions → preview), then the turn is recorded as
 * EditFeedback and, when the user states a lasting preference, the style
 * profile gets a new version.
 */
export async function runClipChat(ctx: ToolContext, clipId: string, message: string): Promise<ChatTurnResult> {
  const clip = await clips.get(ctx.db, clipId);
  if (clip.userId !== ctx.userId) throw new Error("clip not found");
  const threadId = await chat.thread(ctx.db, { userId: ctx.userId, projectId: clip.projectId, clipId });
  const history = await chat.history(ctx.db, threadId, 20);
  const userMessageId = await chat.add(ctx.db, { userId: ctx.userId, threadId, role: "user", content: message, timelineVersion: clip.currentVersion });

  const { timeline } = await timelines.get(ctx.db, clipId);
  const { version: style } = await styleProfiles.getOrCreateDefault(ctx.db, ctx.userId);
  const examples = await retrieveExamples(ctx.db, ctx.userId, message);

  const commits: { before: number; after: number; ops: unknown[] }[] = [];
  const toolCtx: ToolContext = { ...ctx, messageId: userMessageId, onCommit: (c) => commits.push(c) };
  const tools: ToolDef[] = TOOLS.filter((t) => CLIP_TOOLS.includes(t.name) && ctx.scopes.includes(t.scope)).map((t) => ({
    name: t.name,
    description: t.description,
    input: t.input,
    run: (input: unknown) => t.run(toolCtx, input),
  }));

  const system = [
    "Eres el asistente de edición de un editor de video vertical (TikTok/Reels/Shorts). Hablas en el idioma del usuario, breve y concreto.",
    "Nunca editas píxeles: todo cambio se hace con herramientas sobre el timeline JSON (patch_timeline con EditOps tipadas, add_blur_region, set_censorship). Tras cada cambio se genera un preview automáticamente.",
    "Usa los ids exactos del timeline (segmentos, palabras, blurs). Los tiempos de palabras, blurs y reencuadre están en milisegundos del video original; overlays y música en tiempo de salida.",
    "Para difuminar algo descrito con palabras (\"el logo de la gorra\"), llama a detect_objects y luego add_blur_region con el id del track. Si no encuentras nada, dilo.",
    "Si el usuario expresa una preferencia general (\"siempre\", \"en todos mis videos\", \"de ahora en adelante\"), aplícala a este clip Y guárdala con update_style_profile. Si es solo para este clip, no toques el perfil.",
    "Si una herramienta devuelve error, corrige y reintenta. Al final resume en una o dos frases lo que cambiaste.",
    `Clip: id=${clipId}, título "${clip.title}", proyecto ${clip.projectId}.`,
    `Perfil de estilo del usuario:\n${describeStyle(style.settings, style.learnedRules)}`,
    examples.length ? `Decisiones pasadas similares de este usuario:\n${examples.map((e) => `- ${e}`).join("\n")}` : "",
    `Timeline actual:\n${describeTimeline(timeline)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await llm().runTools({
    system,
    messages: [...history.filter((m) => m.role !== "tool").map((m) => ({ role: m.role as "user" | "assistant", content: m.content })), { role: "user", content: message }],
    tools,
    maxTurns: 10,
  });

  const after = (await clips.get(ctx.db, clipId)).currentVersion;
  const toolCalls = result.toolCalls.map((c: ToolCallRecord) => ({ name: c.name, ok: !c.error, ...(c.error ? { error: c.error } : {}) }));
  const reply = result.text || (result.stopReason === "refusal" ? "No puedo ayudar con esa petición." : "Listo.");
  const assistantMessageId = await chat.add(ctx.db, { userId: ctx.userId, threadId, role: "assistant", content: reply, toolCalls: result.toolCalls, timelineVersion: after });

  // ---- learning: record the turn as feedback; lasting preferences update the profile now.
  let learned: ChatTurnResult["learned"] = null;
  try {
    const ops = commits.flatMap((c) => c.ops);
    const interpretation = await interpretFeedback(llm(), { userMessage: message, appliedOps: ops, styleSummary: describeStyle(style.settings, style.learnedRules) });
    const agentSavedProfile = result.toolCalls.some((c) => c.name === "update_style_profile" && !c.error);
    let profileVersionAfter: string | null = null;
    if (agentSavedProfile) {
      const saved = result.toolCalls.find((c) => c.name === "update_style_profile" && !c.error)!.output as { profileVersionId: string; profileVersion: number; summary: string };
      profileVersionAfter = saved.profileVersionId;
      learned = { summary: saved.summary, profileVersion: saved.profileVersion };
    } else if (interpretation.scope === "always" && interpretation.explicitPreference) {
      const p = interpretation.explicitPreference;
      if (p.changes.length || p.rule) {
        const saved = await saveStyleUpdate(ctx.db, ctx.userId, "agent", {
          changes: p.changes,
          rules: p.rule ? [{ text: p.rule, appliesTo: interpretation.area }] : [],
          summary: interpretation.summary,
          source: "explicit",
        }).catch(() => null);
        if (saved) {
          profileVersionAfter = saved.profileVersionId;
          learned = { summary: saved.summary, profileVersion: saved.profileVersion };
        }
      }
    }
    if (commits.length || interpretation.kind !== "instruction" || profileVersionAfter) {
      const id = await recordFeedback(ctx.db, {
        userId: ctx.userId,
        clip,
        threadId,
        messageId: userMessageId,
        kind: interpretation.kind,
        area: interpretation.area,
        userText: message,
        scope: interpretation.scope,
        timelineVersionBefore: clip.currentVersion,
        timelineVersionAfter: after,
        ops: ops as never,
        profileVersionBefore: style.id,
        summaryExtra: interpretation.summary,
      });
      if (profileVersionAfter) await feedback.setProfileVersionAfter(ctx.db, [id], profileVersionAfter);
      await maybeLearnStyle(ctx.db, ctx.userId, clip.projectId, ctx.enqueue);
    }
  } catch (e) {
    console.warn("[chat] feedback/learning skipped:", e);
  }

  return { reply, userMessageId, assistantMessageId, versionBefore: clip.currentVersion, versionAfter: after, toolCalls, learned };
}
