import { afterEach, expect, it, vi } from "vitest";
import { ConnectionStore } from "../../src/features/connection/store";
import { SessionsStore } from "../../src/features/sessions/store";
import { createRuntime } from "../../src/lib/runtime";
import { emptyState, reduceNotification } from "../../src/lib/state";
import type { Thread } from "../../src/generated/v2/Thread";
import type { RpcNotification } from "../../src/lib/rpc";

const thread = (id: string): Thread =>
  reduceNotification(emptyState(), {
    method: "thread/status/changed",
    params: { threadId: id, status: { type: "idle" } },
  }).threads[id];
function fixture() {
  vi.useFakeTimers();
  const connection = new ConnectionStore();
  let state = connection.getSnapshot();
  vi.spyOn(connection, "getSnapshot").mockImplementation(() => state);
  let changed!: () => void;
  vi.spyOn(connection, "subscribe").mockImplementation((listener) => {
    changed = listener;
    return () => {};
  });
  let notify!: (event: RpcNotification) => void;
  vi.spyOn(connection.client, "onNotification").mockImplementation(
    (listener) => {
      notify = listener;
      return () => {};
    },
  );
  const sessions = new SessionsStore(connection);
  const request = vi.spyOn(connection.client, "request");
  return {
    sessions,
    request,
    notify,
    connect() {
      state = { ...state, status: "connected" };
      changed();
    },
    changeEnvironment() {
      state = {
        ...state,
        scope: state.scope + 1,
        epoch: state.epoch + 1,
        status: "disconnected",
      };
      changed();
    },
    disconnect() {
      state = { ...state, status: "disconnected", epoch: state.epoch + 1 };
      changed();
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("discovers external activity without changing selection, pagination or action loading", async () => {
  const f = fixture();
  f.request.mockResolvedValueOnce({
    data: [thread("old")],
    nextCursor: "saved",
  });
  await f.sessions.refresh();
  f.connect();
  f.request.mockResolvedValueOnce({
    data: [
      { ...thread("external"), status: { type: "active", activeFlags: [] } },
      thread("old"),
    ],
    nextCursor: null,
  });
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.sessions.getSnapshot()).toMatchObject({
    selectedId: null,
    nextCursor: "saved",
    loading: false,
  });
  expect(f.sessions.getSnapshot().listIds).toEqual(["external", "old"]);
  expect(f.sessions.getSnapshot().threads.external.status.type).toBe("active");
  f.request.mockResolvedValueOnce({
    data: [thread("external"), thread("old")],
    nextCursor: null,
  });
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.sessions.getSnapshot().threads.external.status.type).toBe("idle");
  expect(
    f.request.mock.calls.every(([method]) => method === "thread/list"),
  ).toBe(true);
  f.disconnect();
  const count = f.request.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(f.request).toHaveBeenCalledTimes(count);
});

it("does not overlap discovery and keeps newer notifications over delayed snapshots", async () => {
  const f = fixture();
  f.request.mockResolvedValueOnce({
    data: [thread("external")],
    nextCursor: null,
  });
  await f.sessions.refresh();
  let resolve!: (value: { data: Thread[]; nextCursor: null }) => void;
  f.request.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  f.connect();
  await vi.advanceTimersByTimeAsync(5000);
  await vi.advanceTimersByTimeAsync(30000);
  expect(f.request).toHaveBeenCalledTimes(2);
  f.notify({
    method: "thread/status/changed",
    params: {
      threadId: "external",
      status: { type: "active", activeFlags: [] },
    },
  });
  resolve({ data: [thread("external")], nextCursor: null });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.sessions.getSnapshot().threads.external.status.type).toBe("active");
  f.disconnect();
});

it("retries discovery errors and ignores responses from disconnected environments", async () => {
  const f = fixture();
  f.request.mockRejectedValueOnce(new Error("offline"));
  f.connect();
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.sessions.getSnapshot().error).toBeNull();
  let resolve!: (value: { data: Thread[]; nextCursor: null }) => void;
  f.request.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await vi.advanceTimersByTimeAsync(5000);
  f.disconnect();
  resolve({ data: [thread("stale")], nextCursor: null });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.sessions.getSnapshot().listIds).toEqual([]);
});

