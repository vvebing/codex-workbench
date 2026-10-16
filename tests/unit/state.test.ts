import { describe, expect, it } from "vitest";
import {
  emptyState,
  mergeThread,
  operationKey,
  reduceNotification,
} from "../../src/lib/state";
import type { Thread } from "../../src/generated/v2/Thread";
import type { Turn } from "../../src/generated/v2/Turn";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";
import type { RpcNotification } from "../../src/lib/rpc";

const message = (text: string): ThreadItem => ({
  type: "agentMessage",
  id: "item",
  text,
  phase: null,
  memoryCitation: null,
  delivery: null,
  questions: null,
});
const turn = (
  items: ThreadItem[] = [],
  status: Turn["status"] = "inProgress",
): Turn => ({
  id: "turn",
  rootTurnId: null,
  items,
  status,
  itemsView: "full",
  error: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
});
const thread = (turns: Turn[] = []): Thread =>
  ({
    id: "thread",
    turns,
    name: "Test",
    preview: "",
    cwd: "/workspace",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
  }) as Thread;
const delta = (
  text: string,
  threadId = "thread",
  turnId = "turn",
): RpcNotification => ({
  method: "item/agentMessage/delta",
  params: { threadId, turnId, itemId: "item", delta: text },
});

describe("conversation stream state", () => {
  it("keeps a confirmed interruption terminal even without a completion timestamp", () => {
    const active = mergeThread(emptyState(), thread([turn()]));
    const stopped = reduceNotification(active, {
      method: "turn/completed",
      params: { threadId: "thread", turn: turn([], "interrupted") },
    });
    const stale = mergeThread(stopped, thread([turn()]));
    expect(stale.threads.thread.turns[0].status).toBe("interrupted");
    expect(stale.finishedTurns.thread.turn).toBe(true);
    const lateStart = reduceNotification(stale, {
      method: "turn/started",
      params: { threadId: "thread", turn: turn() },
    });
    expect(lateStart.threads.thread.turns[0].status).toBe("interrupted");
    expect(
      reduceNotification(lateStart, {
        method: "thread/archived",
        params: { threadId: "thread" },
      }).finishedTurns.thread,
    ).toBeUndefined();
  });

  it("allows a partial interrupted history snapshot to recover as externally running", () => {
    const partial = { ...turn([], "interrupted"), completedAt: null };
    const cached = mergeThread(emptyState(), thread([partial]));
    const next = mergeThread(cached, thread([turn([message("new output")])]));
    expect(next.threads.thread.turns[0].status).toBe("inProgress");
    const confirmed = mergeThread(
      emptyState(),
      thread([{ ...partial, completedAt: 150 }]),
    );
    expect(
      mergeThread(confirmed, thread([turn()])).threads.thread.turns[0].status,
    ).toBe("interrupted");
  });

  it("does not change recency when full history follows a newer list summary", () => {
    const listed = mergeThread(emptyState(), { ...thread(), updatedAt: 1000 });
    const loaded = mergeThread(listed, {
      ...thread([
        { ...turn([], "completed"), startedAt: 100, completedAt: 150 },
      ]),
      updatedAt: 1000,
    });
    expect(loaded.threads.thread.updatedAt).toBe(1000);
    expect(
      mergeThread(loaded, { ...thread(), updatedAt: 900 }).threads.thread
        .updatedAt,
    ).toBe(1000);
  });

  it("keeps older turns before an incremental history update and streamed turns after it", () => {
    const historyTurn = (id: string) => ({ ...turn([], "completed"), id });
    const cached = mergeThread(
      emptyState(),
      thread(["old-1", "old-2", "anchor", "new", "streamed"].map(historyTurn)),
    );
    const updated = mergeThread(
      cached,
      thread([
        historyTurn("anchor"),
        { ...historyTurn("new"), items: [message("loaded")] },
      ]),
    );
    expect(updated.threads.thread.turns.map((turn) => turn.id)).toEqual([
      "old-1",
      "old-2",
      "anchor",
      "new",
      "streamed",
    ]);
    expect(updated.threads.thread.turns[3].items).toEqual([message("loaded")]);
    expect(cached.threads.thread.turns[3].items).toEqual([]);
  });

  it("places full earlier history before a turn first observed through streaming", () => {
    const historyTurn = (id: string) => ({ ...turn([], "completed"), id });
    const cached = mergeThread(emptyState(), thread([historyTurn("latest")]));
    const updated = mergeThread(
      cached,
      thread([
        historyTurn("old-1"),
        historyTurn("old-2"),
        historyTurn("latest"),
      ]),
    );
    expect(updated.threads.thread.turns.map((turn) => turn.id)).toEqual([
      "old-1",
      "old-2",
      "latest",
    ]);
  });

  it("retains streamed items when turn completion has an empty item array", () => {
    let state = reduceNotification(emptyState(), delta("hello"));
    const previous = state;
    state = reduceNotification(state, {
      method: "turn/completed",
      params: { threadId: "thread", turn: turn([], "completed") },
    });
    expect(state.threads.thread.turns[0].items).toEqual([message("hello")]);
    expect(state.threads.thread.turns[0].status).toBe("completed");
    expect(previous.threads.thread.turns[0].status).toBe("inProgress");
  });

  it("replaces accumulated text with the authoritative completed item", () => {
    let state = reduceNotification(emptyState(), delta("Partial text"));
    state = reduceNotification(state, {
      method: "item/completed",
      params: {
        completedAtMs: 0,
        threadId: "thread",
        turnId: "turn",
        item: message("Final corrected text"),
      },
    });
    expect(state.threads.thread.turns[0].items).toEqual([
      message("Final corrected text"),
    ]);
  });

  it("isolates identical item IDs by thread and turn", () => {
    let state = reduceNotification(emptyState(), delta("A"));
    state = reduceNotification(state, delta("B", "other"));
    state = reduceNotification(state, delta("C", "thread", "second"));
    state = reduceNotification(state, delta("D"));
    expect(state.threads.thread.turns[0].items).toEqual([message("AD")]);
    expect(state.threads.thread.turns[1].items).toEqual([message("C")]);
    expect(state.threads.other.turns[0].items).toEqual([message("B")]);
  });

  it("hydrates resume history while keeping deltas and new turns received during the request", () => {
    let state = reduceNotification(emptyState(), delta("Hello world"));
    state = reduceNotification(state, delta("New turn", "thread", "new-turn"));
    state = mergeThread(state, thread([turn([message("Hello")])]));
    expect(state.threads.thread.name).toBe("Test");
    expect(state.threads.thread.turns).toHaveLength(2);
    expect(state.threads.thread.turns[0].items).toEqual([
      message("Hello world"),
    ]);
    state = mergeThread(state, thread());
    expect(state.threads.thread.turns).toHaveLength(2);
  });

  it("does not roll a completed turn back to a stale in-progress resume snapshot", () => {
    const state = mergeThread(
      emptyState(),
      thread([turn([message("done")], "completed")]),
    );
    expect(
      mergeThread(state, thread([turn()])).threads.thread.turns[0].status,
    ).toBe("completed");
  });

  it("places hydrated earlier items before a streamed tail item", () => {
    const state = reduceNotification(emptyState(), delta("tail"));
    const hydrated = mergeThread(
      state,
      thread([
        turn([{ ...message("earlier"), id: "earlier-item" }, message("ta")]),
      ]),
    );
    expect(
      hydrated.threads.thread.turns[0].items.map((item) => item.id),
    ).toEqual(["earlier-item", "item"]);
    expect(hydrated.threads.thread.turns[0].items[1]).toEqual(message("tail"));
  });

  it("preserves early command output when its item metadata arrives", () => {
    let state = reduceNotification(emptyState(), {
      method: "item/commandExecution/outputDelta",
      params: {
        threadId: "thread",
        turnId: "turn",
        itemId: "cmd",
        delta: "first\n",
      },
    });
    const item = state.threads.thread.turns[0].items[0];
    if (item.type !== "commandExecution") throw new Error("Expected command");
    state = reduceNotification(state, {
      method: "item/started",
      params: {
        startedAtMs: 0,
        threadId: "thread",
        turnId: "turn",
        item: { ...item, command: "npm test", aggregatedOutput: null },
      },
    });
    state = reduceNotification(state, {
      method: "item/commandExecution/outputDelta",
      params: {
        threadId: "thread",
        turnId: "turn",
        itemId: "cmd",
        delta: "second\n",
      },
    });
    expect(state.threads.thread.turns[0].items[0]).toMatchObject({
      command: "npm test",
      aggregatedOutput: "first\nsecond\n",
    });
  });

  it("stores plans and replacement diffs independently by thread", () => {
    let state = reduceNotification(emptyState(), {
      method: "turn/diff/updated",
      params: { threadId: "thread", turnId: "turn", diff: "+one" },
    });
    state = reduceNotification(state, {
      method: "turn/diff/updated",
      params: { threadId: "thread", turnId: "turn", diff: "+two" },
    });
    state = reduceNotification(state, {
      method: "turn/plan/updated",
      params: {
        threadId: "other",
        turnId: "turn",
        explanation: null,
        plan: [{ step: "Test", status: "inProgress" }],
      },
    });
    expect(state.diffs).toEqual({ thread: { turn: "+two" } });
    expect(state.plans).toEqual({
      other: { turn: [{ step: "Test", status: "inProgress" }] },
    });
  });
});

