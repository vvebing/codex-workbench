import { isTimelineProgress } from "../../src/features/conversation/model";
import { describe, expect, it } from "vitest";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";
import {
  commandTitle,
  operationStatus,
  partitionOperationGroup,
  operationSummaryExpansion,
} from "../../src/features/conversation/operation";
import { executionSegments } from "../../src/features/conversation/execution-presentation";

const reasoning: ThreadItem = {
  type: "reasoning",
  id: "r",
  summary: [],
  content: [],
};
const command: Extract<ThreadItem, { type: "commandExecution" }> = {
  type: "commandExecution",
  id: "c",
  pluginId: null,
  scriptPath: null,
  command: "cat src/app.ts",
  cwd: "/repo",
  processId: null,
  source: "agent",
  status: "inProgress",
  commandActions: [],
  aggregatedOutput: null,
  exitCode: null,
  durationMs: null,
};

describe("operation lifecycle", () => {
  it("keeps a statusless operation running until its own completion", () => {
    expect(operationStatus(reasoning, "inProgress", false, false, true)).toBe(
      "inProgress",
    );
    expect(operationStatus(reasoning, "inProgress", true, false)).toBe(
      "completed",
    );
  });
  it("keeps completed items successful when their turn is interrupted", () => {
    expect(operationStatus(reasoning, "interrupted", true, false)).toBe(
      "completed",
    );
    expect(
      operationStatus(
        { ...command, status: "completed" },
        "failed",
        false,
        false,
      ),
    ).toBe("completed");
  });
  it("ends unfinished operations on failed or interrupted turns", () => {
    expect(operationStatus(reasoning, "failed", false, false)).toBe("failed");
    expect(operationStatus(command, "interrupted", false, false)).toBe(
      "interrupted",
    );
  });
  it("preserves item rejection even when the turn completes", () => {
    expect(
      operationStatus(
        { ...command, status: "declined" },
        "completed",
        true,
        false,
      ),
    ).toBe("declined");
  });
  it("distinguishes waiting from completion and historical fallback", () => {
    expect(operationStatus(command, "inProgress", false, true)).toBe("waiting");
    expect(operationStatus(reasoning, "completed", false, true)).toBe(
      "completed",
    );
    expect(operationStatus(reasoning, undefined, false, false)).toBe(
      "recorded",
    );
  });
  it("treats an unsuccessful dynamic tool result as failure", () => {
    const tool: ThreadItem = {
      type: "dynamicToolCall",
      id: "d",
      namespace: null,
      tool: "test",
      arguments: {},
      status: "completed",
      contentItems: null,
      success: false,
      durationMs: 10,
    };
    expect(operationStatus(tool, "completed", true, false)).toBe("failed");
  });
});

describe("command titles", () => {
  it("uses a single parsed action to explain the operation", () => {
    expect(
      commandTitle({
        ...command,
        commandActions: [
          {
            type: "read",
            command: command.command,
            name: "app.ts",
            path: "src/app.ts",
          },
        ],
      }),
    ).toBe("读取 app.ts");
    expect(
      commandTitle({
        ...command,
        commandActions: [
          { type: "search", command: "rg foo src", query: "foo", path: "src" },
        ],
      }),
    ).toBe("搜索 foo · src");
    expect(
      commandTitle({
        ...command,
        commandActions: [{ type: "listFiles", command: "ls", path: null }],
      }),
    ).toBe("浏览文件");
  });
  it("preserves compound or unknown commands without guessing intent", () => {
    const action = { type: "unknown" as const, command: command.command };
    expect(commandTitle(command)).toBe(command.command);
    expect(commandTitle({ ...command, commandActions: [action] })).toBe(
      command.command,
    );
    expect(commandTitle({ ...command, commandActions: [action, action] })).toBe(
      command.command,
    );
  });
});

