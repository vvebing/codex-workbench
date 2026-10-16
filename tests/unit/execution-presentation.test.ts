import { expect, it } from "vitest";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";
import { executionSegments } from "../../src/features/conversation/execution-presentation";
const command = (
  id: string,
  action: "read" | "search" | "unknown" = "read",
): ThreadItem => ({
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
const ids = (items: ThreadItem[]) => items.map((item) => item.id);
it("summarizes an adjacent successful batch and keeps subsequent live work visible", () => {
  const items = [command("1"), command("2"), command("3"), command("live")];
  const result = executionSegments(items, (item) =>
    item.id === "live" ? "inProgress" : "completed",
  );
  expect(result[0]).toMatchObject({
    kind: "summary",
    id: "1",
    label: "读取了 3 项文件操作",
  });
  expect(result[1]).toEqual({ kind: "item", item: items[3] });
  expect(
    result.flatMap((segment) =>
      segment.kind === "item" ? [segment.item.id] : ids(segment.items),
    ),
  ).toEqual(ids(items));
});
it("keeps the segment identity when successful commands are appended or receive new output", () => {
  const items = [command("1"), command("2"), command("3")];
  const before = executionSegments(items, complete)[0];
  const after = executionSegments(
    [
      ...items.map((item) =>
        item.type === "commandExecution"
          ? { ...item, aggregatedOutput: "new output" }
          : item,
      ),
      command("4"),
    ],
    complete,
  )[0];
  expect(before).toMatchObject({ kind: "summary", id: "1" });
  expect(after).toMatchObject({
    kind: "summary",
    id: "1",
    label: "读取了 4 项文件操作",
  });
});
it("keeps short batches individual and never combines unrelated categories", () => {
  const items = [
    command("1"),
    command("2"),
    command("3", "search"),
    command("4", "search"),
    command("5", "search"),
    command("6", "unknown"),
  ];
  expect(
    executionSegments(items, complete).map((segment) => segment.kind),
  ).toEqual(["item", "item", "summary", "item"]);
  expect(executionSegments(items, complete)[2]).toMatchObject({
    label: "搜索了 3 项",
  });
});
it.each([
  "failed",
  "declined",
  "waiting",
  "inProgress",
  "recorded",
  "interrupted",
])("keeps %s as a visible boundary even between successes", (status) => {
  const items = Array.from({ length: 5 }, (_, i) => command(String(i)));
  const result = executionSegments(items, (item) =>
    item.id === "2" ? status : "completed",
  );
  expect(result.every((segment) => segment.kind === "item")).toBe(true);
});
it("does not summarize across thinking, plans or messages", () => {
  const boundaries: ThreadItem[] = [
    { type: "reasoning", id: "reasoning", summary: [], content: [] },
    { type: "plan", id: "plan", text: "check" },
    { type: "userMessage", id: "user", clientId: null, content: [] },
  ];
  for (const boundary of boundaries) {
    const result = executionSegments(
      [command("1"), command("2"), boundary, command("3"), command("4")],
      complete,
    );
    expect(result.every((segment) => segment.kind === "item")).toBe(true);
  }
});
it("combines tool successes while preserving their full original items", () => {
  const items: ThreadItem[] = Array.from({ length: 3 }, (_, i) => ({
    type: "dynamicToolCall",
    id: String(i),
    namespace: null,
    tool: "read",
    arguments: {},
    status: "completed",
    success: true,
    contentItems: null,
    durationMs: null,
  }));
  const result = executionSegments(items, complete);
  expect(result).toEqual([
    { kind: "summary", id: "0", label: "完成 3 次工具调用", items },
  ]);
});
it("treats compound parsed commands conservatively as command execution", () => {
  const items = Array.from({ length: 3 }, (_, i) => {
    const item = command(String(i));
    if (item.type === "commandExecution")
      item.commandActions.push({
        type: "search",
        command: "rg",
        query: null,
        path: null,
      });
    return item;
  });
  expect(executionSegments(items, complete)[0]).toMatchObject({
    kind: "summary",
    label: "执行了 3 条命令",
  });
});
