import { afterEach, expect, it, vi } from "vitest";
import { createRuntime } from "../../src/lib/runtime";
import { placeholderThread } from "../../src/lib/state";
import type { RpcRequest } from "../../src/lib/rpc";
import {
  environmentTasks,
  environmentTaskSummary,
  requestNoticeTitle,
} from "../../src/features/task-center/model";
import { emptyDraft } from "../../src/features/composer/drafts";

afterEach(() => vi.restoreAllMocks());
it("classifies permission and MCP requests without calling them command approvals", () => {
  const title = (method: string, mode?: string) =>
    requestNoticeTitle({ method, params: { mode } } as RpcRequest);
  expect(title("item/permissions/requestApproval")).toBe("权限申请待审批");
  expect(title("mcpServer/elicitation/request", "form")).toBe("MCP 表单待填写");
  expect(title("mcpServer/elicitation/request", "url")).toBe("MCP 授权待处理");
});
it("derives current outbox state once per queue and removes resolved items", () => {
  const runtime = createRuntime();
  const state = runtime.queue.getSnapshot();
  const queue = {
    paused: "连接已改变",
    items: [
      {
        id: "delivery",
        draft: emptyDraft(),
        input: [],
        options: {},
        status: "uncertain" as const,
      },
    ],
  };
  const spy = vi
    .spyOn(runtime.queue, "getSnapshot")
    .mockReturnValue({ ...state, threads: { original: queue } });
  const tasks = environmentTasks(runtime);
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({
    threadId: "original",
    category: "失败或待核实",
    detail: "连接已改变",
  });
  spy.mockReturnValue({
    ...state,
    threads: {
      original: { ...queue, items: [{ ...queue.items[0], status: "queued" }] },
    },
  });
  expect(environmentTasks(runtime)[0].category).toBe("暂停队列");
  spy.mockReturnValue({ ...state, threads: {} });
  expect(environmentTasks(runtime)).toEqual([]);
});
it("isolates environments and tracks local uncertain sends using the source thread", () => {
  const first = createRuntime();
  const second = createRuntime();
  vi.spyOn(first.sessions, "getSnapshot").mockReturnValue({
    ...first.sessions.getSnapshot(),
    threads: { a: placeholderThread("a") },
  });
  const id = first.submissions.messages.add("a", []);
  first.submissions.messages.set(id, "uncertain", "连接断开");
  expect(environmentTasks(first)).toEqual([
    expect.objectContaining({ threadId: "a", title: "消息发送结果待核实" }),
  ]);
  expect(environmentTasks(second)).toEqual([]);
  first.submissions.messages.remove(id);
  expect(environmentTasks(first)).toEqual([]);
});
it("deduplicates live questions with RPC, queued and acknowledged answers", () => {
  const runtime = createRuntime();
  const thread = placeholderThread("a");
  thread.turns = [
    {
      id: "turn",
      rootTurnId: null,
      status: "completed",
      error: null,
      startedAt: 1,
      completedAt: 2,
      durationMs: 1,
      itemsView: "full",
      items: [
        {
          type: "agentMessage",
          id: "question",
          text: "问题",
          phase: null,
          memoryCitation: null,
          delivery: null,
          questions: [{ title: "选择", options: null }],
        },
      ],
    },
  ];
  vi.spyOn(runtime.sessions, "getSnapshot").mockReturnValue({
    ...runtime.sessions.getSnapshot(),
    threads: { a: thread },
  });
  expect(environmentTasks(runtime)).toHaveLength(1);
  const request: RpcRequest = {
    id: 1,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "a",
      turnId: "turn",
      itemId: "question",
      isBlocking: true,
      autoResolutionMs: null,
      questions: [
        {
          id: "q",
          header: "选择",
          question: "选择环境",
          options: null,
          isOther: true,
          isSecret: false,
        },
      ],
    },
  };
  const requests = runtime.requests.getSnapshot();
  const requestsSpy = vi
    .spyOn(runtime.requests, "getSnapshot")
    .mockReturnValue({ ...requests, pending: [request] });
  expect(environmentTasks(runtime)).toHaveLength(1);
  requestsSpy.mockReturnValue(requests);
  vi.spyOn(runtime.queue, "getSnapshot").mockReturnValue({
    ...runtime.queue.getSnapshot(),
    threads: {
      a: { paused: null, items: [], sentAnswers: { question: ["开发"] } },
    },
  });
  expect(environmentTasks(runtime)).toEqual([]);
});
it("keeps unread completed results after dismissing the toast and removes them when read", async () => {
  const { CodexClient } = await import("../../src/lib/rpc");
  const { clearCompletion } = await import("../../src/features/sessions/state");
  const listeners: ((
    event: import("../../src/lib/rpc").RpcNotification,
  ) => void)[] = [];
  vi.spyOn(CodexClient.prototype, "onNotification").mockImplementation(
    (listener) => {
      listeners.push(listener);
      return () => {};
    },
  );
  const runtime = createRuntime();
  const thread = placeholderThread("a");
  const turn: import("../../src/generated/v2/Turn").Turn = {
    id: "turn",
    rootTurnId: null,
    items: [],
    itemsView: "full",
    status: "failed",
    error: null,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1,
  };
  for (const listener of listeners)
    listener({ method: "thread/started", params: { thread } });
  for (const listener of listeners)
    listener({ method: "turn/completed", params: { threadId: "a", turn } });
  expect(
    environmentTasks(runtime).some((task) => task.category === "待查看结果"),
  ).toBe(false);
  for (const listener of listeners)
    listener({
      method: "turn/completed",
      params: {
        threadId: "a",
        turn: { ...turn, id: "success", status: "completed" },
      },
    });
  const notice = runtime.sessions.getSnapshot().completionNotifications[0];
  expect(notice).toBeDefined();
  runtime.sessions.dismissCompletion(notice.id);
  expect(runtime.sessions.getSnapshot().completionNotifications).toEqual([]);
  expect(
    environmentTasks(runtime).filter((task) => task.category === "待查看结果"),
  ).toEqual([expect.objectContaining({ threadId: "a" })]);
  const read = clearCompletion(runtime.sessions.getSnapshot(), "a");
  vi.spyOn(runtime.sessions, "getSnapshot").mockReturnValue(read);
  expect(
    environmentTasks(runtime).some((task) => task.category === "待查看结果"),
  ).toBe(false);
});

