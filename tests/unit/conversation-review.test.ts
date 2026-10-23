import { expect, it } from "vitest";
import {
  diffLineCounts,
  diffLineKind,
} from "../../src/features/conversation/turn-results";
it("counts source changes without diff headers and retains sign information", () => {
  const patch =
    "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1,2 @@\n-old\n+new\n+extra\n context";
  expect(diffLineCounts(patch)).toEqual({ added: 2, removed: 1 });
  expect(diffLineKind("+++ b/a")).toBe("header");
  expect(diffLineKind("+added")).toBe("added");
  expect(diffLineKind("-removed")).toBe("removed");
});
