import { describe, expect, it, vi } from "vitest";
import { createRuntime } from "../../src/lib/runtime";
import { emptyState, reduceNotification } from "../../src/lib/state";
import type { Thread } from "../../src/generated/v2/Thread";
const thread = (id: string): Thread =>
  reduceNotification(emptyState(), {
    method: "thread/status/changed",
    params: { threadId: id, status: { type: "idle" } },
  }).threads[id];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe("feature ownership and races", () => {
  it("leaves the current conversation untouched when selected again", async () => {
    const runtime = createRuntime();
    const request = vi
      .spyOn(runtime.connection.client, "request")
      .mockResolvedValue({ thread: thread("a") });
    await runtime.sessions.open("a");
    request.mockClear();
    const before = runtime.sessions.getSnapshot();
    const changed = vi.fn();
    const stop = runtime.sessions.subscribe(changed);
    await runtime.sessions.open("a");
    expect(request).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(runtime.sessions.getSnapshot()).toBe(before);
    stop();
  });
  it("hydrates both requested threads without stale selection", async () => {
    const runtime = createRuntime();
    const first = deferred<{ thread: Thread }>();
    const second = deferred<{ thread: Thread }>();
    vi.spyOn(runtime.connection.client, "request").mockImplementation(((
      _method: string,
      params: { threadId: string },
    ) => (params.threadId === "a" ? first.promise : second.promise)) as never);
    const a = runtime.sessions.open("a");
    expect(runtime.sessions.getSnapshot().openingId).toBe("a");
    const b = runtime.sessions.open("b");
    expect(runtime.sessions.getSnapshot().openingId).toBe("b");
    second.resolve({ thread: thread("b") });
    await b;
    expect(runtime.sessions.getSnapshot().openingId).toBeNull();
    first.resolve({ thread: thread("a") });
    await a;
    expect(runtime.sessions.getSnapshot().selectedId).toBe("b");
    expect(Object.keys(runtime.sessions.getSnapshot().threads)).toEqual([
      "b",
      "a",
    ]);
  });
  it("clears loading on history failure", async () => {
    const runtime = createRuntime();
    vi.spyOn(runtime.connection.client, "request").mockRejectedValue(
      new Error("read failed"),
    );
    const opening = runtime.sessions.open("a");
    expect(runtime.sessions.getSnapshot().openingId).toBe("a");
    await expect(opening).rejects.toThrow("read failed");
    expect(runtime.sessions.getSnapshot().openingId).toBeNull();
    expect(runtime.sessions.getSnapshot().error).toBe("read failed");
  });
  it("ignores responses after disconnect and protects newly edited draft", async () => {
    const runtime = createRuntime();
    const response = deferred<{ thread: Thread }>();
    vi.spyOn(runtime.connection.client, "request").mockReturnValue(
      response.promise,
    );
    const opening = runtime.sessions.open("a");
    await Promise.resolve();
    runtime.connection.disconnect();
    response.resolve({ thread: thread("a") });
    await opening;
    expect(runtime.sessions.getSnapshot().threads).toEqual({});
    runtime.drafts.setText("a", "old");
    const revision = runtime.drafts.get("a").revision;
    runtime.drafts.setText("a", "new");
    expect(runtime.drafts.clearIfRevision("a", revision)).toBe(false);
    expect(runtime.drafts.get("a").text).toBe("new");
    expect(runtime.drafts.get("b").text).toBe("");
  });
  it("sends steer only with active-turn precondition", async () => {
    const runtime = createRuntime();
    const request = vi
      .spyOn(runtime.connection.client, "request")
      .mockResolvedValue({});
    const current = thread("a");
    current.turns = [
      {
        id: "turn-a",
        rootTurnId: null,
        items: [],
        itemsView: "full",
        status: "inProgress",
        error: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
      },
    ];
    request.mockResolvedValueOnce({ thread: current });
    await runtime.sessions.activate("a");
    await runtime.sessions.send("a", [
      { type: "text", text: "more", text_elements: [] },
    ]);
    expect(request).toHaveBeenLastCalledWith("turn/steer", {
      threadId: "a",
      expectedTurnId: "turn-a",
      input: [{ type: "text", text: "more", text_elements: [] }],
    });
  });
});

