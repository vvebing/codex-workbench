import { expect, it, vi } from "vitest";
import {
  initialState,
  isSubagentThread,
  reconcileNotifications,
  sessionNotification,
  shouldNotifyThread,
} from "../../src/features/sessions/state";
import { placeholderThread } from "../../src/lib/state";
import type { Thread } from "../../src/generated/v2/Thread";
import type { Turn } from "../../src/generated/v2/Turn";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";
import type { RpcNotification, RpcRequest } from "../../src/lib/rpc";
import { ConnectionStore } from "../../src/features/connection/store";
import { SessionsStore } from "../../src/features/sessions/store";
import { RequestsStore } from "../../src/features/requests/store";

const completedTurn: Turn = {
  id: "done",
  rootTurnId: null,
  items: [],
  itemsView: "full",
  status: "completed",
  error: null,
  startedAt: 1,
  completedAt: 2,
  durationMs: 1000,
};
for (const metadata of [
  { source: { subAgent: "review" } },
  {
    source: {
      subAgent: {
        thread_spawn: {
          parent_thread_id: "parent",
          depth: 1,
          agent_path: null,
          agent_nickname: null,
          agent_role: null,
        },
      },
    },
  },
  { parentThreadId: "parent" },
] satisfies Partial<Thread>[]) {
  it(`keeps child completion silent with ${JSON.stringify(metadata)}`, () => {
    const child = { ...placeholderThread("child"), ...metadata };
    const state = { ...initialState(), threads: { child } };
    const next = sessionNotification(
      state,
      {
        method: "turn/completed",
        params: { threadId: "child", turn: completedTurn },
      },
      new Set(),
      false,
    );
    expect(isSubagentThread(child)).toBe(true);
    expect(next.completionNotifications).toEqual([]);
    expect(next.unreadCompleted).toEqual({});
    expect(next.threads.child.turns[0].status).toBe("completed");
    expect(next.finishedTurns.child.done).toBe(true);
  });
}
it("keeps main and forked session completion notifications", () => {
  const main = { ...placeholderThread("main"), forkedFromId: "original" };
  const next = sessionNotification(
    { ...initialState(), threads: { main } },
    {
      method: "turn/completed",
      params: { threadId: "main", turn: completedTurn },
    },
    new Set(),
    false,
  );
  expect(isSubagentThread(main)).toBe(false);
  expect(next.completionNotifications).toHaveLength(1);
  expect(next.unreadCompleted.main).toBe("done");
});

function storeFixture() {
  const connection = new ConnectionStore();
  const listeners: ((event: RpcNotification) => void)[] = [];
  vi.spyOn(connection.client, "onNotification").mockImplementation(
    (listener) => {
      listeners.push(listener);
      return () => {};
    },
  );
  const sessions = new SessionsStore(connection);
  return {
    connection,
    sessions,
    notify: (event: RpcNotification) => {
      for (const listener of listeners) listener(event);
    },
  };
}
const completion = (threadId: string): RpcNotification => ({
  method: "turn/completed",
  params: { threadId, turn: completedTurn },
});

it("marks a selected session completed in a hidden tab unread until the result is visible", async () => {
  const { connection, sessions, notify } = storeFixture();
  vi.spyOn(connection.client, "request").mockResolvedValue({
    thread: placeholderThread("main"),
  });
  await sessions.open("main");
  sessions.setPageVisible(false);
  notify(completion("main"));
  expect(sessions.getSnapshot().unreadCompleted.main).toBe("done");
  sessions.dismissCompletion(
    sessions.getSnapshot().completionNotifications[0].id,
  );
  expect(sessions.getSnapshot().unreadCompleted.main).toBe("done");
  sessions.setPageVisible(true);
  expect(sessions.getSnapshot().unreadCompleted).toEqual({});
});