it("opens for viewing and ignores repeated selection without enabling writes", async () => {
  const f = fixture();
  f.request.mockResolvedValue({ thread: thread("view") });
  await f.sessions.open("view");
  await f.sessions.open("view");
  expect(f.request.mock.calls.map(([method]) => method)).toEqual([
    "thread/read",
    "thread/read",
  ]);
  expect(f.request).toHaveBeenNthCalledWith(1, "thread/read", {
    threadId: "view",
    includeTurns: false,
  });
  expect(f.request).toHaveBeenNthCalledWith(2, "thread/read", {
    threadId: "view",
    includeTurns: true,
  });
  expect(f.sessions.getSnapshot().threadAccess.view).toBe("viewing");
  await expect(f.sessions.interrupt("view")).rejects.toThrow("无法停止");
  f.disconnect();
});

it("shows cached history immediately and refreshes changed history in the background", async () => {
  const f = fixture();
  f.connect();
  const cached = { ...thread("cached"), preview: "original", updatedAt: 1 };
  f.request.mockResolvedValue({ thread: cached });
  await f.sessions.open("cached");
  f.sessions.clearSelection();
  let resolve!: (value: { thread: Thread }) => void;
  f.request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await f.sessions.open("cached");
  expect(f.sessions.getSnapshot()).toMatchObject({
    selectedId: "cached",
    openingId: null,
    loading: false,
    threads: { cached: { preview: "original" } },
  });
  const updated = { ...cached, preview: "updated", updatedAt: 2 };
  f.request.mockResolvedValue({ thread: updated });
  resolve({ thread: updated });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.sessions.getSnapshot().threads.cached.preview).toBe("updated");
  expect(
    f.request.mock.calls.some(([method]) => method === "thread/resume"),
  ).toBe(false);
  f.disconnect();
});

it("checks only metadata for unchanged cached history and preserves loaded turns", async () => {
  const f = fixture();
  f.connect();
  const cached: Thread = {
    ...thread("cached"),
    turns: [
      {
        id: "saved-turn",
        rootTurnId: null,
        items: [],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1000,
      },
    ],
  };
  f.request.mockResolvedValue({ thread: cached });
  await f.sessions.open("cached");
  f.sessions.clearSelection();
  f.request.mockClear();
  f.request.mockResolvedValue({ thread: { ...cached, turns: [] } });
  await f.sessions.open("cached");
  await vi.advanceTimersByTimeAsync(0);
  expect(f.request).toHaveBeenCalledExactlyOnceWith("thread/read", {
    threadId: "cached",
    includeTurns: false,
  });
  expect(f.sessions.getSnapshot().threads.cached.turns).toEqual(cached.turns);
  f.disconnect();
});

it.each([false, true])(
  "keeps cached history readable on refresh failure (navigated away: %s)",
  async (leave) => {
    const f = fixture();
    f.connect();
    f.request.mockResolvedValue({ thread: thread("cached") });
    await f.sessions.open("cached");
    f.sessions.clearSelection();
    let reject!: (error: Error) => void;
    f.request.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    await f.sessions.open("cached");
    if (leave) await f.sessions.create({ cwd: "/other" });
    const selectedId = f.sessions.getSnapshot().selectedId;
    reject(new Error("remote unavailable"));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.sessions.getSnapshot()).toMatchObject({
      selectedId,
      openingId: null,
      error: null,
      historySyncError: leave ? null : "remote unavailable",
    });
    expect(f.sessions.getSnapshot().threads.cached).toBeDefined();
    f.disconnect();
  },
);