describe("historical operation compaction", () => {
  const context = {
    historical: true,
    threadId: "thread",
    turnId: "turn",
    turnStatus: "completed" as const,
  };
  const success = (id: string): ThreadItem => ({
    ...command,
    id,
    status: "completed",
  });
  it("hides the oldest successes while preserving visible ordering", () => {
    const failed: ThreadItem = { ...command, id: "failed", status: "failed" };
    const items = [success("1"), failed, success("2"), success("3")];
    const result = partitionOperationGroup(items, context, 1);
    expect(result.hidden.map((item) => item.id)).toEqual(["1", "2"]);
    expect(result.visible.map((item) => item.id)).toEqual(["failed", "3"]);
  });
  it("keeps parallel live, rejected, interrupted and approval operations visible", () => {
    const items: ThreadItem[] = [
      success("1"),
      command,
      { ...command, id: "rejected", status: "declined" },
      { ...reasoning, id: "unfinished" },
      success("approval"),
    ];
    const result = partitionOperationGroup(
      items,
      { ...context, turnStatus: "interrupted", waitingItems: ["approval"] },
      0,
    );
    expect(result.hidden.map((item) => item.id)).toEqual(["1"]);
    expect(result.visible.map((item) => item.id)).toEqual([
      "c",
      "rejected",
      "unfinished",
      "approval",
    ]);
  });
  it("does not count reasoning, plans or messages toward operation limit", () => {
    const items: ThreadItem[] = [
      success("1"),
      reasoning,
      { type: "plan", id: "plan", text: "check" },
      { type: "userMessage", id: "message", clientId: null, content: [] },
      success("2"),
    ];
    const result = partitionOperationGroup(items, context, 1);
    expect(result.hidden.map((item) => item.id)).toEqual(["1"]);
    expect(result.visible.map((item) => item.id)).toEqual([
      "r",
      "plan",
      "message",
      "2",
    ]);
  });
  it("keeps all current-turn operations visible", () => {
    expect(
      partitionOperationGroup(
        [success("1")],
        { ...context, historical: false },
        0,
      ).hidden,
    ).toEqual([]);
    expect(
      partitionOperationGroup(
        [success("1")],
        { ...context, turnStatus: "inProgress" },
        0,
      ).hidden,
    ).toEqual([]);
  });
  it("keeps manually expanded successes visible when the turn becomes historical", () => {
    const expanded = [success("1"), success("2"), success("3")];
    const items = [...expanded, success("4"), success("5")];
    const result = partitionOperationGroup(
      items,
      { ...context, expandedItems: expanded.map((item) => item.id) },
      1,
    );
    expect(result.visible.map((item) => item.id)).toEqual(["1", "2", "3", "5"]);
    expect(result.hidden.map((item) => item.id)).toEqual(["4"]);
    expect(
      partitionOperationGroup(items, context, 1).visible.map((item) => item.id),
    ).toEqual(["5"]);
  });
  it("uses scoped completion markers independently for statusless operations", () => {
    const item: ThreadItem = {
      type: "imageView",
      id: "image",
      path: "/image.png",
    };
    expect(
      partitionOperationGroup(
        [item],
        {
          ...context,
          turnStatus: "failed",
          completedItems: {
            [JSON.stringify(["other", "turn", "image"])]: true,
          },
        },
        0,
      ).hidden,
    ).toEqual([]);
    expect(
      partitionOperationGroup(
        [item],
        {
          ...context,
          turnStatus: "failed",
          completedItems: {
            [JSON.stringify(["thread", "turn", "image"])]: true,
          },
        },
        0,
      ).hidden,
    ).toEqual([item]);
  });
});

describe("manual operation summary expansion", () => {
  const commands = ["1", "2", "3"].map((id) => ({
    ...command,
    id,
    status: "completed" as const,
  }));
  const opened = Object.fromEntries(
    commands.map((item) => [item.id, { open: true, version: 1 }]),
  );
  it("preserves a manual choice when more successful commands join the batch", () => {
    const growing = [
      ...commands,
      { ...command, id: "4", status: "completed" as const },
    ];
    expect(operationSummaryExpansion(growing, opened)).toEqual({
      open: true,
      version: 1,
    });
  });
  it("preserves expansion when an earlier live command finishes and changes the segment key", () => {
    const live = { ...command, id: "earlier" };
    const resolve = (item: ThreadItem) =>
      operationStatus(item, "inProgress", false, false);
    const before = executionSegments([live, ...commands], resolve);
    const after = executionSegments(
      [{ ...live, status: "completed" }, ...commands],
      resolve,
    );
    expect(before[1]).toMatchObject({ kind: "summary", id: "1" });
    expect(after[0]).toMatchObject({ kind: "summary", id: "earlier" });
    const summary = after[0];
    if (summary.kind !== "summary") throw new Error("missing summary");
    expect(operationSummaryExpansion(summary.items, opened)).toEqual({
      open: true,
      version: 1,
    });
  });
  it("uses the latest explicit choice when separately controlled batches merge", () => {
    const choices = { ...opened, "4": { open: false, version: 2 } };
    expect(
      operationSummaryExpansion(
        [...commands, { ...command, id: "4" }],
        choices,
      ),
    ).toEqual({ open: false, version: 2 });
    expect(operationSummaryExpansion(commands, choices)).toEqual({
      open: true,
      version: 1,
    });
  });
  it("does not apply a batch choice to unrelated operation IDs", () => {
    expect(
      operationSummaryExpansion([{ ...command, id: "other" }], opened),
    ).toBeUndefined();
    expect(operationSummaryExpansion(commands, {})).toBeUndefined();
  });
});

it("does not invent a live or completed status for snapshot-only statusless items", () => {
  const image: ThreadItem = {
    type: "imageView",
    id: "image",
    path: "/image.png",
  };
  expect(operationStatus(reasoning, "inProgress", false, false)).toBe(
    "recorded",
  );
  expect(operationStatus(image, "inProgress", false, false)).toBe("recorded");
  expect(operationStatus(image, "inProgress", false, false, true)).toBe(
    "inProgress",
  );
  expect(operationStatus(image, "inProgress", true, false, true)).toBe(
    "completed",
  );
});

describe("timeline progress boundaries", () => {
  const reply = (
    id: string,
    phase: "commentary" | "final_answer" | null,
  ): ThreadItem => ({
    type: "agentMessage",
    id,
    phase,
    text: id,
    memoryCitation: null,
    delivery: null,
    questions: null,
  });
  it("preserves final answers and the last legacy reply while folding intermediate messages", () => {
    const items = [
      reply("legacy-progress", null),
      reply("commentary", "commentary"),
      reply("final", "final_answer"),
      reply("legacy-final", null),
    ];
    expect(items.map((item) => isTimelineProgress(item, items))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(isTimelineProgress(reasoning, items)).toBe(true);
    const user: ThreadItem = {
      type: "userMessage",
      id: "u",
      clientId: null,
      content: [],
    };
    expect(isTimelineProgress(user, items)).toBe(false);
  });
  it("preserves the last legacy response even when commentary follows", () => {
    const items = [
      reply("legacy-final", null),
      reply("later-progress", "commentary"),
    ];
    expect(items.map((item) => isTimelineProgress(item, items))).toEqual([
      false,
      true,
    ]);
  });
});