it("does not acknowledge another environment or a hidden tab on environment selection", async () => {
  const { connection, sessions, notify } = storeFixture();
  vi.spyOn(connection.client, "request").mockResolvedValue({
    thread: placeholderThread("main"),
  });
  await sessions.open("main");
  sessions.setForeground(false);
  sessions.setPageVisible(false);
  notify(completion("main"));
  sessions.setPageVisible(true);
  expect(sessions.getSnapshot().unreadCompleted.main).toBe("done");
  sessions.setPageVisible(false);
  sessions.setForeground(true);
  expect(sessions.getSnapshot().unreadCompleted.main).toBe("done");
  sessions.setPageVisible(true);
  expect(sessions.getSnapshot().unreadCompleted).toEqual({});
});
it("retains completion while the tab is visible but another application has focus", async () => {
  const { connection, sessions, notify } = storeFixture();
  vi.spyOn(connection.client, "request").mockResolvedValue({
    thread: placeholderThread("main"),
  });
  await sessions.open("main");
  sessions.setPageFocused(false);
  notify(completion("main"));
  expect(sessions.getSnapshot().unreadCompleted.main).toBe("done");
  sessions.setForeground(false);
  sessions.setForeground(true);
  expect(sessions.getSnapshot().unreadCompleted.main).toBe("done");
  sessions.setPageFocused(true);
  expect(sessions.getSnapshot().unreadCompleted).toEqual({});
});

it("does not acknowledge other sessions or environments when focus returns", async () => {
  const { connection, sessions, notify } = storeFixture();
  vi.spyOn(connection.client, "request").mockResolvedValue({
    thread: placeholderThread("selected"),
  });
  await sessions.open("selected");
  sessions.setPageFocused(false);
  notify(completion("other"));
  sessions.setPageFocused(true);
  expect(sessions.getSnapshot().unreadCompleted.other).toBe("done");
  sessions.setForeground(false);
  sessions.setPageFocused(false);
  notify(completion("selected"));
  sessions.setPageFocused(true);
  expect(sessions.getSnapshot().unreadCompleted.selected).toBe("done");
});

