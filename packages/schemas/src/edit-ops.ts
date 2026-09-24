import { z } from "zod";
import { Id, Ms } from "./common";
import { CaptionStyle } from "./style";
import { BlurRegion, MusicCue, Overlay, ReframeTrack, Segment } from "./timeline";

/**
 * Typed edit operations. The agent (and MCP clients) emit these instead of raw
 * JSON Patch: they address elements by id, which is robust to reordering.
 */
export const EditOp = z
  .discriminatedUnion("op", [
    z.object({ op: z.literal("trim_segment"), segmentId: Id, sourceStartMs: Ms.optional(), sourceEndMs: Ms.optional() }),
    z.object({ op: z.literal("split_segment"), segmentId: Id, atSourceMs: Ms }),
    z.object({ op: z.literal("delete_segment"), segmentId: Id }),
    z.object({ op: z.literal("insert_segment"), afterSegmentId: Id.nullable(), segment: Segment }),
    z.object({ op: z.literal("reorder_segments"), order: z.array(Id).min(1) }),
    z.object({ op: z.literal("set_transition"), segmentId: Id, transition: Segment.shape.transitionIn }),
    z.object({
      op: z.literal("edit_caption_word"),
      wordId: Id,
      text: z.string().optional(),
      displayText: z.string().nullable().optional(),
      emphasis: z.boolean().optional(),
    }),
    z.object({ op: z.literal("set_caption_style"), patch: CaptionStyle.partial(), cueIds: z.array(Id).optional() }),
    z.object({ op: z.literal("set_captions_enabled"), enabled: z.boolean() }),
    z.object({ op: z.literal("regroup_captions"), maxWordsPerLine: z.int().min(1).max(12).optional() }),
    z.object({ op: z.literal("censor_word"), wordId: Id, audio: z.enum(["bleep", "mute"]).optional() }),
    z.object({ op: z.literal("uncensor_word"), wordId: Id }),
    z.object({ op: z.literal("add_blur"), region: BlurRegion }),
    z.object({ op: z.literal("update_blur"), id: Id, patch: BlurRegion.partial().omit({ id: true }) }),
    z.object({ op: z.literal("remove_blur"), id: Id }),
    z.object({ op: z.literal("set_reframe"), track: ReframeTrack }),
    z.object({ op: z.literal("remove_reframe"), id: Id }),
    /** Whole-clip framing: follow the speaker, a fixed crop (cx = horizontal center), or the full frame over a blurred fill. */
    z.object({ op: z.literal("set_reframe_mode"), mode: z.enum(["track", "fixed", "fit_blur_bg"]), cx: z.number().min(0).max(1).optional() }),
    z.object({ op: z.literal("add_overlay"), overlay: Overlay }),
    z.object({ op: z.literal("remove_overlay"), id: Id }),
    z.object({ op: z.literal("set_music"), cue: MusicCue.nullable() }),
    z.object({ op: z.literal("set_meta"), title: z.string().optional(), hookText: z.string().optional() }),
  ])
  .meta({ id: "EditOp", title: "EditOp" });
export type EditOp = z.infer<typeof EditOp>;
export type EditOpInput = z.input<typeof EditOp>;
