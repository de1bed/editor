import type { JsonPatchOp } from "@editor/schemas";

/**
 * Minimal RFC 6902 diff (for audit logs, not for merging): recurses into
 * objects and equal-length arrays, replaces arrays whose length changed.
 */
export function jsonDiff(a: unknown, b: unknown, path = ""): JsonPatchOp[] {
  if (Object.is(a, b)) return [];
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [{ op: "replace", path: path || "", value: b }];
    return a.flatMap((x, i) => jsonDiff(x, b[i], `${path}/${i}`));
  }
  if (isObj(a) && isObj(b)) {
    const ops: JsonPatchOp[] = [];
    for (const k of Object.keys(a)) {
      const p = `${path}/${escape(k)}`;
      if (!(k in b) || b[k] === undefined) {
        if (a[k] !== undefined) ops.push({ op: "remove", path: p });
      } else ops.push(...jsonDiff(a[k], b[k], p));
    }
    for (const k of Object.keys(b)) {
      if ((!(k in a) || a[k] === undefined) && b[k] !== undefined) ops.push({ op: "add", path: `${path}/${escape(k)}`, value: b[k] });
    }
    return ops;
  }
  return [{ op: "replace", path: path || "", value: b }];
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function escape(k: string): string {
  return k.replace(/~/g, "~0").replace(/\//g, "~1");
}
