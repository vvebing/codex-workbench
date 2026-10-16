import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgentObserver,
  getAgentObserver,
} from "../../src/features/conversation/agent-observer";
import type {
  ConnectionStore,
  ConnectionState,
} from "../../src/features/connection/store";
import type { RpcNotification } from "../../src/lib/rpc";
import { placeholderThread, operationKey } from "../../src/lib/state";
import type { Thread } from "../../src/generated/v2/Thread";
import type { Turn } from "../../src/generated/v2/Turn";

const message = (text: string) => ({
  type: "agentMessage" as const,
  id: "item",
  text,
  phase: null,
  memoryCitation: null,
  delivery: null,
  questions: null,
});
const thread = (text = "base"): Thread => ({
  ...placeholderThread("child"),
  status: { type: "active", activeFlags: [] },
  turns: [
    {
      id: "turn",
      rootTurnId: null,
      items: [message(text)],
      itemsView: "full",
      status: "inProgress",
      error: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
    } as Turn,
  ],
});
function setup() {
  let connectionState = {
    status: "connected",
    epoch: 1,
    scope: 1,
  } as ConnectionState;
  const connectionListeners = new Set<() => void>();
  const notificationListeners = new Set<(event: RpcNotification) => void>();
  const pending: ((value: { thread: Thread }) => void)[] = [];
  const request = vi.fn(
    () => new Promise<{ thread: Thread }>((resolve) => pending.push(resolve)),
  );
  const connection = {
    client: {
      request,
      onNotification(callback: (event: RpcNotification) => void) {
        notificationListeners.add(callback);
        return () => notificationListeners.delete(callback);
      },
    },
    getSnapshot: () => connectionState,
    subscribe(callback: () => void) {
      connectionListeners.add(callback);
      return () => connectionListeners.delete(callback);
    },
  } as unknown as Pick<ConnectionStore, "client" | "subscribe" | "getSnapshot">;
  const observer = createAgentObserver(connection, "child", 1000);
  return {
    observer,
    connection,
    request,
    pending,
    notificationListeners,
    connectionListeners,
    emit(event: unknown) {
      notificationListeners.forEach((listener) =>
        listener(event as RpcNotification),
      );
    },
    reconnect(
      epoch: number,
      status: ConnectionState["status"] = "connected",
      scope = connectionState.scope,
    ) {
      connectionState = { ...connectionState, epoch, status, scope };
      connectionListeners.forEach((listener) => listener());
    },
  };
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
afterEach(() => vi.useRealTimers());
describe("read-only child observer", () => {
  it("tracks reasoning and image completion independently while their turn keeps running", async () => {
    const test = setup();
    const off = test.observer.subscribe(() => {});
    const reasoning = {
      type: "reasoning",
      id: "thought",
      summary: [],
      content: [],
    };
    const image = { type: "imageView", id: "image", path: "/tmp/image.png" };
    for (const item of [reasoning, image]) {
      test.emit({
        method: "item/started",
        params: { threadId: "child", turnId: "turn", item },
      });
      expect(
        test.observer.getSnapshot().conversation.startedItems[
          operationKey("child", "turn", item.id)
        ],
      ).toBe(true);
      test.emit({
        method: "item/completed",
        params: { threadId: "child", turnId: "turn", item },
      });
      expect(
        test.observer.getSnapshot().conversation.completedItems[
          operationKey("child", "turn", item.id)
        ],
      ).toBe(true);
    }
    test.pending[0]({
      thread: {
        ...placeholderThread("child"),
        ephemeral: true,
        historyMode: "paginated",
        status: { type: "active", activeFlags: [] },
      },
    });
    await flush();
    expect(test.observer.getSnapshot().thread?.turns[0].status).toBe(
      "inProgress",
    );
    for (const id of ["thought", "image"]) {
      expect(
        test.observer.getSnapshot().conversation.startedItems[
          operationKey("child", "turn", id)
        ],
      ).toBe(true);
      expect(
        test.observer.getSnapshot().conversation.completedItems[
          operationKey("child", "turn", id)
        ],
      ).toBe(true);
    }
    test.reconnect(2, "disconnected");
    expect(test.observer.getSnapshot().conversation.startedItems).toEqual({});
    expect(test.observer.getSnapshot().conversation.completedItems).toEqual({});
    off();
  });
  it("isolates inactive shared snapshots across connection epochs and scopes", async () => {
    const test = setup();
    const old = getAgentObserver(test.connection, "child");
    const off = old.subscribe(() => {});
    test.emit({
      method: "item/completed",
      params: {
        threadId: "child",
        turnId: "turn",
        item: message("old endpoint"),
      },
    });
    test.pending[0]({ thread: thread("old endpoint") });
    await flush();
    expect(
      old.getSnapshot().conversation.completedItems[
        operationKey("child", "turn", "item")
      ],
    ).toBe(true);
    off();
    expect(getAgentObserver(test.connection, "child")).toBe(old);
    test.reconnect(2);
    const nextEpoch = getAgentObserver(test.connection, "child");
    expect(nextEpoch).not.toBe(old);
    expect(nextEpoch.getSnapshot().thread).toBeUndefined();
    expect(nextEpoch.getSnapshot().conversation.completedItems).toEqual({});
    expect(getAgentObserver(test.connection, "child")).toBe(nextEpoch);
    test.reconnect(2, "connected", 3);
    const nextScope = getAgentObserver(test.connection, "child");
    expect(nextScope).not.toBe(nextEpoch);
    expect(nextScope.getSnapshot().thread).toBeUndefined();
    expect(nextScope.getSnapshot().conversation.completedItems).toEqual({});
    expect(test.request).toHaveBeenCalledTimes(1);
  });
  it("distinguishes unavailable ephemeral history while preserving streaming activity", async () => {
    const test = setup();
    const off = test.observer.subscribe(() => {});
    test.emit({
      method: "item/started",
      params: { threadId: "child", turnId: "turn", item: message("live") },
    });
    test.emit({
      method: "item/agentMessage/delta",
      params: {
        threadId: "child",
        turnId: "turn",
        itemId: "item",
        delta: " activity",
      },
    });
    test.pending[0]({
      thread: {
        ...placeholderThread("child"),
        ephemeral: true,
        historyMode: "paginated",
        status: { type: "active", activeFlags: [] },
      },
    });
    await flush();
    expect(test.observer.getSnapshot().historyUnavailable).toBe(true);
    expect(test.observer.getSnapshot().error).toBeNull();
    expect(test.observer.getSnapshot().thread?.turns[0].items[0]).toMatchObject(
      { text: "live activity" },
    );
    expect(test.request).toHaveBeenCalledTimes(1);
    test.reconnect(2, "disconnected");
    expect(test.observer.getSnapshot().historyUnavailable).toBe(false);
    expect(test.observer.getSnapshot().error).toContain("连接已断开");
    off();
  });

  it("shares one reader and notification subscription between a card and details", async () => {
    const test = setup();
    const card = getAgentObserver(test.connection, "child");
    const detail = getAgentObserver(test.connection, "child");
    expect(detail).toBe(card);
    const offCard = card.subscribe(() => {});
    const offDetail = detail.subscribe(() => {});
    expect(test.request).toHaveBeenCalledTimes(1);
    expect(test.notificationListeners.size).toBe(1);
    test.pending[0]({ thread: thread() });
    await flush();
    expect(card.getSnapshot()).toBe(detail.getSnapshot());
    offCard();
    expect(test.notificationListeners.size).toBe(1);
    offDetail();
    expect(test.notificationListeners.size).toBe(0);
  });

  it("starts lazily, reads history without a writer, and cleans up subscriptions", async () => {
    const test = setup();
    expect(test.request).not.toHaveBeenCalled();
    const off = test.observer.subscribe(() => {});
    expect(test.request).toHaveBeenCalledWith("thread/read", {
      threadId: "child",
      includeTurns: false,
    });
    test.pending[0]({ thread: thread() });
    await flush();
    expect(test.observer.getSnapshot().thread?.id).toBe("child");
    off();
    expect(test.notificationListeners.size).toBe(0);
    expect(test.connectionListeners.size).toBe(0);
  });
  it("preserves received stream deltas and terminal items against a delayed snapshot", async () => {
    const test = setup();
    const off = test.observer.subscribe(() => {});
    test.emit({
      method: "item/started",
      params: { threadId: "child", turnId: "turn", item: message("base") },
    });
    test.emit({
      method: "item/agentMessage/delta",
      params: {
        threadId: "child",
        turnId: "turn",
        itemId: "item",
        delta: " live",
      },
    });
    test.emit({
      method: "item/completed",
      params: { threadId: "child", turnId: "turn", item: message("base live") },
    });
    test.emit({
      method: "turn/completed",
      params: {
        threadId: "child",
        turn: {
          ...thread().turns[0],
          items: [message("base live")],
          status: "completed",
        },
      },
    });
    test.pending[0]({ thread: thread() });
    await flush();
    const state = test.observer.getSnapshot();
    expect(state.thread?.turns[0].items[0]).toMatchObject({
      text: "base live",
    });
    expect(state.thread?.turns[0].status).toBe("completed");
    expect(
      state.conversation.completedItems[operationKey("child", "turn", "item")],
    ).toBe(true);
    test.emit({
      method: "item/started",
      params: { threadId: "parent", turnId: "other", item: message("wrong") },
    });
    expect(test.observer.getSnapshot()).toBe(state);
    off();
  });
  it("invalidates old epoch responses and re-reads after reconnection", async () => {
    vi.useFakeTimers();
    const test = setup();
    const off = test.observer.subscribe(() => {});
    test.emit({
      method: "item/completed",
      params: { threadId: "child", turnId: "turn", item: message("old") },
    });
    test.reconnect(2, "disconnected");
    test.reconnect(2);
    expect(test.observer.getSnapshot().thread).toBeUndefined();
    expect(test.observer.getSnapshot().conversation.completedItems).toEqual({});
    test.pending[0]({ thread: thread("old epoch") });
    await flush();
    expect(test.observer.getSnapshot().thread).toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.request).toHaveBeenCalledTimes(2);
    test.pending[1]({ thread: thread("new epoch") });
    await flush();
    expect(test.observer.getSnapshot().thread?.turns[0].items[0]).toMatchObject(
      { text: "new epoch" },
    );
    off();
  });
  it("stops fallback reads for a finished thread and resumes after a live start", async () => {
    vi.useFakeTimers();
    const test = setup();
    const off = test.observer.subscribe(() => {});
    const finished = thread("done");
    finished.status = { type: "idle" };
    finished.turns[0].status = "completed";
    test.pending[0]({ thread: finished });
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(test.request).toHaveBeenCalledTimes(1);
    test.emit({
      method: "turn/started",
      params: { threadId: "child", turn: { ...thread().turns[0], id: "next" } },
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(test.request).toHaveBeenCalledTimes(2);
    off();
    test.pending[1]({ thread: thread() });
    await flush();
  });
  it("serializes fallback polling and survives StrictMode unsubscribe/resubscribe", async () => {
    vi.useFakeTimers();
    const test = setup();
    const off = test.observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(5000);
    expect(test.request).toHaveBeenCalledTimes(1);
    off();
    const secondOff = test.observer.subscribe(() => {});
    test.pending[0]({ thread: thread("stale") });
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.request).toHaveBeenCalledTimes(2);
    test.pending[1]({ thread: thread("fresh") });
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(test.request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5000);
    expect(test.request).toHaveBeenCalledTimes(3);
    secondOff();
    test.pending[2]({ thread: thread("ignored") });
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(test.request).toHaveBeenCalledTimes(3);
  });
});
