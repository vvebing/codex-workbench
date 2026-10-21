import { afterEach, expect, it, vi } from "vitest";
import { createRuntime } from "../../src/lib/runtime";
import { CodexClient, type RpcNotification } from "../../src/lib/rpc";
import { placeholderThread } from "../../src/lib/state";
import type { Thread } from "../../src/generated/v2/Thread";
import type { Turn } from "../../src/generated/v2/Turn";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
  vi.restoreAllMocks();
});
const thread = (id: string): Thread => ({
  ...placeholderThread(id),
  sessionId: id,
  cwd: "/real/workspace",
});
const turn = (): Turn => ({
  id: "first-turn",
  rootTurnId: null,
  items: [],
  itemsView: "full",
  status: "inProgress",
  error: null,
  startedAt: 100,
  completedAt: null,
  durationMs: null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const listeners: ((event: RpcNotification) => void)[] = [];
  vi.spyOn(CodexClient.prototype, "onNotification").mockImplementation(
    (listener) => {
      listeners.push(listener);
      return () => {};
    },
  );
  const runtime = createRuntime();
  cleanup.push(() => runtime.connection.disconnect());
  const request = vi.spyOn(runtime.connection.client, "request");
  return {
    runtime,
    request,
    notify(event: RpcNotification) {
      for (const listener of listeners) listener(event);
    },
  };
}

it("creates a local draft and reopens it without making server requests", async () => {
  const { runtime, request } = fixture();
  const draft = await runtime.sessions.create({
    cwd: "/draft/project",
    sandbox: "workspace-write",
  });
  runtime.drafts.setText(draft.id, "未发送内容");
  expect(draft.sessionId).toBe("");
  expect(runtime.sessions.getSnapshot().listIds).toEqual([]);
  expect(request).not.toHaveBeenCalled();
  request
    .mockResolvedValueOnce({ thread: thread("history") })
    .mockResolvedValueOnce({ thread: thread("history") });
  await runtime.sessions.open("history");
  const count = request.mock.calls.length;
  await runtime.sessions.open(draft.id);
  await runtime.sessions.restoreSelected();
  expect(request).toHaveBeenCalledTimes(count);
  expect(runtime.sessions.getSnapshot().selectedId).toBe(draft.id);
  expect(runtime.drafts.get(draft.id).text).toBe("未发送内容");
});

it("does not create an empty or whitespace-only draft on the server", async () => {
  const { runtime, request } = fixture();
  const draft = await runtime.sessions.create();
  await runtime.sendDraft(draft.id);
  runtime.drafts.setText(draft.id, "  ");
  await runtime.sendDraft(draft.id);
  expect(request).not.toHaveBeenCalled();
  expect(runtime.sessions.getSnapshot().localDrafts[draft.id]).toBeDefined();
});

it("creates on the first send, applies chosen options and promotes exactly once", async () => {
  const { runtime, request, notify } = fixture();
  const draft = await runtime.sessions.create({
    cwd: "/draft/project",
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
  });
  runtime.drafts.setText(draft.id, "第一条消息");
  request.mockImplementation(((method: string) => {
    if (method === "thread/start") {
      notify({ method: "thread/started", params: { thread: thread("real") } });
      expect(runtime.sessions.getSnapshot().listIds).toEqual([]);
      return Promise.resolve({ thread: thread("real") });
    }
    return Promise.resolve({ turn: turn() });
  }) as never);
  const first = runtime.sendDraft(draft.id, {
    model: "chosen",
    approvalPolicy: "never",
    effort: "high",
  });
  expect(runtime.sendDraft(draft.id)).toBe(first);
  await first;
  expect(request.mock.calls.map(([method]) => method)).toEqual([
    "thread/start",
    "turn/start",
  ]);
  expect(request).toHaveBeenNthCalledWith(1, "thread/start", {
    cwd: "/draft/project",
    sandbox: "workspace-write",
    approvalPolicy: "never",
    model: "chosen",
  });
  expect(request).toHaveBeenNthCalledWith(2, "turn/start", {
    threadId: "real",
    clientUserMessageId: expect.any(String),
    model: "chosen",
    approvalPolicy: "never",
    effort: "high",
    input: [{ type: "text", text: "第一条消息", text_elements: [] }],
  });
  expect(runtime.sessions.getSnapshot().selectedId).toBe("real");
  expect(runtime.sessions.getSnapshot().localDrafts).toEqual({});
  expect(runtime.sessions.getSnapshot().listIds).toEqual(["real"]);
  expect(runtime.sessions.getSnapshot().draftOrigins.real).toBe(draft.id);
  expect(runtime.drafts.get("real").text).toBe("");
  expect(runtime.sessions.resolveId(draft.id)).toBe("real");
});

it("moves the latest document, references and images without clearing edits made during creation", async () => {
  const { runtime, request } = fixture();
  const draft = await runtime.sessions.create();
  runtime.drafts.setText(draft.id, "提交的消息");
  const creation = deferred<{ thread: Thread }>();
  request.mockImplementation(((method: string) =>
    method === "thread/start"
      ? creation.promise
      : Promise.resolve({ turn: turn() })) as never);
  const pending = runtime.sendDraft(draft.id);
  await Promise.resolve();
  await Promise.resolve();
  const document = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "reference",
            attrs: { kind: "skill", name: "review", path: "/skills/review" },
          },
        ],
      },
    ],
  };
  runtime.drafts.setDocument(draft.id, document, "$review 后续草稿", [
    { name: "review", path: "/skills/review" },
  ]);
  runtime.drafts.addImage(draft.id, {
    id: "image",
    name: "preview.png",
    url: "data:image/png;base64,fixture",
  });
  const latest = runtime.drafts.get(draft.id);
  creation.resolve({ thread: thread("real") });
  await pending;
  expect(runtime.drafts.get("real")).toEqual(latest);
  expect(runtime.drafts.get(draft.id)).toEqual(latest);
  runtime.drafts.setText(draft.id, "异步回调仍写入正确的草稿");
  expect(runtime.drafts.get("real").text).toBe("异步回调仍写入正确的草稿");
  expect((request.mock.calls[1][1] as { input: unknown[] }).input).toEqual([
    { type: "text", text: "提交的消息", text_elements: [] },
  ]);
});

