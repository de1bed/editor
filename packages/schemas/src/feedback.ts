import { z } from "zod";
import { Id, JsonPatchOp } from "./common";
import { EditOp } from "./edit-ops";
import { StyleArea } from "./style";

export const FeedbackKind = z.enum(["approve", "reject", "correction", "instruction"]);
export type FeedbackKind = z.infer<typeof FeedbackKind>;

export const FeedbackScope = z.enum(["this_clip", "project", "always"]);
export type FeedbackScope = z.infer<typeof FeedbackScope>;

export const EditFeedback = z
  .object({
    id: Id,
    userId: Id,
    projectId: Id,
    clipId: Id.nullable(),
    threadId: Id.nullable().default(null),
    messageId: Id.nullable().default(null),
    kind: FeedbackKind,
    area: StyleArea,
    userText: z.string().nullable().default(null),
    scope: FeedbackScope,
    timelineVersionBefore: z.int().nonnegative().nullable(),
    timelineVersionAfter: z.int().nonnegative().nullable(),
    ops: z.array(EditOp).default([]),
    jsonPatch: z.array(JsonPatchOp).default([]),
    profileVersionBefore: Id.nullable(),
    profileVersionAfter: Id.nullable().default(null),
    context: z.object({
      /** Text that gets embedded for retrieval. */
      summary: z.string(),
      transcriptExcerpt: z.string().default(""),
      clipFeatures: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
    }),
    embeddingModel: z.string().nullable().default(null),
    createdAt: z.string(),
  })
  .meta({ id: "EditFeedback", title: "EditFeedback" });
export type EditFeedback = z.infer<typeof EditFeedback>;