it("distinguishes offline and incomplete task state from a confirmed empty environment", () => {
  const runtime = createRuntime();
  const connection = { ...runtime.connection.getSnapshot() };
  const sessions = { ...runtime.sessions.getSnapshot() };
  vi.spyOn(runtime.connection, "getSnapshot").mockImplementation(
    () => connection,
  );
  vi.spyOn(runtime.sessions, "getSnapshot").mockImplementation(() => sessions);
  expect(environmentTaskSummary(runtime)).toMatchObject({
    state: "offline",
    count: 0,
    label: "待办状态待同步",
  });
  connection.status = "connected";
  expect(environmentTaskSummary(runtime).state).toBe("partial");
  sessions.historyLoading = true;
  expect(environmentTaskSummary(runtime).state).toBe("syncing");
  sessions.historyLoading = false;
  sessions.historyComplete = true;
  expect(environmentTaskSummary(runtime)).toMatchObject({
    state: "ready",
    count: 0,
    label: "0 项",
  });
  sessions.historyError = "discovery failed";
  expect(environmentTaskSummary(runtime)).toMatchObject({
    state: "partial",
    label: "待办状态未完整同步",
  });
});
it("retains known offline tasks without presenting cached counts as synchronized", () => {
  const runtime = createRuntime();
  const entries = [
    { id: "known", category: "待审批" as const, title: "permission" },
  ];
  expect(environmentTaskSummary(runtime, entries)).toMatchObject({
    state: "offline",
    count: 1,
    label: "1 项已知待办 · 待同步",
  });
});