it("keeps the local draft if creation fails and creates only on a deliberate retry", async () => {
  const { runtime, request } = fixture();
  const draft = await runtime.sessions.create();
  runtime.drafts.setText(draft.id, "重试的内容");
  request.mockRejectedValueOnce(new Error("creation failed"));
  await expect(runtime.sendDraft(draft.id)).rejects.toThrow("creation failed");
  expect(
    runtime.sessions.getSnapshot().localDrafts[draft.id].serverId,
  ).toBeUndefined();
  expect(runtime.drafts.get(draft.id).text).toBe("");
  const [message] = runtime.submissions.messages.forThread(draft.id);
  expect(message.input).toContainEqual({
    type: "text",
    text: "重试的内容",
    text_elements: [],
  });
  await runtime.sessions.open(draft.id);
  expect(request).toHaveBeenCalledTimes(1);
  request
    .mockResolvedValueOnce({ thread: thread("real") })
    .mockResolvedValueOnce({ turn: turn() });
  runtime.submissions.restoreMessage(message.id);
  await runtime.sendDraft(draft.id);
  expect(request.mock.calls.map(([method]) => method)).toEqual([
    "thread/start",
    "thread/start",
    "turn/start",
  ]);
});

it("reuses the created ID after the first send fails and never reads the empty server thread on reopen", async () => {
  const { runtime, request } = fixture();
  const draft = await runtime.sessions.create();
  runtime.drafts.setText(draft.id, "不会丢失");
  request
    .mockResolvedValueOnce({ thread: thread("real") })
    .mockRejectedValueOnce(new Error("send failed"));
  await expect(runtime.sendDraft(draft.id)).rejects.toThrow("send failed");
  expect(runtime.sessions.getSnapshot().selectedId).toBe(draft.id);
  expect(runtime.sessions.getSnapshot().localDrafts[draft.id].serverId).toBe(
    "real",
  );
  expect(runtime.sessions.getSnapshot().listIds).toEqual([]);
  expect(runtime.drafts.get(draft.id).text).toBe("");
  const [message] = runtime.submissions.messages.forThread(draft.id);
  expect(message.input).toContainEqual({
    type: "text",
    text: "不会丢失",
    text_elements: [],
  });
  await runtime.sessions.open(draft.id);
  await runtime.sessions.restoreSelected();
  expect(request).toHaveBeenCalledTimes(2);
  request.mockResolvedValueOnce({
    data: [thread("real"), thread("other")],
    nextCursor: null,
  });
  await runtime.sessions.refresh();
  expect(runtime.sessions.getSnapshot().listIds).toEqual(["other"]);
  request.mockResolvedValueOnce({ turn: turn() });
  runtime.submissions.restoreMessage(message.id);
  await runtime.sendDraft(draft.id);
  expect(
    request.mock.calls.filter(([method]) => method === "thread/start"),
  ).toHaveLength(1);
  expect(request).toHaveBeenLastCalledWith("turn/start", {
    threadId: "real",
    clientUserMessageId: expect.any(String),
    input: [{ type: "text", text: "不会丢失", text_elements: [] }],
  });
  expect(runtime.sessions.getSnapshot().selectedId).toBe("real");
});

