import { StyleChange } from "@editor/agent";
import { saveStyleUpdate } from "@editor/jobs";
import { StyleArea } from "@editor/schemas";
import { z } from "zod";
import { body, HttpError, route } from "@/lib/api";

const Update = z.object({
  changes: z.array(StyleChange).default([]),
  rule: z.object({ text: z.string().min(3).max(300), appliesTo: StyleArea }).optional(),
  deactivateRuleIds: z.array(z.string()).default([]),
  summary: z.string().min(3).max(300),
});

/** Manual edits of the style profile from the "Mi estilo" page. */
export const POST = route(async (req, { sb, user }) => {
  const b = await body(req, Update);
  try {
    return await saveStyleUpdate(sb, user.id, "user", { changes: b.changes, rules: b.rule ? [b.rule] : [], deactivateRuleIds: b.deactivateRuleIds, summary: b.summary, source: "explicit" });
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});
