import { describe, expect, it, vi } from "vitest";
import {
  estimateHistoryValueBytes,
  pruneHistoryCache,
} from "../../src/features/sessions/history-cache";
import { initialState } from "../../src/features/sessions/state";
import { operationKey, placeholderThread } from "../../src/lib/state";
import type { Turn } from "../../src/generated/v2/Turn";

function setup(ids: string[]) {
  const state = initialState();
  for (const id of ids) {
    state.threads[id] = {
      ...placeholderThread(id),
      name: `name-${id}`,
      cwd: "/work",
      turns: [
        {
          id: "turn",
          status: "completed",
          items: [],
          itemsView: "full",
        } as unknown as Turn,
      ],
    };
    state.threadAccess[id] = "viewing";
    state.listIds.push(id);
  }
  return state;
}
describe("history cache budgets", () => {
  it("evicts the coldest body while preserving list metadata and access", () => {
    const state = setup(["cold", "warm", "selected"]);
    state.selectedId = "selected";
    const result = pruneHistoryCache(state, {
      maxThreads: 2,
      touched: new Map([
        ["cold", 1],
        ["warm", 2],
      ]),
    });
    expect(result.evictedIds).toEqual(["cold"]);
    expect(result.state.threads.cold).toEqual({
      ...state.threads.cold,
      turns: [],
    });
    expect(result.state.listIds).toBe(state.listIds);
    expect(result.state.threadAccess).toBe(state.threadAccess);
    expect(result.state.threads.warm).toBe(state.threads.warm);
    expect(state.threads.cold.turns).toHaveLength(1);
  });
  it("allows protected threads to exceed both budgets", () => {
    const ids = [
      "selected",
      "opening",
      "active",
      "running",
      "editable",
      "activating",
      "draft",
      "server-draft",
      "ephemeral",
      "unread",
      "notice",
      "metadata",
      "loading",
      "external",
    ];
    const state = setup(ids);
    state.selectedId = "selected";
    state.openingId = "opening";
    state.threads.active.status = {
      type: "active",
      activeFlags: [],
    } as typeof state.threads.active.status;
    state.threads.running.turns[0].status = "inProgress";
    state.threadAccess.editable = "editable";
    state.threadAccess.activating = "activating";
    state.localDrafts.draft = { options: {}, serverId: "server-draft" };
    state.threads.ephemeral.ephemeral = true;
    state.unreadCompleted.unread = "turn";
    state.completionNotifications.push({ id: "notice", threadId: "notice" });
    state.notificationMetadataPending.metadata = true;
    state.historyPages.loading = { cursor: "next", loading: true };
    const result = pruneHistoryCache(state, {
      maxThreads: 0,
      maxBytes: 0,
      protectedIds: new Set(["external"]),
    });
    expect(result.state).toBe(state);
    expect(result.evictedIds).toEqual([]);
  });
  it("clears scoped derived state without confusing similar thread or item IDs", () => {
    const state = setup(["a", "a-extra"]);
    state.selectedId = "a-extra";
    const a = operationKey("a", "turn", "same-item");
    const other = operationKey("a-extra", "turn", "same-item");
    state.completedItems = { [a]: true, [other]: true };
    state.startedItems = { [a]: true, [other]: true };
    state.toolProgress = { [a]: ["progress"], [other]: ["keep"] };
    state.diffs.a = { turn: "diff" };
    state.plans.a = { turn: [] };
    state.fileOutputs.a = { turn: "file" };
    state.finishedTurns.a = { turn: true };
    state.historyPages.a = { cursor: "next", loading: false };
    state.tokenUsage.a = {} as (typeof state.tokenUsage)[string];
    const { state: next } = pruneHistoryCache(state, { maxThreads: 1 });
    for (const record of [
      next.diffs,
      next.plans,
      next.fileOutputs,
      next.finishedTurns,
      next.historyPages,
      next.tokenUsage,
    ])
      expect(record.a).toBeUndefined();
    expect(next.completedItems).toEqual({ [other]: true });
    expect(next.startedItems).toEqual({ [other]: true });
    expect(next.toolProgress).toEqual({ [other]: ["keep"] });
  });
  it("keeps an idle read-only thread with an unanswered async question", () => {
    const state = setup(["question", "cold"]);
    state.threads.question.turns[0].items = [
      {
        type: "agentMessage",
        id: "prompt",
        text: "请选择",
        phase: "commentary",
        memoryCitation: null,
        delivery: null,
        questions: [{ title: "偏好", options: ["甲", "乙"] }],
      },
    ];
    const result = pruneHistoryCache(state, { maxThreads: 0, maxBytes: 0 });
    expect(result.evictedIds).toEqual(["cold"]);
    expect(result.state.threads.question).toBe(state.threads.question);
    expect(result.state.threads.question.status.type).toBe("idle");
    expect(result.state.threadAccess.question).toBe("viewing");
  });
  it("reuses byte estimates for immutable history and derived record members", () => {
    const state = setup(["cached"]);
    state.diffs.cached = { turn: "diff" };
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      pruneHistoryCache(state);
      const initialCalls = stringify.mock.calls.length;
      pruneHistoryCache(state);
      expect(stringify.mock.calls.length).toBe(initialCalls);
      state.threads.cached = {
        ...state.threads.cached,
        turns: [...state.threads.cached.turns],
      };
      pruneHistoryCache(state);
      expect(stringify.mock.calls.length).toBe(initialCalls + 1);
    } finally {
      stringify.mockRestore();
    }
    const text = "中文😀";
    expect(estimateHistoryValueBytes(text)).toBe(
      JSON.stringify(text).length * 2,
    );
  });
  it("enforces bytes independently and leaves an under-budget state unchanged", () => {
    const state = setup(["cold"]);
    expect(pruneHistoryCache(state).state).toBe(state);
    expect(pruneHistoryCache(state, { maxBytes: 1 }).evictedIds).toEqual([
      "cold",
    ]);
  });
});