const spawn: ThreadItem = {
  type: "collabAgentToolCall",
  id: "spawn",
  tool: "spawnAgent",
  status: "completed",
  senderThreadId: "parent",
  receiverThreadIds: ["child"],
  prompt: null,
  model: null,
  reasoningEffort: null,
  agentsStates: {},
};
const activity: ThreadItem = {
  type: "subAgentActivity",
  id: "activity",
  agentThreadId: "child",
  agentPath: "/root/check",
  kind: "started",
  model: null,
  reasoningEffort: null,
};
it("keeps the root visible and notifiable when a child reports root activity", () => {
  const parent = { ...placeholderThread("parent"), source: "vscode" as const };
  const child = {
    ...placeholderThread("child"),
    parentThreadId: "parent",
    turns: [
      {
        ...completedTurn,
        items: [{ ...activity, agentThreadId: "parent", agentPath: "/root" }],
      },
    ],
  };
  const state = reconcileNotifications(initialState(), {
    ...initialState(),
    threads: { parent, child },
    listIds: ["parent"],
    unreadCompleted: { parent: "done", child: "done" },
  });
  expect(state.subagentThreadIds).toEqual({ child: true });
  expect(state.unreadCompleted).toEqual({ parent: "done" });
  expect(shouldNotifyThread(state, "parent")).toBe(true);
  expect(shouldNotifyThread(state, "child")).toBe(false);
});
for (const item of [spawn, activity]) {
  it(`uses native ${item.type} references before child metadata arrives`, () => {
    let state = sessionNotification(
      initialState(),
      {
        method: "item/started",
        params: { threadId: "parent", turnId: "run", item, startedAtMs: 1 },
      },
      new Set(),
      false,
    );
    state = sessionNotification(state, completion("child"), new Set(), false);
    expect(state.subagentThreadIds.child).toBe(true);
    expect(state.completionNotifications).toEqual([]);
    expect(state.unreadCompleted).toEqual({});
    expect(state.finishedTurns.child.done).toBe(true);
    expect(shouldNotifyThread(state, "child")).toBe(false);
  });
}
it("recognizes the older native lowercase subagent source", () => {
  const child = {
    ...placeholderThread("child"),
    source: { subagent: "review" },
  } as unknown as Thread;
  expect(isSubagentThread(child)).toBe(true);
  const state = sessionNotification(
    { ...initialState(), threads: { child } },
    completion("child"),
    new Set(),
    false,
  );
  expect(state.completionNotifications).toEqual([]);
});
it("waits for metadata when completion precedes thread/started", () => {
  const completed = new Set<string>();
  const pending = sessionNotification(
    initialState(),
    completion("child"),
    completed,
    false,
  );
  expect(shouldNotifyThread(pending, "child")).toBe(false);
  const state = sessionNotification(
    pending,
    {
      method: "thread/started",
      params: {
        thread: { ...placeholderThread("child"), parentThreadId: "parent" },
      },
    },
    completed,
    false,
  );
  expect(state.completionNotifications).toEqual([]);
  expect(state.unreadCompleted).toEqual({});
  expect(state.threads.child.turns[0].status).toBe("completed");
});
it("late parent references silence queued child completion without silencing the parent", () => {
  const completed = new Set<string>();
  let state = sessionNotification(
    initialState(),
    {
      method: "thread/started",
      params: { thread: placeholderThread("parent") },
    },
    completed,
    false,
  );
  state = sessionNotification(state, completion("child"), completed, false);
  state = sessionNotification(
    state,
    {
      method: "item/started",
      params: {
        threadId: "parent",
        turnId: "run",
        item: spawn,
        startedAtMs: 1,
      },
    },
    completed,
    false,
  );
  state = sessionNotification(state, completion("parent"), completed, false);
  expect(
    state.completionNotifications.map((notice) => notice.threadId),
  ).toEqual(["parent"]);
  expect(state.unreadCompleted).toEqual({ parent: "done" });
  expect(shouldNotifyThread(state, "parent")).toBe(true);
  expect(shouldNotifyThread(state, "child")).toBe(false);
});
it("releases an unknown-source main thread once native metadata confirms it", () => {
  const completed = new Set<string>();
  let state = sessionNotification(
    initialState(),
    completion("main"),
    completed,
    false,
  );
  expect(shouldNotifyThread(state, "main")).toBe(false);
  state = sessionNotification(
    state,
    { method: "thread/started", params: { thread: placeholderThread("main") } },
    completed,
    false,
  );
  expect(shouldNotifyThread(state, "main")).toBe(true);
  expect(state.completionNotifications).toHaveLength(1);
});
it("metadata reads deduplicate, preserve streamed completion and silence a late-identified child", async () => {
  const { connection, sessions, notify } = storeFixture();
  let resolve!: (value: { thread: Thread }) => void;
  const response = new Promise<{ thread: Thread }>((done) => {
    resolve = done;
  });
  const request = vi
    .spyOn(connection.client, "request")
    .mockReturnValue(response);
  notify(completion("child"));
  const first = sessions.ensureNotificationMetadata("child");
  const second = sessions.ensureNotificationMetadata("child");
  expect(shouldNotifyThread(sessions.getSnapshot(), "child")).toBe(false);
  resolve({
    thread: { ...placeholderThread("child"), source: { subAgent: "review" } },
  });
  await Promise.all([first, second]);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith("thread/read", {
    threadId: "child",
    includeTurns: false,
  });
  expect(sessions.getSnapshot().threads.child.turns[0].status).toBe(
    "completed",
  );
  expect(sessions.getSnapshot().completionNotifications).toEqual([]);
  expect(sessions.getSnapshot().unreadCompleted).toEqual({});
});
it("keeps failed identity reads silent and retries without losing a main-thread notice", async () => {
  const { connection, sessions, notify } = storeFixture();
  const request = vi
    .spyOn(connection.client, "request")
    .mockRejectedValueOnce(new Error("metadata temporarily unavailable"))
    .mockResolvedValueOnce({ thread: placeholderThread("main") });
  notify(completion("main"));
  await sessions.ensureNotificationMetadata("main");
  expect(shouldNotifyThread(sessions.getSnapshot(), "main")).toBe(false);
  expect(sessions.getSnapshot().notificationMetadataPending.main).toBe(true);
  await sessions.ensureNotificationMetadata("main");
  expect(request).toHaveBeenCalledTimes(2);
  expect(shouldNotifyThread(sessions.getSnapshot(), "main")).toBe(true);
  expect(sessions.getSnapshot().completionNotifications).toHaveLength(1);
});
it("a delayed metadata read cannot undo newer native child identity", async () => {
  const { connection, sessions, notify } = storeFixture();
  let resolve!: (value: { thread: Thread }) => void;
  const response = new Promise<{ thread: Thread }>((done) => {
    resolve = done;
  });
  vi.spyOn(connection.client, "request").mockReturnValue(response);
  notify(completion("child"));
  const reading = sessions.ensureNotificationMetadata("child");
  notify({
    method: "thread/started",
    params: {
      thread: { ...placeholderThread("child"), source: { subAgent: "review" } },
    },
  });
  resolve({ thread: placeholderThread("child") });
  await reading;
  expect(isSubagentThread(sessions.getSnapshot().threads.child)).toBe(true);
  expect(shouldNotifyThread(sessions.getSnapshot(), "child")).toBe(false);
  expect(sessions.getSnapshot().completionNotifications).toEqual([]);
});
it("thread/list identifies a late child and incomplete later snapshots cannot undo its identity", async () => {
  const { connection, sessions, notify } = storeFixture();
  const response = new Promise<{ thread: Thread }>(() => {});
  vi.spyOn(connection.client, "request").mockImplementation(((
    method: string,
  ) =>
    method === "thread/list"
      ? Promise.resolve({
          data: [{ ...placeholderThread("child"), parentThreadId: "parent" }],
          nextCursor: null,
        })
      : response) as never);
  notify(completion("child"));
  await sessions.refresh();
  expect(sessions.getSnapshot().completionNotifications).toEqual([]);
  notify({
    method: "thread/started",
    params: { thread: placeholderThread("child") },
  });
  expect(shouldNotifyThread(sessions.getSnapshot(), "child")).toBe(false);
  notify({ method: "thread/deleted", params: { threadId: "parent" } });
  expect(shouldNotifyThread(sessions.getSnapshot(), "child")).toBe(false);
});