import { ConnectionStore } from "../../src/features/connection/store";
import { RequestsStore } from "../../src/features/requests/store";
import type { RpcRequest, RpcNotification } from "../../src/lib/rpc";
it("isolates approvals by thread and does not answer an ID twice", () => {
  const connection = new ConnectionStore();
  let receive!: (request: RpcRequest) => void;
  let notify!: (notification: RpcNotification) => void;
  vi.spyOn(connection.client, "onRequest").mockImplementation((listener) => {
    receive = listener;
    return () => {};
  });
  vi.spyOn(connection.client, "onNotification").mockImplementation(
    (listener) => {
      notify = listener;
      return () => {};
    },
  );
  const respond = vi
    .spyOn(connection.client, "respond")
    .mockImplementation(() => {});
  const requests = new RequestsStore(connection);
  receive({
    id: 7,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "a" },
  } as RpcRequest);
  receive({
    id: 8,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "b" },
  } as RpcRequest);
  expect(requests.forThread("a").map((request) => request.id)).toEqual([7]);
  expect(requests.respond(7, { decision: "accept" })).toBe(true);
  receive({
    id: 7,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "a" },
  } as RpcRequest);
  expect(requests.respond(7, { decision: "accept" })).toBe(false);
  expect(respond).toHaveBeenCalledTimes(1);
  notify({
    method: "serverRequest/resolved",
    params: { threadId: "b", requestId: 8 },
  });
  expect(requests.getSnapshot().pending).toEqual([]);
});
it("locks local draft creation and pagination and preserves the draft on disconnect", async () => {
  const runtime = createRuntime();
  const request = vi.spyOn(runtime.connection.client, "request");
  const first = runtime.sessions.create();
  expect(runtime.sessions.create()).toBe(first);
  const draft = await first;
  expect(request).not.toHaveBeenCalled();
  runtime.connection.disconnect();
  expect(runtime.sessions.getSnapshot().threads[draft.id]).toBe(draft);
  request.mockResolvedValue({ data: [thread("a")], nextCursor: "next" });
  await runtime.sessions.refresh();
  expect(runtime.sessions.getSnapshot().localDrafts[draft.id]).toBeDefined();
  const page = deferred<{ data: Thread[]; nextCursor: null }>();
  request.mockReturnValue(page.promise);
  const more = runtime.sessions.loadMore();
  expect(runtime.sessions.loadMore()).toBe(more);
  page.resolve({ data: [thread("b")], nextCursor: null });
  await more;
  expect(runtime.sessions.getSnapshot().listIds).toEqual(["a", "b"]);
});

it("skips empty and duplicate-only pages until pagination adds a conversation", async () => {
  const runtime = createRuntime();
  const request = vi
    .spyOn(runtime.connection.client, "request")
    .mockResolvedValueOnce({ data: [thread("a")], nextCursor: "one" })
    .mockResolvedValueOnce({ data: [], nextCursor: "two" })
    .mockResolvedValueOnce({ data: [thread("a")], nextCursor: "three" })
    .mockResolvedValueOnce({ data: [thread("b")], nextCursor: null });
  await runtime.sessions.refresh();
  await runtime.sessions.loadMore();
  expect(
    request.mock.calls
      .slice(1)
      .map(([, params]) => (params as { cursor: string }).cursor),
  ).toEqual(["one", "two", "three"]);
  expect(runtime.sessions.getSnapshot().listIds).toEqual(["a", "b"]);
  expect(runtime.sessions.getSnapshot().nextCursor).toBeNull();
});

it("stops repeated cursors without losing fetched rows", async () => {
  const runtime = createRuntime();
  vi.spyOn(runtime.connection.client, "request")
    .mockResolvedValueOnce({ data: [thread("a")], nextCursor: "same" })
    .mockResolvedValueOnce({ data: [thread("b")], nextCursor: "same" });
  await runtime.sessions.refresh();
  await expect(runtime.sessions.loadMore()).rejects.toThrow("游标重复");
  expect(runtime.sessions.getSnapshot().listIds).toEqual(["a", "b"]);
  expect(runtime.sessions.getSnapshot()).toMatchObject({
    nextCursor: null,
    loading: false,
  });
});