it("deduplicates explicit activation and grants editing only after success", async () => {
  const f = fixture();
  f.request
    .mockResolvedValueOnce({ thread: thread("view") })
    .mockResolvedValueOnce({ thread: thread("view") });
  await f.sessions.open("view");
  let resolve!: (value: { thread: Thread }) => void;
  f.request.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const first = f.sessions.activate("view");
  expect(f.sessions.activate("view")).toBe(first);
  await Promise.resolve();
  expect(f.sessions.getSnapshot().threadAccess.view).toBe("activating");
  expect(f.sessions.getSnapshot().threadAccess.view).not.toBe("editable");
  resolve({ thread: thread("view") });
  await first;
  expect(f.sessions.getSnapshot().threadAccess.view).toBe("editable");
  const count = f.request.mock.calls.length;
  await f.sessions.activate("view");
  expect(f.request).toHaveBeenCalledTimes(count);
  f.disconnect();
});

it("keeps occupied threads readable without retrying resume on open or reconnect", async () => {
  const f = fixture();
  f.request.mockResolvedValue({ thread: thread("external") });
  await f.sessions.open("external");
  f.request.mockRejectedValueOnce(
    new Error("thread already has an active writer"),
  );
  await f.sessions.activate("external");
  expect(f.sessions.getSnapshot().threadAccess.external).toBe("occupied");
  await f.sessions.open("external");
  expect(f.sessions.getSnapshot().threadAccess.external).toBe("occupied");
  f.disconnect();
  await f.sessions.restoreSelected();
  expect(
    f.request.mock.calls.filter(([method]) => method === "thread/resume"),
  ).toHaveLength(1);
  expect(f.sessions.getSnapshot().threadAccess.external).toBe("viewing");
  await f.sessions.activate("external");
  expect(f.sessions.getSnapshot().threadAccess.external).toBe("editable");
});

it("revokes editing on disconnect and restores only the selected history", async () => {
  const f = fixture();
  const history = { ...thread("selected"), preview: "saved" };
  f.request.mockResolvedValue({ thread: history });
  await f.sessions.open("selected");
  await f.sessions.activate("selected");
  await f.sessions.activate("background");
  f.disconnect();
  expect(f.sessions.getSnapshot().threadAccess.selected).toBe("viewing");
  expect(f.sessions.getSnapshot().threadAccess.background).toBe("viewing");
  f.request.mockClear();
  await f.sessions.restoreSelected();
  expect(
    f.request.mock.calls.every(
      ([method, params]) =>
        method === "thread/read" &&
        (params as { threadId: string }).threadId === "selected",
    ),
  ).toBe(true);
  expect(f.sessions.getSnapshot().threadAccess.selected).toBe("viewing");
  f.disconnect();
});

it("confirmed editing is invalidated by server closure and environment changes", async () => {
  const f = fixture();
  f.request.mockResolvedValue({ thread: thread("created") });
  await f.sessions.activate("created");
  expect(f.sessions.getSnapshot().threadAccess.created).toBe("editable");
  f.notify({ method: "thread/closed", params: { threadId: "created" } });
  expect(f.sessions.getSnapshot().threadAccess.created).toBe("viewing");
  f.changeEnvironment();
  expect(f.sessions.getSnapshot().threadAccess).toEqual({});
});

it("slows discovery in hidden pages and background environments", async () => {
  const f = fixture();
  f.request.mockResolvedValue({ data: [], nextCursor: null });
  f.sessions.setPageVisible(false);
  f.connect();
  await vi.advanceTimersByTimeAsync(59000);
  expect(f.request).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.request).toHaveBeenCalledTimes(1);
  f.sessions.setPageVisible(true);
  f.sessions.setForeground(false);
  await vi.advanceTimersByTimeAsync(29000);
  expect(f.request).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.request).toHaveBeenCalledTimes(2);
  f.disconnect();
});