it("does not change the current selection when a background draft finishes sending", async () => {
  const { runtime, request } = fixture();
  const draft = await runtime.sessions.create();
  runtime.drafts.setText(draft.id, "后台发送");
  const response = deferred<{ turn: Turn }>();
  request.mockImplementation(((method: string) =>
    Promise.resolve(
      method === "thread/start"
        ? { thread: thread("real") }
        : { thread: thread("other") },
    )) as never);
  request
    .mockImplementationOnce(() => Promise.resolve({ thread: thread("real") }))
    .mockImplementationOnce(() => response.promise);
  const pending = runtime.sendDraft(draft.id);
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  await runtime.sessions.open("other");
  response.resolve({ turn: turn() });
  await pending;
  expect(runtime.sessions.getSnapshot().selectedId).toBe("other");
  expect(runtime.sessions.getSnapshot().listIds).toContain("real");
  expect(runtime.drafts.get("real").text).toBe("");
});

it("keeps both the draft and its known ID if the connection changes during the first send", async () => {
  const { runtime, request } = fixture();
  const draft = await runtime.sessions.create();
  runtime.drafts.setText(draft.id, "保留的内容");
  const response = deferred<{ turn: Turn }>();
  request
    .mockResolvedValueOnce({ thread: thread("real") })
    .mockReturnValueOnce(response.promise);
  const pending = runtime.sendDraft(draft.id);
  const rejection = expect(pending).rejects.toThrow("连接已改变");
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  runtime.connection.disconnect();
  response.resolve({ turn: turn() });
  await rejection;
  expect(runtime.sessions.getSnapshot().localDrafts[draft.id].serverId).toBe(
    "real",
  );
  expect(runtime.drafts.get(draft.id).text).toBe("");
  const [message] = runtime.submissions.messages.forThread(draft.id);
  expect(message.input).toContainEqual({
    type: "text",
    text: "保留的内容",
    text_elements: [],
  });
});

it("does not promote a draft when the connection changes between acknowledgement and promotion", async () => {
  const { runtime, request } = fixture();
  const draft = await runtime.sessions.create();
  runtime.drafts.setText(draft.id, "保留已确认但尚未迁移的内容");
  request
    .mockResolvedValueOnce({ thread: thread("real") })
    .mockResolvedValueOnce({ turn: turn() });
  let scheduled = false;
  const unsubscribe = runtime.sessions.subscribe(() => {
    if (scheduled || !runtime.sessions.getSnapshot().threads.real?.turns.length)
      return;
    scheduled = true;
    queueMicrotask(() => runtime.connection.disconnect());
  });
  await expect(runtime.sendDraft(draft.id)).rejects.toThrow("连接已改变");
  unsubscribe();
  expect(runtime.sessions.getSnapshot().localDrafts[draft.id]?.serverId).toBe(
    "real",
  );
  expect(runtime.drafts.get(draft.id).text).toBe("");
  const [message] = runtime.submissions.messages.forThread(draft.id);
  expect(message.input).toContainEqual({
    type: "text",
    text: "保留已确认但尚未迁移的内容",
    text_elements: [],
  });
  expect(runtime.submissions.getSnapshot()).toEqual({});
});

it("renames and deletes unsent drafts locally and rejects server-only operations", async () => {
  const { runtime, request } = fixture();
  const draft = await runtime.sessions.create();
  runtime.drafts.setText(draft.id, "即将删除");
  await runtime.sessions.rename(draft.id, "我的草稿");
  expect(runtime.sessions.getSnapshot().threads[draft.id].name).toBe(
    "我的草稿",
  );
  await expect(runtime.sessions.activate(draft.id)).rejects.toThrow(
    "第一条消息",
  );
  await expect(runtime.sessions.fork(draft.id)).rejects.toThrow("尚未发送");
  await expect(runtime.sessions.readForExport(draft.id)).rejects.toThrow(
    "尚未发送",
  );
  runtime.discardDraft(draft.id);
  expect(runtime.sessions.getSnapshot().localDrafts).toEqual({});
  expect(runtime.drafts.get(draft.id).text).toBe("");
  expect(request).not.toHaveBeenCalled();
});