it("preserves server update time when older turn history is loaded", () => {
  const historical = {
    ...thread([{ ...turn([], "completed"), startedAt: 100, completedAt: 150 }]),
    updatedAt: 9999,
  };
  const state = mergeThread(emptyState(), historical, true);
  expect(state.threads.thread.updatedAt).toBe(9999);
  const resumed = mergeThread(state, { ...historical, updatedAt: 20000 }, true);
  expect(resumed.threads.thread.updatedAt).toBe(9999);
  const completed = reduceNotification(resumed, {
    method: "turn/completed",
    params: {
      threadId: "thread",
      turn: { ...turn([], "completed"), startedAt: 21000, completedAt: 22000 },
    },
  });
  expect(completed.threads.thread.updatedAt).toBe(22000);
});
it("preserves list timestamps for resumed legacy history without timing", () => {
  const state = mergeThread(emptyState(), { ...thread(), updatedAt: 100 });
  expect(
    mergeThread(state, { ...thread(), updatedAt: 9999 }, true).threads.thread
      .updatedAt,
  ).toBe(100);
  expect(
    mergeThread(emptyState(), { ...thread(), updatedAt: 9999 }, true).threads
      .thread.updatedAt,
  ).toBe(9999);
});

it("clears an active thread on turn completion without waiting for an idle notification", () => {
  const active = {
    ...thread([turn()]),
    status: { type: "active" as const, activeFlags: [] },
  };
  const state = mergeThread(emptyState(), active);
  for (const status of ["completed", "failed", "interrupted"] as const) {
    const next = reduceNotification(state, {
      method: "turn/completed",
      params: { threadId: "thread", turn: turn([], status) },
    });
    expect(next.threads.thread.status.type).toBe("idle");
    expect(next.threads.thread.turns[0].status).toBe(status);
  }
});
it("keeps a thread active if another turn is still running", () => {
  const active = {
    ...thread([turn(), { ...turn(), id: "other" }]),
    status: { type: "active" as const, activeFlags: [] },
  };
  const next = reduceNotification(mergeThread(emptyState(), active), {
    method: "turn/completed",
    params: { threadId: "thread", turn: turn([], "completed") },
  });
  expect(next.threads.thread.status.type).toBe("active");
});