it("incrementally reads only recent turns when a viewing paginated thread changes", async () => {
  const f = fixture();
  const oldTurn = {
    id: "anchor",
    rootTurnId: null,
    items: [],
    itemsView: "full" as const,
    status: "completed" as const,
    error: null,
    startedAt: 10,
    completedAt: 20,
    durationMs: 10000,
  };
  const metadata = {
    ...thread("paginated"),
    historyMode: "paginated" as const,
    status: { type: "active" as const, activeFlags: [] },
    updatedAt: 30,
  };
  f.request.mockResolvedValueOnce({ thread: metadata }).mockResolvedValueOnce({
    data: [oldTurn, { ...oldTurn, id: "old-2" }, { ...oldTurn, id: "old-1" }],
    nextCursor: null,
  });
  await f.sessions.open("paginated");
  expect(f.request.mock.calls.map(([method]) => method)).toEqual([
    "thread/read",
    "thread/turns/list",
  ]);
  f.request.mockClear();
  const newTurn = { ...oldTurn, id: "new", startedAt: 30, completedAt: 40 };
  f.request.mockResolvedValueOnce({ thread: metadata }).mockResolvedValueOnce({
    data: [newTurn, oldTurn],
    nextCursor: "older-history",
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.request).toHaveBeenCalledTimes(2);
  expect(f.request).toHaveBeenLastCalledWith("thread/turns/list", {
    threadId: "paginated",
    limit: 50,
    sortDirection: "desc",
    itemsView: "full",
    cursor: null,
  });
  expect(
    f.sessions.getSnapshot().threads.paginated.turns.map((turn) => turn.id),
  ).toEqual(["old-1", "old-2", "anchor", "new"]);
  f.disconnect();
});

it("automatically activates on send and waits for the writer confirmation", async () => {
  const f = fixture();
  f.request
    .mockResolvedValueOnce({ thread: thread("view") })
    .mockResolvedValueOnce({ thread: thread("view") });
  await f.sessions.open("view");
  const turn = {
    id: "t",
    rootTurnId: null,
    items: [],
    itemsView: "full" as const,
    status: "inProgress" as const,
    error: null,
    startedAt: 10,
    completedAt: null,
    durationMs: null,
  };
  f.request
    .mockResolvedValueOnce({ thread: thread("view") })
    .mockResolvedValueOnce({ turn });
  await f.sessions.send("view", [
    { type: "text", text: "自动激活", text_elements: [] },
  ]);
  expect(f.request.mock.calls.map(([method]) => method)).toEqual([
    "thread/read",
    "thread/read",
    "thread/resume",
    "turn/start",
  ]);
  expect(f.sessions.getSnapshot().threadAccess.view).toBe("editable");
  f.disconnect();
});

it("writer conflicts stop the send without replaying it", async () => {
  const f = fixture();
  f.request
    .mockResolvedValueOnce({ thread: thread("view") })
    .mockResolvedValueOnce({ thread: thread("view") });
  await f.sessions.open("view");
  f.request.mockRejectedValueOnce(
    new Error("thread already has an active writer"),
  );
  await expect(
    f.sessions.send("view", [
      { type: "text", text: "保留草稿", text_elements: [] },
    ]),
  ).rejects.toThrow("草稿已保留");
  expect(f.request.mock.calls.map(([method]) => method)).toEqual([
    "thread/read",
    "thread/read",
    "thread/resume",
  ]);
  expect(f.sessions.getSnapshot().threadAccess.view).toBe("occupied");
  f.disconnect();
});

it("preserves edited drafts while the first send is waiting for automatic activation", async () => {
  const runtime = createRuntime();
  let resolve!: (value: { thread: Thread }) => void;
  const activation = new Promise<{ thread: Thread }>((done) => {
    resolve = done;
  });
  const turn = {
    id: "t",
    rootTurnId: null,
    items: [],
    itemsView: "full" as const,
    status: "inProgress" as const,
    error: null,
    startedAt: 10,
    completedAt: null,
    durationMs: null,
  };
  const request = vi
    .spyOn(runtime.connection.client, "request")
    .mockImplementation(((method: string) =>
      method === "thread/resume"
        ? activation
        : Promise.resolve({ turn })) as never);
  runtime.drafts.setText("draft", "第一份消息");
  const first = runtime.sendDraft("draft");
  await Promise.resolve();
  await Promise.resolve();
  runtime.drafts.setText("draft", "后续未发送草稿");
  const duplicate = runtime.sendDraft("draft");
  expect(duplicate).toBe(first);
  resolve({ thread: thread("draft") });
  await first;
  expect(request.mock.calls.map(([method]) => method)).toEqual([
    "thread/resume",
    "turn/start",
  ]);
  expect(request).toHaveBeenLastCalledWith("turn/start", {
    threadId: "draft",
    clientUserMessageId: expect.any(String),
    input: [{ type: "text", text: "第一份消息", text_elements: [] }],
  });
  expect(runtime.drafts.get("draft").text).toBe("后续未发送草稿");
});

it("keeps submitted content recoverable without replay when activation finds another writer", async () => {
  const runtime = createRuntime();
  const request = vi
    .spyOn(runtime.connection.client, "request")
    .mockRejectedValue(new Error("thread already has an active writer"));
  runtime.drafts.setText("draft", "保留的消息");
  await expect(runtime.sendDraft("draft")).rejects.toThrow("草稿已保留");
  expect(runtime.drafts.get("draft").text).toBe("");
  expect(runtime.submissions.messages.forThread("draft")[0].draft?.text).toBe(
    "保留的消息",
  );
  expect(runtime.sessions.getSnapshot().threadAccess.draft).toBe("occupied");
  expect(request.mock.calls.map(([method]) => method)).toEqual([
    "thread/resume",
  ]);
});

it("does not reload full history for an unchanged empty viewing thread", async () => {
  const f = fixture();
  f.request.mockResolvedValue({ thread: thread("empty") });
  await f.sessions.open("empty");
  f.request.mockClear();
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.request).toHaveBeenCalledWith("thread/read", {
    threadId: "empty",
    includeTurns: false,
  });
  f.disconnect();
});