it("retains the advanced cursor after a later page fails so retry resumes there", async () => {
  const runtime = createRuntime();
  const request = vi
    .spyOn(runtime.connection.client, "request")
    .mockResolvedValueOnce({ data: [thread("a")], nextCursor: "one" })
    .mockResolvedValueOnce({ data: [], nextCursor: "two" })
    .mockRejectedValueOnce(new Error("offline"));
  await runtime.sessions.refresh();
  await expect(runtime.sessions.loadMore()).rejects.toThrow("offline");
  expect(runtime.sessions.getSnapshot().nextCursor).toBe("two");
  request.mockResolvedValueOnce({ data: [thread("b")], nextCursor: null });
  await runtime.sessions.loadMore();
  expect(request).toHaveBeenLastCalledWith(
    "thread/list",
    expect.objectContaining({ cursor: "two" }),
  );
});

it("bounds empty-page scanning and preserves a continuation for retry", async () => {
  const runtime = createRuntime();
  let page = 0;
  const request = vi
    .spyOn(runtime.connection.client, "request")
    .mockImplementation(async () => ({ data: [], nextCursor: String(++page) }));
  await runtime.sessions.refresh();
  await expect(runtime.sessions.loadMore()).rejects.toThrow("连续多页");
  expect(request).toHaveBeenCalledTimes(11);
  expect(runtime.sessions.getSnapshot()).toMatchObject({
    nextCursor: "11",
    loading: false,
  });
  request.mockResolvedValueOnce({ data: [], nextCursor: null });
  await runtime.sessions.loadMore();
  expect(runtime.sessions.getSnapshot().nextCursor).toBeNull();
});

it("keeps endpoint draft namespaces and restores prior edits", () => {
  const runtime = createRuntime();
  runtime.drafts.activateScope("ws://a");
  runtime.drafts.setText("same", "A");
  runtime.drafts.activateScope("ws://b");
  expect(runtime.drafts.get("same").text).toBe("");
  runtime.drafts.setText("same", "B");
  runtime.drafts.activateScope("ws://a");
  expect(runtime.drafts.get("same").text).toBe("A");
});
it("paginates model catalog and treats discovery failures as nonfatal", async () => {
  const connection = new ConnectionStore();
  vi.spyOn(connection.client, "connect").mockResolvedValue();
  const request = vi
    .spyOn(connection.client, "request")
    .mockImplementation((...[method, params]) => {
      if (method === "account/read")
        return Promise.resolve({ account: { type: "apiKey" } });
      return Promise.resolve({
        data: [{ id: "cursor" in (params as object) ? "b" : "a" }],
        nextCursor: "cursor" in (params as object) ? null : "next",
      });
    });
  await connection.connect("ws://a");
  expect(connection.getSnapshot().models.map((model) => model.id)).toEqual([
    "a",
    "b",
  ]);
  expect(connection.getSnapshot().account).toBe("API key");
  request.mockRejectedValue(new Error("discovery failed"));
  await expect(connection.connect("ws://b")).resolves.toBeUndefined();
  expect(connection.getSnapshot().error).toBe("discovery failed");
  expect(connection.getSnapshot().modelsError).toBe("discovery failed");
  expect(connection.getSnapshot().modelsLoading).toBe(false);
  request.mockResolvedValue({ data: [{ id: "recovered" }], nextCursor: null });
  const retry = connection.loadModels();
  expect(connection.getSnapshot().modelsLoading).toBe(true);
  expect(connection.getSnapshot().modelsError).toBeNull();
  await retry;
  expect(connection.getSnapshot().models.map((model) => model.id)).toEqual([
    "recovered",
  ]);
  expect(connection.getSnapshot().modelsLoading).toBe(false);
});
it("reduces indexed reasoning deltas and protects completed items from late starts", () => {
  let state = emptyState();
  state = reduceNotification(state, {
    method: "item/reasoning/summaryTextDelta",
    params: {
      threadId: "a",
      turnId: "t",
      itemId: "r",
      summaryIndex: 1,
      delta: "why",
    },
  });
  state = reduceNotification(state, {
    method: "item/reasoning/textDelta",
    params: {
      threadId: "a",
      turnId: "t",
      itemId: "r",
      contentIndex: 0,
      delta: "thought",
    },
  });
  const final = {
    type: "reasoning" as const,
    id: "r",
    summary: ["", "final"],
    content: ["complete"],
  };
  state = reduceNotification(state, {
    method: "item/completed",
    params: { completedAtMs: 0, threadId: "a", turnId: "t", item: final },
  });
  state = reduceNotification(state, {
    method: "item/started",
    params: {
      startedAtMs: 0,
      threadId: "a",
      turnId: "t",
      item: { type: "reasoning", id: "r", summary: [], content: [] },
    },
  });
  expect(state.threads.a.turns[0].items[0]).toEqual(final);
});