it("applies a local title after creation without inventing a server session for rename", async () => {
  const { runtime, request } = fixture();
  const draft = await runtime.sessions.create();
  await runtime.sessions.rename(draft.id, "本地标题");
  expect(request).not.toHaveBeenCalled();
  runtime.drafts.setText(draft.id, "真正发送");
  request
    .mockResolvedValueOnce({ thread: thread("real") })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ turn: turn() });
  await runtime.sendDraft(draft.id);
  expect(request.mock.calls.map(([method]) => method)).toEqual([
    "thread/start",
    "thread/name/set",
    "turn/start",
  ]);
  expect(runtime.sessions.getSnapshot().threads.real.name).toBe("本地标题");
});

it("recreates an unsent bound draft only after the server confirms its old empty thread is missing", async () => {
  const { runtime, request } = fixture();
  const draft = await runtime.sessions.create();
  runtime.drafts.setText(draft.id, "恢复这条消息");
  request
    .mockResolvedValueOnce({ thread: thread("old-empty") })
    .mockRejectedValueOnce(new Error("send failed"));
  await expect(runtime.sendDraft(draft.id)).rejects.toThrow("send failed");
  runtime.connection.disconnect();
  await runtime.sessions.open(draft.id);
  expect(request).toHaveBeenCalledTimes(2);
  request
    .mockRejectedValueOnce(new Error("thread old-empty not found"))
    .mockResolvedValueOnce({ thread: thread("new") })
    .mockResolvedValueOnce({ turn: turn() });
  const [message] = runtime.submissions.messages.forThread(draft.id);
  runtime.submissions.restoreMessage(message.id);
  await runtime.sendDraft(draft.id);
  expect(request.mock.calls.map(([method]) => method)).toEqual([
    "thread/start",
    "turn/start",
    "thread/resume",
    "thread/start",
    "turn/start",
  ]);
  expect(runtime.sessions.getSnapshot().selectedId).toBe("new");
  expect(runtime.sessions.getSnapshot().error).toBeNull();
});

it("cannot discard a promoted real thread through its old local draft ID", async () => {
  const { runtime, request } = fixture();
  const draft = await runtime.sessions.create();
  runtime.drafts.setText(draft.id, "首次发送");
  request
    .mockResolvedValueOnce({ thread: thread("real") })
    .mockResolvedValueOnce({ turn: turn() });
  await runtime.sendDraft(draft.id);
  runtime.drafts.setText("real", "后续未发送草稿");
  runtime.discardDraft(draft.id);
  expect(runtime.drafts.get("real").text).toBe("后续未发送草稿");
  expect(runtime.sessions.getSnapshot().threads.real).toBeDefined();
});

it("discarding a draft never removes a turn already observed on the server", async () => {
  const { runtime, request, notify } = fixture();
  const draft = await runtime.sessions.create();
  runtime.drafts.setText(draft.id, "已观察到发送但响应中断");
  const response = deferred<{ turn: Turn }>();
  request
    .mockResolvedValueOnce({ thread: thread("real") })
    .mockReturnValueOnce(response.promise);
  const pending = runtime.sendDraft(draft.id);
  const rejection = expect(pending).rejects.toThrow("连接已改变");
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  notify({
    method: "turn/started",
    params: { threadId: "real", turn: turn() },
  });
  runtime.connection.disconnect();
  response.resolve({ turn: turn() });
  await rejection;
  runtime.discardDraft(draft.id);
  expect(runtime.sessions.getSnapshot().localDrafts[draft.id]).toBeUndefined();
  expect(runtime.sessions.getSnapshot().threads.real.turns).toHaveLength(1);
  expect(runtime.sessions.getSnapshot().listIds).toContain("real");
  expect(request.mock.calls.map(([method]) => method)).toEqual([
    "thread/start",
    "turn/start",
  ]);
});

it("clears the first message before creation resolves and keeps later edits through acknowledgement", async () => {
  const { runtime, request } = fixture();
  const draft = await runtime.sessions.create();
  runtime.drafts.setText(draft.id, "first message");
  const creation = deferred<{ thread: Thread }>();
  const sending = deferred<{ turn: Turn }>();
  request
    .mockReturnValueOnce(creation.promise)
    .mockReturnValueOnce(sending.promise);
  const pending = runtime.sendDraft(draft.id);
  expect(runtime.drafts.get(draft.id).text).toBe("");
  expect(runtime.submissions.messages.forThread(draft.id)[0].status).toBe(
    "creating",
  );
  runtime.drafts.setText(draft.id, "next message");
  creation.resolve({ thread: thread("real") });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(runtime.submissions.messages.forThread(draft.id)[0].status).toBe(
    "sending",
  );
  expect(runtime.drafts.get(draft.id).text).toBe("next message");
  sending.resolve({ turn: turn() });
  await pending;
  expect(runtime.drafts.get("real").text).toBe("next message");
});