it("revokes editing if a write reports that the writer capability was lost", async () => {
  const f = fixture();
  f.request.mockResolvedValueOnce({ thread: thread("lost") });
  await f.sessions.activate("lost");
  f.request.mockRejectedValueOnce(new Error("thread not loaded"));
  await expect(
    f.sessions.send("lost", [
      { type: "text", text: "不重放", text_elements: [] },
    ]),
  ).rejects.toThrow("not loaded");
  expect(f.sessions.getSnapshot().threadAccess.lost).toBe("viewing");
  expect(f.request.mock.calls.map(([method]) => method)).toEqual([
    "thread/resume",
    "turn/start",
  ]);
  f.disconnect();
});

it("keeps a pending writer confirmation revoked after server closure", async () => {
  const f = fixture();
  let resolve!: (value: { thread: Thread }) => void;
  f.request.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const activation = f.sessions.activate("closed");
  await Promise.resolve();
  f.notify({ method: "thread/closed", params: { threadId: "closed" } });
  resolve({ thread: thread("closed") });
  await activation;
  expect(f.sessions.getSnapshot().threadAccess.closed).toBe("viewing");
  await expect(f.sessions.interrupt("closed")).rejects.toThrow("无法停止");
  f.disconnect();
});

it.each(["reconnect", "closure"])(
  "checks writer and connection again after a draft rename: %s",
  async (change) => {
    const f = fixture();
    const draft = await f.sessions.create();
    await f.sessions.rename(draft.id, "草稿标题");
    let renamed!: () => void;
    const rename = new Promise<void>((resolve) => {
      renamed = resolve;
    });
    f.request.mockImplementation((async (method: string) => {
      if (method === "thread/name/set") return rename;
      return { thread: thread("real") };
    }) as never);
    const sending = f.sessions.send(draft.id, [
      { type: "text", text: "保留", text_elements: [] },
    ]);
    for (let tick = 0; tick < 8; tick++) await Promise.resolve();
    expect(f.request).toHaveBeenCalledWith("thread/name/set", {
      threadId: "real",
      name: "草稿标题",
    });
    if (change === "reconnect") {
      f.disconnect();
      f.connect();
      await f.sessions.activate("real");
    } else {
      f.notify({ method: "thread/closed", params: { threadId: "real" } });
    }
    const rejected =
      expect(sending).rejects.toThrow(/连接已改变|写入权限已失效/);
    renamed();
    await rejected;
    expect(
      f.request.mock.calls.some(([method]) => method.startsWith("turn/")),
    ).toBe(false);
    expect(f.sessions.getSnapshot().localDrafts[draft.id].serverId).toBe(
      "real",
    );
    f.disconnect();
  },
);

