import { applyStyleChanges, type StyleChange } from "@editor/agent";
import { type Db, styleProfiles } from "@editor/db";
import type { StyleArea } from "@editor/schemas";

export interface StyleUpdate {
  changes: StyleChange[];
  rules?: { text: string; appliesTo: StyleArea; confidence?: number; evidence?: string[] }[];
  deactivateRuleIds?: string[];
  summary: string;
  source: "explicit" | "inferred";
  evidence?: string[];
  confidence?: number;
}

/** Creates a new style-profile version (validated). Throws on invalid changes or an empty update. */
export async function saveStyleUpdate(db: Db, userId: string, createdBy: "user" | "agent" | "system", u: StyleUpdate) {
  const { profileId, version } = await styleProfiles.getOrCreateDefault(db, userId);
  const settings = applyStyleChanges(version.settings, u.changes);
  const confidence = u.confidence ?? (u.source === "explicit" ? 1 : 0.7);
  const provenance = { ...version.provenance };
  for (const c of u.changes) provenance[c.path] = { source: u.source, confidence, evidence: u.evidence ?? [] };
  const rules = version.learnedRules.map((r) => (u.deactivateRuleIds?.includes(r.id) ? { ...r, active: false } : { ...r }));
  for (const nr of u.rules ?? []) {
    const existing = rules.find((r) => r.text.toLowerCase() === nr.text.toLowerCase());
    const conf = nr.confidence ?? confidence;
    if (existing) Object.assign(existing, { active: true, confidence: Math.max(existing.confidence, conf), evidence: [...new Set([...existing.evidence, ...(nr.evidence ?? [])])] });
    else rules.push({ id: `rule_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, text: nr.text, appliesTo: nr.appliesTo, confidence: conf, evidence: nr.evidence ?? u.evidence ?? [], active: true });
  }
  if (!u.changes.length && !u.rules?.length && !u.deactivateRuleIds?.length) throw new Error("nothing to update");
  const created = await styleProfiles.createVersion(db, {
    profileId,
    userId,
    parentVersionId: version.id,
    settings,
    learnedRules: rules,
    provenance,
    changeSummary: u.summary,
    createdBy,
  });
  return { profileVersion: created.version, profileVersionId: created.id, previousVersionId: version.id, summary: u.summary };
}
