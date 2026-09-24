import { z } from "zod";

/** Milliseconds as a non-negative integer. All times in the system use this unit. */
export const Ms = z.int().nonnegative();
/** Normalized coordinate in [0, 1], relative to the source frame. */
export const Unit = z.number().min(0).max(1);
export const Id = z.string().min(1).max(128);
export const Hex = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, "expected #RRGGBB or #RRGGBBAA");
export const Lang = z.string().min(2).max(8);

export const Rational = z.object({ num: z.int().positive(), den: z.int().positive() });
export type Rational = z.infer<typeof Rational>;

/** RFC 6902 operation, kept for audit next to typed EditOps. */
export const JsonPatchOp = z.object({
  op: z.enum(["add", "remove", "replace", "move", "copy", "test"]),
  path: z.string(),
  from: z.string().optional(),
  value: z.unknown().optional(),
});
export type JsonPatchOp = z.infer<typeof JsonPatchOp>;
