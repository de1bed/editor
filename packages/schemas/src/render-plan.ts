import { z } from "zod";

/**
 * A fully resolved FFmpeg invocation. Produced by the TypeScript compiler,
 * executed verbatim by any executor (Node locally, Python on Modal).
 * Placeholders:
 *   {{input:<key>}} -> local path or URL of an input declared in `inputs`
 *   {{file:<name>}} -> path of a file declared in `files` (written by the executor)
 *   {{fontsdir}}    -> directory containing the fonts
 *   {{output}}      -> output path
 */
export const RenderPlan = z
  .object({
    version: z.literal(1),
    quality: z.enum(["preview", "final"]),
    inputs: z.record(z.string(), z.object({ assetId: z.string(), variant: z.enum(["source", "proxy", "music"]) })),
    files: z.record(z.string(), z.string()),
    fonts: z.array(z.string()).default([]),
    args: z.array(z.string()),
    output: z.object({ container: z.literal("mp4"), width: z.int(), height: z.int(), fps: z.int(), durationMs: z.int() }),
    /** sha256 of the canonical plan; identical plans produce identical files. */
    hash: z.string(),
  })
  .meta({ id: "RenderPlan", title: "RenderPlan" });
export type RenderPlan = z.infer<typeof RenderPlan>;
