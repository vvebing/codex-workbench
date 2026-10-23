import { expect, it } from "vitest";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";
import {
  automaticallyExpandOperation,
  executionSegments,
} from "../../src/features/conversation/execution-presentation";
const command = (
  id: string,
  action: "read" | "search" | "unknown" = "read",
): Extract<ThreadItem, { type: "commandExecution" }> => ({
  type: "commandExecution",
  id,
  command: "command",
  cwd: "/repo",
  pluginId: null,
  scriptPath: null,
  processId: null,
  source: "agent",
  status: "completed",
  aggregatedOutput: null,
  exitCode: 0,
  durationMs: 1,
  commandActions:
    action === "read"
      ? [{ type: "read", command: "cat", name: "file", path: "file" }]
      : action === "search"
        ? [{ type: "search", command: "rg", query: "query", path: null }]
        : [{ type: "unknown", command: "command" }],
});
const complete = () => "completed";
it("shows only attention records without changing the original batch identity or boundaries", () => {
  const items: ThreadItem[] = [
    command("success", "unknown"),
    command("failure", "unknown"),
    command("read"),
    command("declined", "unknown"),
    { type: "reasoning", id: "empty", summary: [], content: [] },
    command("waiting", "unknown"),
    { type: "plan", id: "plan", text: "finished plan" },
    { type: "plan", id: "interrupted", text: "interrupted plan" },
  ];
  const resolve = (item: ThreadItem) =>
    ({
      failure: "failed",
      declined: "declined",
      waiting: "waiting",
      interrupted: "interrupted",
    })[item.id] ?? "completed";
  const filtered = executionSegments(items, resolve, true);
  expect(filtered).toMatchObject([
    {
      kind: "summary",
      id: "success",
      items: [items[1]],
      label: "执行了 1 条命令",
      attention: 1,
    },
    { kind: "summary", id: "declined", items: [items[3]], attention: 1 },
    { kind: "summary", id: "waiting", items: [items[5]], waiting: true },
    { kind: "item", item: items[7] },
  ]);
  expect(executionSegments(items, resolve)[0]).toMatchObject({
    id: "success",
    items: items.slice(0, 2),
    label: "执行了 2 条命令",
  });
  expect(executionSegments(items, complete, true)).toEqual([]);
});

it("keeps batch identity from the first command through growth, completion and failure", () => {
  const first = command("first", "unknown");
  for (const status of [
    "inProgress",
    "completed",
    "failed",
    "waiting",
    "interrupted",
  ]) {
    const result = executionSegments(
      [first, command("next", "unknown")],
      (item) => (item.id === "first" ? status : "completed"),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "summary",
      id: "first",
      items: [first, command("next", "unknown")],
      attention: ["failed", "waiting", "interrupted"].includes(status) ? 1 : 0,
    });
  }
  expect(executionSegments([first], complete)[0]).toMatchObject({
    kind: "summary",
    id: "first",
  });
});
it("keeps different kinds of work and explicit messages as batch boundaries", () => {
  const boundary: ThreadItem = { type: "plan", id: "plan", text: "check" };
  expect(
    executionSegments(
      [
        command("read"),
        command("search", "search"),
        boundary,
        command("run", "unknown"),
      ],
      complete,
    ),
  ).toMatchObject([
    { kind: "summary", category: "read", hasFollowingItem: true },
    { kind: "summary", category: "search", hasFollowingItem: true },
    { kind: "item", item: boundary },
    { kind: "summary", category: "run", hasFollowingItem: false },
  ]);
});
it("merges only adjacent calls to the same tool and preserves original results", () => {
  const tool = (id: string, name: string): ThreadItem => ({
    type: "dynamicToolCall",
    id,
    namespace: null,
    tool: name,
    arguments: {},
    status: "completed",
    success: true,
    contentItems: null,
    durationMs: null,
  });
  const items = [
    tool("a", "read"),
    tool("b", "read"),
    tool("c", "edit"),
    tool("d", "read"),
  ];
  const segments = executionSegments(items, complete);
  expect(segments).toHaveLength(3);
  expect(segments[0]).toMatchObject({ id: "a", items: items.slice(0, 2) });
  expect(
    segments.flatMap((s) => (s.kind === "summary" ? s.items : [s.item])),
  ).toEqual(items);
});
it("counts distinct files while retaining every patch in chronological order", () => {
  const patch = (id: string, path: string): ThreadItem => ({
    type: "fileChange",
    id,
    status: "completed",
    changes: [{ path, kind: { type: "add" }, diff: "+line" }],
  });
  const items = [patch("1", "a.ts"), patch("2", "a.ts"), patch("3", "b.ts")];
  expect(executionSegments(items, complete)[0]).toMatchObject({
    label: "修改了 2 个文件 · 3 次修改",
    items,
  });
});
it("empty terminal thinking ends a batch without leaving an empty row", () => {
  const empty: ThreadItem = {
    type: "reasoning",
    id: "empty",
    summary: [],
    content: [],
  };
  const items = [command("before"), empty, command("after")];
  expect(executionSegments(items, complete)).toMatchObject([
    { kind: "summary", id: "before", hasFollowingItem: true },
    { kind: "summary", id: "after", hasFollowingItem: false },
  ]);
  expect(executionSegments([empty], complete)).toEqual([]);
  expect(
    executionSegments(items, (item) =>
      item.id === "empty" ? "inProgress" : "completed",
    )[1],
  ).toEqual({ kind: "item", item: empty });
});
it("only opens sustained command details automatically, keeping reads and instant output compact", () => {
  const run = { ...command("run", "unknown"), durationMs: null };
  expect(automaticallyExpandOperation(run, "inProgress")).toBe(true);
  expect(automaticallyExpandOperation(run, "completed")).toBe(false);
  expect(automaticallyExpandOperation(command("read"), "inProgress")).toBe(
    false,
  );
  expect(
    automaticallyExpandOperation(command("instant", "unknown"), "inProgress"),
  ).toBe(false);
  expect(automaticallyExpandOperation(command("failed"), "failed")).toBe(false);
  expect(automaticallyExpandOperation(command("waiting"), "waiting")).toBe(
    true,
  );
});