it("keeps the newly selected history polling when an older poll finishes", async () => {
  const f = fixture();
  f.request
    .mockResolvedValueOnce({ thread: thread("a") })
    .mockResolvedValueOnce({ thread: thread("a") });
  await f.sessions.open("a");
  let resolve!: (value: { thread: Thread }) => void;
  f.request.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await vi.advanceTimersByTimeAsync(10000);
  f.request
    .mockResolvedValueOnce({ thread: thread("b") })
    .mockResolvedValueOnce({ thread: thread("b") });
  await f.sessions.open("b");
  resolve({ thread: thread("a") });
  await vi.advanceTimersByTimeAsync(0);
  f.request.mockResolvedValueOnce({ thread: thread("b") });
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.request).toHaveBeenLastCalledWith("thread/read", {
    threadId: "b",
    includeTurns: false,
  });
  f.disconnect();
});

it("polls the selected thread after returning to a pending history read", async () => {
  const f = fixture();
  let resolve!: (value: { thread: Thread }) => void;
  f.request.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const opening = f.sessions.open("a");
  await Promise.resolve();
  f.request
    .mockResolvedValueOnce({ thread: thread("b") })
    .mockResolvedValueOnce({ thread: thread("b") });
  await f.sessions.open("b");
  const returning = f.sessions.open("a");
  f.request.mockResolvedValueOnce({ thread: thread("a") });
  resolve({ thread: thread("a") });
  await Promise.all([opening, returning]);
  f.request.mockResolvedValueOnce({ thread: thread("a") });
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.request).toHaveBeenLastCalledWith("thread/read", {
    threadId: "a",
    includeTurns: false,
  });
  f.disconnect();
});

it("keeps archived threads out of the list and preserves read-only current context when an earlier response arrives", async () => {
  const f = fixture();
  f.request
    .mockResolvedValueOnce({ thread: thread("a") })
    .mockResolvedValueOnce({ thread: thread("a") });
  await f.sessions.open("a");
  let resolve!: (value: { data: Thread[]; nextCursor: null }) => void;
  f.request.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const refresh = f.sessions.refresh();
  await Promise.resolve();
  f.notify({ method: "thread/archived", params: { threadId: "a" } });
  resolve({ data: [thread("a")], nextCursor: null });
  await refresh;
  expect(f.sessions.getSnapshot().threads.a?.id).toBe("a");
  expect(f.sessions.getSnapshot().archivedIds.a).toBe(true);
  expect(f.sessions.getSnapshot().selectedId).toBe("a");
  expect(f.sessions.getSnapshot().threadAccess.a).toBe("viewing");
  expect(f.sessions.getSnapshot().listIds).toEqual([]);
  f.disconnect();
});

