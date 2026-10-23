import { isTimelineProgress } from "../../src/features/conversation/model";
import { describe, expect, it } from "vitest";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";
import {
  commandTitle,
  operationStatus,
  isInstantOperation,
} from "../../src/features/conversation/operation";

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

describe("instant operation motion", () => {
  it.each([0, 1, 49])(
    "skips motion for %i ms displayed as 0.0 seconds",
    (durationMs) => {
      expect(isInstantOperation({ ...command, durationMs })).toBe(true);
    },
  );
  it.each([50, 100, 1000, null])(
    "keeps motion for a nonzero or unknown duration (%s)",
    (durationMs) => {
      expect(isInstantOperation({ ...command, durationMs })).toBe(false);
    },
  );
  it("keeps motion for operations without timing information", () => {
    expect(isInstantOperation(reasoning)).toBe(false);
  });
  it.each(["inProgress", "completed", "failed", "declined"] as const)(
    "keeps %s file changes static without inventing a duration",
    (status) => {
      expect(
        isInstantOperation({
          type: "fileChange",
          id: "patch",
          status,
          changes: [],
        }),
      ).toBe(true);
    },
  );
});

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
    expect(commandTitle(command)).toBe(`执行命令 · ${command.command}`);
    expect(commandTitle({ ...command, commandActions: [action] })).toBe(
      `执行命令 · ${command.command}`,
    );
    expect(commandTitle({ ...command, commandActions: [action, action] })).toBe(
      `执行命令 · ${command.command}`,
    );
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