it("keeps latest context usage per thread across hydration and compaction", () => {
  const breakdown = (totalTokens: number) => ({
    totalTokens,
    inputTokens: totalTokens,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  });
  const update = (threadId: string, used: number): RpcNotification => ({
    method: "thread/tokenUsage/updated",
    params: {
      threadId,
      turnId: "turn",
      tokenUsage: {
        total: breakdown(300000),
        last: breakdown(used),
        modelContextWindow: 128000,
      },
    },
  });
  let state = reduceNotification(emptyState(), update("thread", 54000));
  state = reduceNotification(state, update("other", 10000));
  state = mergeThread(state, thread());
  expect(state.tokenUsage.thread.last.totalTokens).toBe(54000);
  state = reduceNotification(state, update("thread", 12000));
  expect(state.tokenUsage.thread.last.totalTokens).toBe(12000);
  expect(state.tokenUsage.other.last.totalTokens).toBe(10000);
  state = reduceNotification(state, {
    method: "thread/archived",
    params: { threadId: "thread" },
  });
  expect(state.tokenUsage.thread).toBeUndefined();
  expect(state.tokenUsage.other.last.totalTokens).toBe(10000);
});

describe("MCP tool progress", () => {
  const progress = (
    message: string,
    threadId = "thread",
    turnId = "turn",
  ): RpcNotification => ({
    method: "item/mcpToolCall/progress",
    params: { threadId, turnId, itemId: "item", message },
  });

  it("keeps progress isolated between parent, child, and different turns", () => {
    let state = reduceNotification(emptyState(), progress("Parent started"));
    state = reduceNotification(state, progress("Child started", "child"));
    state = reduceNotification(state, progress("Next turn", "thread", "next"));
    state = reduceNotification(state, progress("Parent finished"));
    expect(state.toolProgress[operationKey("thread", "turn", "item")]).toEqual([
      "Parent started",
      "Parent finished",
    ]);
    expect(state.toolProgress[operationKey("child", "turn", "item")]).toEqual([
      "Child started",
    ]);
    expect(state.toolProgress[operationKey("thread", "next", "item")]).toEqual([
      "Next turn",
    ]);
  });

  it("preserves progress when completion and history arrive", () => {
    let state = reduceNotification(emptyState(), progress("Fetched results"));
    state = reduceNotification(state, {
      method: "item/completed",
      params: {
        completedAtMs: 0,
        threadId: "thread",
        turnId: "turn",
        item: message("Done"),
      },
    });
    state = mergeThread(state, thread([turn([message("Done")], "completed")]));
    expect(state.toolProgress[operationKey("thread", "turn", "item")]).toEqual([
      "Fetched results",
    ]);
  });

  it("bounds retained messages and clears only archived thread progress", () => {
    let state = emptyState();
    for (let index = 0; index < 105; index++)
      state = reduceNotification(state, progress(String(index)));
    state = reduceNotification(state, progress("Keep child", "child"));
    const messages = state.toolProgress[operationKey("thread", "turn", "item")];
    expect(messages).toHaveLength(100);
    expect(messages[0]).toBe("5");
    state = reduceNotification(state, {
      method: "thread/archived",
      params: { threadId: "thread" },
    });
    expect(
      state.toolProgress[operationKey("thread", "turn", "item")],
    ).toBeUndefined();
    expect(state.toolProgress[operationKey("child", "turn", "item")]).toEqual([
      "Keep child",
    ]);
  });
});