it("syncs unloaded paginated history after discovery advances metadata, and retries failed reads", async () => {
  const f = fixture();
  const turn = {
    id: "external-turn",
    rootTurnId: null,
    itemsView: "full" as const,
    status: "interrupted" as const,
    error: null,
    startedAt: 1791950809,
    completedAt: null,
    durationMs: null,
    items: [
      {
        type: "userMessage" as const,
        id: "user",
        clientId: null,
        content: [{ type: "text" as const, text: "work", text_elements: [] }],
      },
    ],
  };
  let metadata: Thread = {
    ...thread("external"),
    historyMode: "paginated",
    status: { type: "notLoaded" },
    updatedAt: 1791950837,
    turns: [],
  };
  let turns: Thread["turns"] = [turn];
  let failHistory = false;
  f.request.mockImplementation(async (...[method]) => {
    if (method === "thread/list") return { data: [metadata], nextCursor: null };
    if (method === "thread/read") return { thread: metadata };
    if (method === "thread/turns/list") {
      if (failHistory) throw new Error("temporary read failure");
      return { data: turns, nextCursor: null };
    }
    throw new Error("unexpected request: " + method);
  });
  await f.sessions.open("external");
  metadata = { ...metadata, updatedAt: 1791950860 };
  await f.sessions.refresh();
  expect(f.sessions.getSnapshot().threads.external.updatedAt).toBe(
    metadata.updatedAt,
  );
  turns = [
    {
      ...turn,
      items: [
        ...turn.items,
        {
          type: "agentMessage",
          id: "answer",
          text: "external output",
          phase: null,
          memoryCitation: null,
          delivery: null,
          questions: null,
        },
      ],
    },
  ];
  failHistory = true;
  await f.sessions.restoreSelected();
  expect(f.sessions.getSnapshot().historySyncError).toBe(
    "temporary read failure",
  );
  expect(f.sessions.getSnapshot().threads.external.turns[0].items).toHaveLength(
    1,
  );
  failHistory = false;
  await f.sessions.restoreSelected();
  const snapshot = f.sessions.getSnapshot();
  expect(snapshot.historySyncError).toBeNull();
  expect(snapshot.threads.external.status.type).toBe("notLoaded");
  expect(snapshot.threads.external.turns[0].status).toBe("interrupted");
  expect(snapshot.threads.external.turns[0].items).toHaveLength(2);
  const reads = () =>
    f.request.mock.calls.filter(([m]) => m === "thread/turns/list").length;
  const count = reads();
  await f.sessions.restoreSelected();
  expect(reads()).toBe(count);
  await vi.advanceTimersByTimeAsync(1000);
  metadata = { ...metadata, updatedAt: metadata.updatedAt + 1 };
  await f.sessions.restoreSelected();
  expect(reads()).toBe(count + 1);
  expect(f.request.mock.calls.some(([m]) => m === "thread/resume")).toBe(false);
  f.disconnect();
});

it("keeps sessions on disconnect and switches cached conversations without requests", async () => {
  const f = fixture();
  f.connect();
  f.request.mockResolvedValue({ thread: thread("a") });
  await f.sessions.open("a");
  f.request.mockResolvedValue({ thread: thread("b") });
  await f.sessions.open("b");
  const before = f.sessions.getSnapshot();
  f.disconnect();
  f.request.mockClear();
  await f.sessions.open("a");
  expect(f.request).not.toHaveBeenCalled();
  expect(f.sessions.getSnapshot()).toMatchObject({
    selectedId: "a",
    listIds: before.listIds,
    threads: before.threads,
  });
  f.changeEnvironment();
  expect(f.sessions.getSnapshot().listIds).toEqual([]);
});

it("reconnect uses the last connection credentials without persisting them", async () => {
  const runtime = createRuntime();
  const connect = vi.spyOn(runtime.connection, "connect").mockResolvedValue();
  await runtime.connect("ws://127.0.0.1:4501", "memory-only-token");
  const snapshot = runtime.connection.getSnapshot();
  vi.spyOn(runtime.connection, "getSnapshot").mockReturnValue({
    ...snapshot,
    url: "ws://127.0.0.1:4501",
  });
  await runtime.reconnect();
  expect(connect).toHaveBeenLastCalledWith(
    "ws://127.0.0.1:4501",
    "memory-only-token",
  );
});

it("preserves project updates for unknown threads while discovery is in flight", async () => {
  const f = fixture();
  let resolve!: (value: { data: Thread[] }) => void;
  f.request.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  f.connect();
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.request).toHaveBeenCalledTimes(1);
  f.notify({
    method: "thread/project/updated",
    params: { threadId: "external", projectId: "new-project" },
  });
  f.notify({
    method: "thread/project/updated",
    params: { threadId: "unassigned", projectId: null },
  });
  resolve({
    data: [
      {
        ...thread("external"),
        projectId: "old-project",
        cwd: "/real-directory",
      },
      { ...thread("unassigned"), projectId: "old-project" },
    ],
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.sessions.getSnapshot().threads.external).toMatchObject({
    projectId: "new-project",
    cwd: "/real-directory",
  });
  expect(f.sessions.getSnapshot().threads.unassigned.projectId).toBeNull();
  f.request.mockResolvedValueOnce({
    data: [{ ...thread("external"), projectId: "later-project" }],
  });
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.sessions.getSnapshot().threads.external.projectId).toBe(
    "later-project",
  );
  f.disconnect();
});
