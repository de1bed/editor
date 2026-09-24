import { describe, expect, it } from "vitest";
import { mapSourceRange, outputDurationMs, outputToSource, sourceToOutput } from "../src/time";

const segs = [
  { id: "a", sourceStartMs: 1000, sourceEndMs: 3000, speed: 1 as const },
  { id: "b", sourceStartMs: 5000, sourceEndMs: 6000, speed: 1 as const },
];

describe("time mapping", () => {
  it("computes output duration", () => expect(outputDurationMs(segs)).toBe(3000));
  it("maps source instants", () => {
    expect(sourceToOutput(segs, 1000)).toBe(0);
    expect(sourceToOutput(segs, 2999)).toBe(1999);
    expect(sourceToOutput(segs, 5500)).toBe(2500);
    expect(sourceToOutput(segs, 4000)).toBeNull();
  });
  it("maps output instants back", () => {
    expect(outputToSource(segs, 2500)).toEqual({ sourceMs: 5500, segmentIndex: 1 });
    expect(outputToSource(segs, 3000)).toBeNull();
  });
  it("splits ranges across cuts", () => {
    expect(mapSourceRange(segs, 2500, 5500)).toEqual([
      { segmentIndex: 0, sourceStartMs: 2500, sourceEndMs: 3000, outputStartMs: 1500, outputEndMs: 2000 },
      { segmentIndex: 1, sourceStartMs: 5000, sourceEndMs: 5500, outputStartMs: 2000, outputEndMs: 2500 },
    ]);
  });
});
