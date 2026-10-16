import { expect, it } from "vitest";
import {
  directAgentTasks,
  resolveAgentStatus,
  agentStatusCounts,
  latestAgentActivity,
} from "../../src/features/conversation/agent-model";
import { placeholderThread } from "../../src/lib/state";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";
import type { Thread } from "../../src/generated/v2/Thread";
const collab = (
  id: string,
  extra: Partial<Extract<ThreadItem, { type: "collabAgentToolCall" }>> = {},
): ThreadItem => ({
  type: "collabAgentToolCall",
  id,
  tool: "spawnAgent",
  status: "completed",
  senderThreadId: "parent",
  receiverThreadIds: ["child"],
  prompt: "检查协议",
  model: null,
  reasoningEffort: null,
  agentsStates: {},
  ...extra,
});
const withItems = (...groups: ThreadItem[][]): Thread => ({
  ...placeholderThread("parent"),
  turns: groups.map((items, index) => ({
    id: `turn-${index}`,
    rootTurnId: null,
    items,
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
  })),
});
it("does not confuse completed spawn calls with completed agent tasks", () => {
  expect(directAgentTasks(withItems([collab("spawn")]))).toEqual([
    { id: "child", prompt: "检查协议", status: "unknown", message: null },
  ]);
});
it("updates followup prompts and uses latest explicit state across turns", () => {
  const tasks = directAgentTasks(
    withItems(
      [
        collab("spawn", {
          agentsStates: { child: { status: "running", message: null } },
        }),
      ],
      [
        collab("followup", {
          tool: "followupTask",
          prompt: "补充测试",
          agentsStates: { child: { status: "completed", message: "测试通过" } },
        }),
      ],
    ),
  );
  expect(tasks).toEqual([
    {
      id: "child",
      prompt: "补充测试",
      status: "completed",
      message: "测试通过",
    },
  ]);
});
it("deduplicates updated event copies", () => {
  expect(
    directAgentTasks(
      withItems(
        [
          collab("same", {
            agentsStates: { child: { status: "running", message: null } },
          }),
        ],
        [
          collab("same", {
            agentsStates: { child: { status: "errored", message: "失败" } },
          }),
        ],
      ),
    )[0].status,
  ).toBe("errored");
});
it("resolves lifecycle activity without relying on spawn success", () => {
  const activity = (
    kind: "started" | "completed" | "interrupted",
  ): ThreadItem => ({
    type: "subAgentActivity",
    id: kind,
    kind,
    agentThreadId: "child",
    agentPath: "/root/check",
    model: null,
    reasoningEffort: null,
  });
  expect(directAgentTasks(withItems([activity("started")]))[0].status).toBe(
    "running",
  );
  expect(
    directAgentTasks(withItems([activity("started"), activity("completed")]))[0]
      .status,
  ).toBe("completed");
  expect(directAgentTasks(withItems([activity("interrupted")]))[0].status).toBe(
    "interrupted",
  );
});
it("uses direct parent metadata and never includes self, siblings or grandchildren", () => {
  const known = {
    child: {
      ...placeholderThread("child"),
      parentThreadId: "parent",
      agentNickname: "Atlas",
      agentRole: "explorer",
    },
    sibling: { ...placeholderThread("sibling"), parentThreadId: "other" },
    grandchild: { ...placeholderThread("grandchild"), parentThreadId: "child" },
  };
  const result = directAgentTasks(
    withItems([
      collab("spawn", {
        receiverThreadIds: ["parent", "child", "sibling", "grandchild"],
      }),
      collab("foreign", {
        senderThreadId: "other",
        receiverThreadIds: ["foreign"],
      }),
    ]),
    known,
  );
  expect(result.map((task) => task.id)).toEqual(["child"]);
  expect(result[0]).toMatchObject({ nickname: "Atlas", role: "explorer" });
  expect(directAgentTasks(withItems([]), known).map((task) => task.id)).toEqual(
    ["child"],
  );
});
it("summarizes the latest actual commentary and tool activity", () => {
  const commentary: ThreadItem = {
    type: "agentMessage",
    id: "message",
    text: "正在检查事件协议",
    phase: "commentary",
    memoryCitation: null,
    delivery: null,
    questions: null,
  };
  const tool: ThreadItem = {
    type: "dynamicToolCall",
    id: "tool",
    namespace: "browser",
    tool: "read",
    arguments: {},
    status: "inProgress",
    contentItems: null,
    success: null,
    durationMs: null,
  };
  expect(latestAgentActivity(withItems([commentary]))).toBe(commentary.text);
  expect(latestAgentActivity(withItems([commentary, tool]))).toBe(
    "调用 browser.read",
  );
  expect(latestAgentActivity(withItems([]))).toBe("暂无活动记录");
});

it("retains event-discovered agents when early deltas created an incomplete placeholder", () => {
  const known = { child: placeholderThread("child") };
  expect(
    directAgentTasks(withItems([collab("spawn")]), known).map(
      (task) => task.id,
    ),
  ).toEqual(["child"]);
});
it("observed new work restarts an agent whose previous task completed", () => {
  const parent = withItems([
    collab("spawn", {
      agentsStates: { child: { status: "completed", message: "done" } },
    }),
  ]);
  const child = {
    ...placeholderThread("child"),
    parentThreadId: "parent",
    status: { type: "active" as const, activeFlags: [] },
  };
  expect(directAgentTasks(parent, { child })[0].status).toBe("running");
  const newTurn = { ...withItems([]).turns[0], status: "inProgress" as const };
  expect(
    directAgentTasks(parent, {
      child: { ...child, status: { type: "idle" }, turns: [newTurn] },
    })[0].status,
  ).toBe("running");
});

it("known child terminal status replaces stale parent running state", () => {
  const parent = withItems([
    collab("spawn", {
      agentsStates: { child: { status: "running", message: null } },
    }),
  ]);
  const child = {
    ...withItems([]),
    id: "child",
    parentThreadId: "parent",
    status: { type: "idle" as const },
  };
  expect(directAgentTasks(parent, { child })[0].status).toBe("completed");
  expect(
    resolveAgentStatus("running", {
      ...child,
      turns: [{ ...child.turns[0], status: "failed" }],
    }),
  ).toBe("errored");
  expect(
    resolveAgentStatus("running", {
      ...child,
      turns: [{ ...child.turns[0], status: "interrupted" }],
    }),
  ).toBe("interrupted");
});
it("counts known states consistently and never treats unknown as completed", () => {
  const statuses = [
    "running",
    "completed",
    "unknown",
    "pendingInit",
    "errored",
    "interrupted",
    "notFound",
  ] as const;
  const agents = statuses.map((status, index) => ({
    id: String(index),
    status,
    prompt: null,
    message: null,
  }));
  const counts = agentStatusCounts(agents, {}, new Set(["0"]));
  expect(counts).toEqual({
    running: 0,
    completed: 1,
    waiting: 1,
    failed: 2,
    interrupted: 1,
    preparing: 1,
    unknown: 1,
  });
  expect(resolveAgentStatus("unknown", placeholderThread("empty"))).toBe(
    "unknown",
  );
  expect(resolveAgentStatus("completed", undefined, true)).toBe("waiting");
});