import { validApprovalResponse } from "../../src/features/requests/store";
it("validates approval union, advertised decisions and exact proposed amendments", () => {
  const request: Extract<
    RpcRequest,
    { method: "item/commandExecution/requestApproval" }
  > = {
    id: 1,
    method: "item/commandExecution/requestApproval",
    params: {
      kind: "command",
      threadId: "a",
      turnId: "t",
      itemId: "command",
      startedAtMs: 0,
      environmentId: null,
      proposedExecpolicyAmendment: ["git", "status"],
    },
  };
  expect(validApprovalResponse(request, { decision: "allow" })).toBe(false);
  expect(
    validApprovalResponse(request, {
      decision: {
        acceptWithExecpolicyAmendment: {
          execpolicy_amendment: ["git", "status"],
        },
      },
    }),
  ).toBe(true);
  expect(
    validApprovalResponse(request, {
      decision: {
        acceptWithExecpolicyAmendment: { execpolicy_amendment: ["git"] },
      },
    }),
  ).toBe(false);
  const restricted = {
    ...request,
    params: { ...request.params, availableDecisions: ["decline"] },
  };
  expect(validApprovalResponse(restricted, { decision: "accept" })).toBe(false);
  expect(validApprovalResponse(restricted, { decision: "decline" })).toBe(true);
});
it("does not revive requests resolved before they arrive", () => {
  const connection = new ConnectionStore();
  let receive!: (request: RpcRequest) => void;
  let notify!: (event: RpcNotification) => void;
  vi.spyOn(connection.client, "onRequest").mockImplementation((listener) => {
    receive = listener;
    return () => {};
  });
  vi.spyOn(connection.client, "onNotification").mockImplementation(
    (listener) => {
      notify = listener;
      return () => {};
    },
  );
  const requests = new RequestsStore(connection);
  notify({
    method: "serverRequest/resolved",
    params: { threadId: "a", requestId: 4 },
  });
  receive({
    id: 4,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "a" },
  } as RpcRequest);
  expect(requests.getSnapshot().pending).toEqual([]);
});
it("waits for pending resume and reuses it before deciding to steer", async () => {
  const runtime = createRuntime();
  const response = deferred<{ thread: Thread }>();
  const request = vi
    .spyOn(runtime.connection.client, "request")
    .mockImplementation((...[method]) =>
      method === "thread/resume" ? response.promise : Promise.resolve({}),
    );
  const first = runtime.sessions.activate("a");
  expect(runtime.sessions.activate("a")).toBe(first);
  const send = runtime.sessions.send("a", [
    { type: "text", text: "hello", text_elements: [] },
  ]);
  await Promise.resolve();
  await Promise.resolve();
  expect(request).toHaveBeenCalledTimes(1);
  const current = thread("a");
  current.turns = [
    {
      id: "t",
      rootTurnId: null,
      items: [],
      itemsView: "full",
      status: "inProgress",
      error: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
    },
  ];
  response.resolve({ thread: current });
  await send;
  expect(request).toHaveBeenLastCalledWith("turn/steer", {
    threadId: "a",
    expectedTurnId: "t",
    input: [{ type: "text", text: "hello", text_elements: [] }],
  });
});

it("deduplicates the entire draft send before capturing a newly edited revision", async () => {
  const runtime = createRuntime();
  const response = deferred<{ turn: Thread["turns"][number] }>();
  const request = vi
    .spyOn(runtime.connection.client, "request")
    .mockReturnValue(response.promise);
  request.mockResolvedValueOnce({ thread: thread("a") });
  await runtime.sessions.activate("a");
  request.mockClear();
  runtime.drafts.setText("a", "first draft");
  const first = runtime.sendDraft("a");
  await Promise.resolve();
  runtime.drafts.setText("a", "new unsent draft");
  const second = runtime.sendDraft("a");
  expect(second).toBe(first);
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(request).toHaveBeenCalledWith("turn/start", {
    threadId: "a",
    clientUserMessageId: expect.any(String),
    input: [{ type: "text", text: "first draft", text_elements: [] }],
  });
  response.resolve({
    turn: {
      id: "t",
      rootTurnId: null,
      items: [],
      itemsView: "full",
      status: "inProgress",
      error: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
    },
  });
  await Promise.all([first, second]);
  expect(runtime.drafts.get("a").text).toBe("new unsent draft");
  expect(request).toHaveBeenCalledTimes(1);
});

