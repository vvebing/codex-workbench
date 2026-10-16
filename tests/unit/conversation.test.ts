import { describe, expect, it } from "vitest";
import {
  groupTimelineItems,
  mergeFileChanges,
  splitFileDiffs,
} from "../../src/features/conversation/model";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";

describe("conversation presentation", () => {
  it("keeps messages in order and groups only consecutive execution events", () => {
    const user: ThreadItem = {
      type: "userMessage",
      id: "u",
      clientId: null,
      content: [],
    };
    const tool: ThreadItem = { type: "contextCompaction", id: "t" };
    const plan: ThreadItem = { type: "plan", id: "p", text: "Plan" };
    expect(
      groupTimelineItems([user, tool, plan, user, tool]).map((group) =>
        group.map((item) => item.id),
      ),
    ).toEqual([["u"], ["t", "p"], ["u"], ["t"]]);
  });
  it("splits aggregated git patches so each file can be selected", () => {
    const files = splitFileDiffs(
      "diff --git a/one.ts b/one.ts\n--- a/one.ts\n+++ b/one.ts\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/two.ts b/two.ts\n--- /dev/null\n+++ b/two.ts\n+added",
    );
    expect([...files.keys()]).toEqual(["one.ts", "two.ts"]);
    expect(files.get("one.ts")).toContain("-old\n+new");
    expect(files.get("one.ts")).not.toContain("two.ts");
    expect(files.get("two.ts")).toContain("+added");
  });
  it("recognizes added files in a plain unified diff", () => {
    expect([
      ...splitFileDiffs(
        "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+hi",
      ).keys(),
    ]).toEqual(["new.txt"]);
  });
});

it("merges absolute history paths with workspace-relative git paths", () => {
  const patch =
    "diff --git a/src/navigation.ts b/src/navigation.ts\n--- a/src/navigation.ts\n+++ b/src/navigation.ts\n+new";
  const files = mergeFileChanges(
    [{ path: "/demo/api-service/src/navigation.ts", diff: "+old" }],
    patch,
    "/demo/api-service",
  );
  expect(files.size).toBe(1);
  expect(files.get("src/navigation.ts")).toEqual({
    path: "src/navigation.ts",
    originalPath: "/demo/api-service/src/navigation.ts",
    diff: patch,
  });
});
