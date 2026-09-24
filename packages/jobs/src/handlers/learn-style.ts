import { durationFromApprovals, learnFromFeedback, type StyleChange } from "@editor/agent";
import { feedback, styleProfiles, unappliedFeedback } from "@editor/db";
import { llm } from "@editor/llm";
import type { JobHandler } from "../context";
import { saveStyleUpdate } from "../style";
import { str } from "./common";

/**
 * Implicit learning: turns accumulated approvals/rejections/corrections into
 * a new style-profile version when there is consistent evidence.
 */
export const learnStyleJob: JobHandler = async (ctx, input) => {
  const userId = str(input, "userId");
  const items = await unappliedFeedback(ctx.db, userId, 40);
  if (items.length < 3) return { learned: false, reason: "not enough feedback yet", items: items.length };
  const { version } = await styleProfiles.getOrCreateDefault(ctx.db, userId);

  await ctx.progress(0.2, "llm");
  const learned = await learnFromFeedback(llm(), { settings: version.settings, rules: version.learnedRules, items });
  const approvedDurations = items
    .filter((i) => i.kind === "approve" && i.area === "clip_selection" && typeof i.clipFeatures.durationSec === "number")
    .map((i) => i.clipFeatures.durationSec as number);
  const numeric = durationFromApprovals(version.settings, approvedDurations);

  // LLM changes first; deterministic numeric learning wins on the same path.
  const byPath = new Map<string, StyleChange>();
  for (const c of learned.changes) byPath.set(c.path, { path: c.path, value: c.value });
  for (const c of numeric) byPath.set(c.path, c);
  const changes = [...byPath.values()];
  if (!changes.length && !learned.rules.length && !learned.deactivateRuleIds.length) return { learned: false, reason: "no consistent pattern", items: items.length };

  const evidence = [...new Set([...learned.changes.flatMap((c) => c.evidence), ...learned.rules.flatMap((r) => r.evidence)])];
  const saved = await saveStyleUpdate(ctx.db, userId, "system", {
    changes,
    rules: learned.rules.map((r) => ({ text: r.text, appliesTo: r.appliesTo, confidence: Math.min(0.95, Math.max(0.3, r.confidence)), evidence: r.evidence })),
    deactivateRuleIds: learned.deactivateRuleIds,
    summary: learned.summary || (numeric.length ? "Duración ideal ajustada a los clips que apruebas" : "Preferencias aprendidas"),
    source: "inferred",
    evidence,
    confidence: 0.7,
  });
  await feedback.setProfileVersionAfter(ctx.db, items.map((i) => i.id), saved.profileVersionId);
  return { learned: true, ...saved, changes, rules: learned.rules.length };
};
