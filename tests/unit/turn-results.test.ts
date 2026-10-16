import { describe, expect, it } from "vitest";
import type { Turn } from "../../src/generated/v2/Turn";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";
import { turnFileResults } from "../../src/features/conversation/turn-results";
const change = (
  id: string,
  status: "completed" | "failed" | "declined",
  path: string,
  diff: string,
): ThreadItem => ({
  id,
  type: "fileChange",
  status,
  changes: [{ path, diff, kind: { type: "add" } }],
});
const turn = (items: ThreadItem[]): Turn => ({
  id: "turn",
  items,
  status: "completed",
  itemsView: "full",
  rootTurnId: null,
  error: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
});
describe("turn file results", () => {
  it("preserves repeated completed patches and excludes failed or declined changes", () => {
    const results = turnFileResults(
      turn([
        change("1", "completed", "/workspace/a.ts", "+first"),
        change("2", "failed", "/workspace/b.ts", "+failed"),
        change("3", "completed", "/workspace/a.ts", "-first\n+second"),
        change("4", "declined", "/workspace/c.ts", "+declined"),
      ]),
      undefined,
      "/workspace",
    );
    expect(results.aggregate).toBe(false);
    expect(results.files).toEqual([
      {
        path: "a.ts",
        originalPath: "/workspace/a.ts",
        diff: "+first\n\n-first\n+second",
      },
    ]);
  });
  it("uses only authoritative aggregate files and respects an empty aggregate", () => {
    const source = turn([change("1", "completed", "old.ts", "+old")]);
    const diff =
      "diff --git a/new.ts b/new.ts\n--- a/new.ts\n+++ b/new.ts\n+new";
    expect(
      turnFileResults(source, diff).files.map((file) => file.path),
    ).toEqual(["new.ts"]);
    expect(turnFileResults(source, "").files).toEqual([]);
  });
});