it("shows the first accepted message as the shared session title", async () => {
  const runtime = createRuntime();
  const current = thread("a");
  const request = vi.spyOn(runtime.connection.client, "request");
  request.mockResolvedValueOnce({ thread: current });
  await runtime.sessions.activate("a");
  request.mockResolvedValueOnce({
    turn: {
      id: "t",
      rootTurnId: null,
      items: [],
      itemsView: "full",
      status: "inProgress",
      error: null,
      startedAt: 100,
      completedAt: null,
      durationMs: null,
    },
  });
  await runtime.sessions.send("a", [
    { type: "text", text: "检查会话标题更新", text_elements: [] },
  ]);
  expect(runtime.sessions.getSnapshot().threads.a.preview).toBe(
    "检查会话标题更新",
  );
  request.mockResolvedValueOnce({});
  await runtime.sessions.rename("a", "自定义标题");
  request.mockResolvedValueOnce({});
  await runtime.sessions.send("a", [
    { type: "text", text: "继续", text_elements: [] },
  ]);
  expect(runtime.sessions.getSnapshot().threads.a.name).toBe("自定义标题");
  expect(runtime.sessions.getSnapshot().threads.a.preview).toBe(
    "检查会话标题更新",
  );
});
it("syncs completed-turn metadata without overwriting a concurrent rename or session time", async () => {
  const connection = new ConnectionStore();
  let notify!: (event: RpcNotification) => void;
  vi.spyOn(connection.client, "onNotification").mockImplementation(
    (listener) => {
      notify = listener;
      return () => {};
    },
  );
  const { SessionsStore } = await import("../../src/features/sessions/store");
  const sessions = new SessionsStore(connection);
  const request = vi.spyOn(connection.client, "request");
  request
    .mockResolvedValueOnce({ thread: { ...thread("a"), createdAt: 100 } })
    .mockResolvedValueOnce({ thread: { ...thread("a"), createdAt: 100 } });
  await sessions.open("a");
  const metadata = deferred<{ thread: Thread }>();
  request.mockReturnValueOnce(metadata.promise);
  notify({
    method: "turn/completed",
    params: {
      threadId: "a",
      turn: {
        id: "t",
        rootTurnId: null,
        items: [],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 100,
        completedAt: 150,
        durationMs: 50000,
      },
    },
  });
  expect(request).toHaveBeenLastCalledWith("thread/read", {
    threadId: "a",
    includeTurns: false,
  });
  request.mockResolvedValueOnce({});
  await sessions.rename("a", "用户标题");
  metadata.resolve({
    thread: {
      ...thread("a"),
      name: "服务端标题",
      preview: "首条消息",
      updatedAt: 9999,
    },
  });
  await Promise.resolve();
  expect(sessions.getSnapshot().threads.a.name).toBe("用户标题");
  expect(sessions.getSnapshot().threads.a.preview).toBe("首条消息");
  expect(sessions.getSnapshot().threads.a.updatedAt).toBe(150);
  const next = deferred<{ thread: Thread }>();
  request.mockReturnValueOnce(next.promise);
  notify({
    method: "turn/completed",
    params: { threadId: "a", turn: sessions.getSnapshot().threads.a.turns[0] },
  });
  next.resolve({ thread: { ...thread("a"), name: "最新标题" } });
  await Promise.resolve();
  expect(sessions.getSnapshot().threads.a.name).toBe("最新标题");
});
it("keeps the new-session title when the first send fails", async () => {
  const runtime = createRuntime();
  const request = vi.spyOn(runtime.connection.client, "request");
  request.mockResolvedValueOnce({ thread: thread("a") });
  await runtime.sessions.activate("a");
  request.mockRejectedValueOnce(new Error("send failed"));
  await expect(
    runtime.sessions.send("a", [
      { type: "text", text: "未发送", text_elements: [] },
    ]),
  ).rejects.toThrow("send failed");
  expect(runtime.sessions.getSnapshot().threads.a.preview).toBe("");
});