const actions: RpcRequest[] = [
  {
    id: "question",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "child",
      turnId: "run",
      itemId: "question",
      questions: [],
      isBlocking: true,
      autoResolutionMs: null,
    },
  },
  {
    id: "command",
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "child",
      turnId: "run",
      itemId: "command",
      startedAtMs: 1,
      kind: "command",
      environmentId: null,
    },
  },
  {
    id: "file",
    method: "item/fileChange/requestApproval",
    params: {
      threadId: "child",
      turnId: "run",
      itemId: "file",
      startedAtMs: 1,
    },
  },
];
for (const action of actions) {
  it(`keeps ${action.method} silent before metadata while retaining it for the agent drawer`, async () => {
    const { connection, sessions } = storeFixture();
    let receive!: (request: RpcRequest) => void;
    vi.spyOn(connection.client, "onRequest").mockImplementation((listener) => {
      receive = listener;
      return () => {};
    });
    const requests = new RequestsStore(connection);
    receive(action);
    expect(shouldNotifyThread(sessions.getSnapshot(), "child")).toBe(false);
    vi.spyOn(connection.client, "request").mockResolvedValue({
      thread: { ...placeholderThread("child"), parentThreadId: "parent" },
    });
    await sessions.ensureNotificationMetadata("child");
    expect(shouldNotifyThread(sessions.getSnapshot(), "child")).toBe(false);
    expect(requests.forThread("child")).toEqual([action]);
    const respond = vi
      .spyOn(connection.client, "respond")
      .mockImplementation(() => {});
    const answer =
      action.method === "item/tool/requestUserInput"
        ? { answers: {} }
        : { decision: "accept" };
    expect(requests.respond(action.id, answer)).toBe(true);
    expect(respond).toHaveBeenCalledWith(action.id, answer);
    expect(requests.forThread("child")).toEqual([]);
  });
}