describe("statusless operation live lifecycle", () => {
  const reasoning: ThreadItem = {
    type: "reasoning",
    id: "thinking",
    summary: [],
    content: [],
  };
  it("keeps snapshots neutral and records explicit starts and completions by full operation key", () => {
    let state = mergeThread(emptyState(), thread([turn([reasoning])]));
    const key = operationKey("thread", "turn", "thinking");
    expect(state.startedItems[key]).toBeUndefined();
    state = reduceNotification(state, {
      method: "item/started",
      params: {
        startedAtMs: 0,
        threadId: "thread",
        turnId: "turn",
        item: reasoning,
      },
    });
    expect(state.startedItems[key]).toBe(true);
    state = reduceNotification(state, {
      method: "item/completed",
      params: {
        completedAtMs: 0,
        threadId: "thread",
        turnId: "turn",
        item: reasoning,
      },
    });
    state = mergeThread(state, thread([turn([reasoning])]));
    expect(state.completedItems[key]).toBe(true);
    expect(
      state.completedItems[operationKey("child", "turn", "thinking")],
    ).toBeUndefined();
  });
  it("recognizes real reasoning streaming when a start notification was missed", () => {
    const state = reduceNotification(emptyState(), {
      method: "item/reasoning/summaryTextDelta",
      params: {
        threadId: "thread",
        turnId: "turn",
        itemId: "thinking",
        summaryIndex: 0,
        delta: "Inspecting",
      },
    });
    expect(state.startedItems[operationKey("thread", "turn", "thinking")]).toBe(
      true,
    );
  });
  it("records image completion independently while the turn continues", () => {
    const item: ThreadItem = {
      type: "imageView",
      id: "image",
      path: "/image.png",
    };
    const state = reduceNotification(emptyState(), {
      method: "item/completed",
      params: { completedAtMs: 0, threadId: "thread", turnId: "turn", item },
    });
    expect(state.completedItems[operationKey("thread", "turn", "image")]).toBe(
      true,
    );
    expect(state.threads.thread.turns[0].status).toBe("inProgress");
  });
});

it("isolates late plan and diff updates by turn across history hydration", () => {
  let state = mergeThread(emptyState(), thread([turn()]));
  const plan = [{ step: "First", status: "completed" as const }];
  state = reduceNotification(state, {
    method: "turn/plan/updated",
    params: { threadId: "thread", turnId: "turn", explanation: null, plan },
  });
  state = reduceNotification(state, {
    method: "turn/diff/updated",
    params: { threadId: "thread", turnId: "second", diff: "+B" },
  });
  state = reduceNotification(state, {
    method: "turn/diff/updated",
    params: { threadId: "thread", turnId: "turn", diff: "+A" },
  });
  state = mergeThread(state, thread([{ ...turn(), id: "second" }]));
  expect(state.diffs.thread).toEqual({ turn: "+A", second: "+B" });
  expect(state.plans.thread).toEqual({ turn: plan });
  expect(state.plans.thread.second).toBeUndefined();
  state = reduceNotification(state, {
    method: "thread/archived",
    params: { threadId: "thread" },
  });
  expect(state.diffs.thread).toBeUndefined();
  expect(state.plans.thread).toBeUndefined();
});

it("keeps terminal stream errors on their owning turn and does not mark retries as failures", () => {
  const error = {
    message: "服务不可用",
    codexErrorInfo: null,
    additionalDetails: null,
    misalignment: null,
  };
  const event: RpcNotification = {
    method: "error",
    params: { threadId: "thread", turnId: "turn", error, willRetry: false },
  };
  const state = reduceNotification(emptyState(), event);
  expect(state.threads.thread.turns[0].error).toEqual(error);
  expect(state.threads.thread.turns[0].status).toBe("inProgress");
  const retrying = reduceNotification(emptyState(), {
    ...event,
    params: { ...event.params, willRetry: true },
  });
  expect(retrying.threads.thread.turns[0].error).toBeNull();
});