it("reads every page for export without resuming or changing session time", async () => {
  const runtime = createRuntime();
  const current = {
    ...thread("a"),
    historyMode: "paginated" as const,
    createdAt: 100,
    updatedAt: 100,
  };
  const request = vi.spyOn(runtime.connection.client, "request");
  request.mockResolvedValueOnce({ thread: current });
  await runtime.sessions.activate("a");
  const turn = {
    id: "t",
    rootTurnId: null,
    items: [],
    itemsView: "summary",
    status: "completed",
    error: null,
    startedAt: 100,
    completedAt: 150,
    durationMs: 50000,
  };
  const message = {
    type: "agentMessage",
    id: "m",
    text: "完整回复",
    phase: "final_answer",
    memoryCitation: null,
    delivery: null,
    questions: null,
  };
  request
    .mockResolvedValueOnce({ thread: { ...current, updatedAt: 9999 } })
    .mockResolvedValueOnce({ data: [turn], nextCursor: "next-turn" })
    .mockResolvedValueOnce({
      data: [{ ...turn, id: "t2", itemsView: "full" }],
      nextCursor: null,
    })
    .mockResolvedValueOnce({
      data: [{ item: message }],
      nextCursor: "next-item",
    })
    .mockResolvedValueOnce({
      data: [{ item: { ...message, id: "m2" } }],
      nextCursor: null,
    });
  const result = await runtime.sessions.readForExport("a");
  expect(result.turns.map((turn) => turn.id)).toEqual(["t", "t2"]);
  expect(result.turns[0].items.map((item) => item.id)).toEqual(["m", "m2"]);
  expect(result.turns[0].itemsView).toBe("full");
  expect(runtime.sessions.getSnapshot().threads.a.updatedAt).toBe(100);
  expect(
    request.mock.calls.filter(([method]) => method === "thread/resume"),
  ).toHaveLength(1);
  expect(request).toHaveBeenNthCalledWith(2, "thread/read", {
    threadId: "a",
    includeTurns: false,
  });
});

it("marks background completion unread, deduplicates notifications and clears it on opening", async () => {
  const connection = new ConnectionStore();
  let notify!: (event: RpcNotification) => void;
  vi.spyOn(connection.client, "onNotification").mockImplementation(
    (listener) => {
      notify = listener;
      return () => {};
    },
  );
  const { SessionsStore } = await import("../../src/features/sessions/store");
  const sessions = new SessionsStore(connection);
  vi.spyOn(connection.client, "request").mockImplementation(((
    method: string,
    params: { threadId: string },
  ) => Promise.resolve({ thread: thread(params.threadId) })) as never);
  await sessions.open("a");
  await sessions.open("b");
  const turn = {
    id: "completed-a",
    rootTurnId: null,
    items: [],
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: 100,
    completedAt: 150,
    durationMs: 50000,
  } as const;
  const event = {
    method: "turn/completed",
    params: { threadId: "a", turn: { ...turn, items: [] } },
  } as RpcNotification;
  notify(event);
  expect(sessions.getSnapshot().selectedId).toBe("b");
  expect(sessions.getSnapshot().unreadCompleted.a).toBe("completed-a");
  expect(sessions.getSnapshot().completionNotifications).toHaveLength(1);
  notify(event);
  expect(sessions.getSnapshot().completionNotifications).toHaveLength(1);
  sessions.dismissCompletion(
    sessions.getSnapshot().completionNotifications[0].id,
  );
  expect(sessions.getSnapshot().unreadCompleted.a).toBe("completed-a");
  await sessions.open("a");
  expect(sessions.getSnapshot().unreadCompleted.a).toBeUndefined();
  notify(event);
  expect(sessions.getSnapshot().completionNotifications).toHaveLength(0);
  notify({
    method: "turn/completed",
    params: { threadId: "a", turn: { ...turn, id: "current", items: [] } },
  });
  expect(sessions.getSnapshot().unreadCompleted).toEqual({});
  expect(sessions.getSnapshot().completionNotifications).toHaveLength(1);
  expect(sessions.getSnapshot().completionNotifications[0].threadId).toBe("a");
  sessions.dismissCompletion(
    sessions.getSnapshot().completionNotifications[0].id,
  );
  notify({
    method: "turn/completed",
    params: {
      threadId: "b",
      turn: { ...turn, id: "failed", status: "failed", items: [] },
    },
  });
  expect(sessions.getSnapshot().unreadCompleted).toEqual({});
  notify({
    method: "turn/completed",
    params: { threadId: "b", turn: { ...turn, id: "background-b", items: [] } },
  });
  expect(sessions.getSnapshot().unreadCompleted.b).toBe("background-b");
  await sessions.archive("b");
  expect(sessions.getSnapshot().unreadCompleted.b).toBeUndefined();
  expect(sessions.getSnapshot().completionNotifications).toHaveLength(0);
});

