import { describe, expect, it } from "vitest";
import { diffQuitEarly } from "../../src/features/files/diff-status";

describe("diff computation status", () => {
  it("distinguishes an incomplete result from a completed identical result", () => {
    expect(
      diffQuitEarly({
        getLineChanges: () => [],
        getDiffComputationResult: () => ({ quitEarly: true }),
      }),
    ).toBe(true);
    expect(
      diffQuitEarly({
        getLineChanges: () => [],
        getDiffComputationResult: () => ({ quitEarly: false }),
      }),
    ).toBe(false);
  });
  it("keeps unavailable computations distinct from an empty completed diff", () => {
    expect(diffQuitEarly({ getLineChanges: () => null })).toBe(true);
    expect(diffQuitEarly({ getLineChanges: () => [] })).toBe(false);
    expect(
      diffQuitEarly({
        getLineChanges: () => null,
        getDiffComputationResult: () => null,
      }),
    ).toBe(false);
  });
});
