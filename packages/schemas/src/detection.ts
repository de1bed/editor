import { z } from "zod";
import { Id, Ms, Unit } from "./common";
import { BlurKind } from "./timeline";

/** Output of the detection/tracking workers (Python). */
export const DetectionTrack = z
  .object({
    id: Id,
    assetId: Id,
    query: z.string(),
    kind: BlurKind.or(z.literal("person")),
    model: z.string(),
    startMs: Ms,
    endMs: Ms,
    score: z.number().min(0).max(1),
    keyframes: z.array(z.object({ tMs: Ms, x: Unit, y: Unit, w: Unit, h: Unit, score: z.number().min(0).max(1).optional() })).min(1),
    mask: z.object({ assetId: Id, format: z.literal("coco_rle_jsonl"), fps: z.number().positive() }).optional(),
  })
  .meta({ id: "DetectionTrack", title: "DetectionTrack" });
export type DetectionTrack = z.infer<typeof DetectionTrack>;

/** Face track with an optional speaker assignment, used for 9:16 reframing. */
export const FaceTrack = z
  .object({
    id: Id,
    speakerId: z.string().nullable(),
    startMs: Ms,
    endMs: Ms,
    keyframes: z.array(z.object({ tMs: Ms, x: Unit, y: Unit, w: Unit, h: Unit, mouthActivity: z.number().min(0).optional() })).min(1),
  })
  .meta({ id: "FaceTrack" });
export type FaceTrack = z.infer<typeof FaceTrack>;

export const FaceAnalysis = z
  .object({ assetId: Id, sampleFps: z.number().positive(), width: z.int().positive(), height: z.int().positive(), tracks: z.array(FaceTrack) })
  .meta({ id: "FaceAnalysis", title: "FaceAnalysis" });
export type FaceAnalysis = z.infer<typeof FaceAnalysis>;