it("a selected thread in a background environment still emits completion notices", async () => {
  const connection = new ConnectionStore();
  let notify!: (event: RpcNotification) => void;
  vi.spyOn(connection.client, "onNotification").mockImplementation(
    (listener) => {
      notify = listener;
      return () => {};
    },
  );
  const { SessionsStore } = await import("../../src/features/sessions/store");
  const sessions = new SessionsStore(connection);
  vi.spyOn(connection.client, "request").mockResolvedValue({
    thread: thread("same"),
  });
  await sessions.open("same");
  sessions.setForeground(false);
  notify({
    method: "turn/completed",
    params: {
      threadId: "same",
      turn: {
        id: "background",
        rootTurnId: null,
        items: [],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1000,
      },
    },
  });
  expect(sessions.getSnapshot().unreadCompleted.same).toBe("background");
  expect(sessions.getSnapshot().completionNotifications).toHaveLength(1);
  sessions.setForeground(true);
  expect(sessions.getSnapshot().unreadCompleted.same).toBeUndefined();
});

it("views without acquiring a writer, preserves occupied viewing and requires explicit activation", async () => {
  vi.useFakeTimers();
  const runtime = createRuntime();
  const historical = {
    ...thread("external"),
    preview: "终端会话",
    createdAt: 100,
  };
  const request = vi
    .spyOn(runtime.connection.client, "request")
    .mockImplementation(((method: string, params: { threadId: string }) => {
      if (method === "thread/resume")
        return Promise.reject(
          new Error("thread external already has an active writer"),
        );
      return Promise.resolve({
        thread: { ...historical, id: params.threadId },
      });
    }) as never);
  try {
    await runtime.sessions.open("external");
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      "thread/read",
      "thread/read",
    ]);
    expect(runtime.sessions.getSnapshot().threadAccess.external).toBe(
      "viewing",
    );
    await runtime.sessions.activate("external");
    expect(runtime.sessions.getSnapshot().threadAccess.external).toBe(
      "occupied",
    );
    expect(runtime.sessions.getSnapshot().error).toBeNull();
    await runtime.sessions.open("external");
    expect(
      request.mock.calls.filter(([method]) => method === "thread/resume"),
    ).toHaveLength(1);
    await expect(
      runtime.sessions.send("external", [
        { type: "text", text: "不能发送", text_elements: [] },
      ]),
    ).rejects.toThrow("只能查看");
    await expect(runtime.sessions.interrupt("external")).rejects.toThrow(
      "无法停止",
    );
    const poll = deferred<{ thread: Thread }>();
    request.mockReturnValueOnce(poll.promise);
    await vi.advanceTimersByTimeAsync(10000);
    const count = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(request).toHaveBeenCalledTimes(count);
    request.mockResolvedValueOnce({
      thread: { ...historical, preview: "终端新输出" },
    });
    poll.resolve({ thread: { ...historical, preview: "终端新输出" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.sessions.getSnapshot().threads.external.preview).toBe(
      "终端新输出",
    );
    request.mockResolvedValue({ thread: historical });
    await runtime.sessions.activate("external");
    expect(runtime.sessions.getSnapshot().threadAccess.external).toBe(
      "editable",
    );
    expect(runtime.sessions.getSnapshot().threadAccess.external).toBe(
      "editable",
    );
  } finally {
    runtime.connection.disconnect();
    vi.useRealTimers();
  }
});

it("forks through the selected turn and selects the new thread while preserving the source", async () => {
  const runtime = createRuntime();
  const source = thread("source");
  const forked = thread("forked");
  const request = vi
    .spyOn(runtime.connection.client, "request")
    .mockResolvedValueOnce({ thread: source })
    .mockResolvedValueOnce({ thread: source })
    .mockResolvedValueOnce({ thread: forked });
  await runtime.sessions.open("source");
  await runtime.sessions.fork("source", "turn-b");
  expect(request).toHaveBeenLastCalledWith("thread/fork", {
    threadId: "source",
    lastTurnId: "turn-b",
  });
  expect(runtime.sessions.getSnapshot().selectedId).toBe("forked");
  expect(runtime.sessions.getSnapshot().threads.source).toEqual(source);
});

it("rejects rollback while the source thread is active without sending a fork request", async () => {
  const runtime = createRuntime();
  const source = thread("source");
  source.status = { type: "active", activeFlags: [] };
  const request = vi
    .spyOn(runtime.connection.client, "request")
    .mockResolvedValue({ thread: source });
  await runtime.sessions.open("source");
  request.mockClear();
  await expect(runtime.sessions.fork("source", "old-turn")).rejects.toThrow(
    "请等待当前会话执行结束",
  );
  expect(request).not.toHaveBeenCalled();
  expect(runtime.sessions.getSnapshot().selectedId).toBe("source");
});

function revertSource(): Thread {
  const source = thread("source");
  source.historyMode = "paginated";
  source.turns = ["a", "b", "c"].map((id) => ({
    id,
    rootTurnId: null,
    items: [],
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
  }));
  return source;
}
it("reverts in place before the selected turn and reloads retained paginated history", async () => {
  const runtime = createRuntime();
  const source = revertSource();
  const metadata = { ...source, turns: [] };
  const request = vi
    .spyOn(runtime.connection.client, "request")
    .mockResolvedValueOnce({ thread: source })
    .mockResolvedValueOnce({ thread: metadata })
    .mockResolvedValueOnce({ thread: metadata })
    .mockResolvedValueOnce({ data: [source.turns[0]], nextCursor: null });
  await runtime.sessions.fork("parent");
  await runtime.sessions.revert("source", "b");
  expect(request).toHaveBeenNthCalledWith(2, "thread/revert", {
    threadId: "source",
    beforeTurnId: "b",
  });
  expect(request).toHaveBeenNthCalledWith(3, "thread/read", {
    threadId: "source",
    includeTurns: false,
  });
  expect(runtime.sessions.getSnapshot().selectedId).toBe("source");
  expect(Object.keys(runtime.sessions.getSnapshot().threads)).toEqual([
    "source",
  ]);
  expect(
    runtime.sessions.getSnapshot().threads.source.turns.map((turn) => turn.id),
  ).toEqual(["a"]);
});
it("leaves history intact when revert fails", async () => {
  const runtime = createRuntime();
  const source = revertSource();
  const request = vi
    .spyOn(runtime.connection.client, "request")
    .mockResolvedValueOnce({ thread: source })
    .mockRejectedValueOnce(new Error("revert failed"));
  await runtime.sessions.activate("source");
  await expect(runtime.sessions.revert("source", "a")).rejects.toThrow(
    "revert failed",
  );
  expect(runtime.sessions.getSnapshot().threads.source.turns).toEqual(
    source.turns,
  );
  expect(request).toHaveBeenCalledTimes(2);
});
it("blocks revert for running and legacy threads", async () => {
  const runtime = createRuntime();
  const source = revertSource();
  source.status = { type: "active", activeFlags: [] };
  const request = vi
    .spyOn(runtime.connection.client, "request")
    .mockResolvedValue({ thread: source });
  await runtime.sessions.activate("source");
  request.mockClear();
  await expect(runtime.sessions.revert("source", "a")).rejects.toThrow(
    "请等待",
  );
  expect(request).not.toHaveBeenCalled();
  source.status = { type: "idle" };
  source.historyMode = "legacy";
  const snapshot = runtime.connection.getSnapshot();
  vi.spyOn(runtime.connection, "getSnapshot").mockReturnValue({
    ...snapshot,
    status: "connected",
  });
  await runtime.sessions.open("source");
  // Reopening a hydrated writer displays its cache; explicitly reconcile the
  // simulated external change before asserting the legacy guard.
  await runtime.sessions.restoreSelected();
  request.mockClear();
  await expect(runtime.sessions.revert("source", "a")).rejects.toThrow(
    "旧格式",
  );
  expect(request).not.toHaveBeenCalled();
});
