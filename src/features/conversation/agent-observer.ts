import type { ConnectionStore } from "../connection/store";
import { readHistory } from "../sessions/history";
import type { Thread } from "../../generated/v2/Thread";
import {
  emptyState,
  mergeThread,
  operationKey,
  reduceNotification,
  type ConversationState,
} from "../../lib/state";
import { errorMessage } from "../../lib/store";

export interface AgentObservation {
  thread?: Thread;
  conversation: ConversationState;
  loading: boolean;
  error: string | null;
  connected: boolean;
  lastEventAt: number | null;
  historyUnavailable: boolean;
}

/** Observe only: never resume a thread or acquire its writer. Reads are a fallback
 * because app-server does not promise child notifications on every connection. */
export function createAgentObserver(
  connection: Pick<ConnectionStore, "client" | "subscribe" | "getSnapshot">,
  threadId: string,
  pollMs = 3000,
) {
  let state: AgentObservation = {
    conversation: emptyState(),
    loading: false,
    error: null,
    connected: false,
    lastEventAt: null,
    historyUnavailable: false,
  };
  const listeners = new Set<() => void>();
  let generation = 0;
  let statusVersion = 0;
  let epoch = connection.getSnapshot().epoch;
  let scope = connection.getSnapshot().scope;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: Promise<void> | undefined;
  let offConnection: (() => void) | undefined;
  let offNotification: (() => void) | undefined;
  let disposed = false;
  let restartPending = false;
  const publish = (next: AgentObservation) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const clearTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const current = (token: number) =>
    !disposed &&
    listeners.size > 0 &&
    generation === token &&
    connection.getSnapshot().epoch === epoch &&
    connection.getSnapshot().scope === scope &&
    connection.getSnapshot().status === "connected";
  const needsPolling = () =>
    !!state.error ||
    !state.thread ||
    state.thread.status.type === "active" ||
    state.thread.turns.at(-1)?.status === "inProgress";
  const schedule = (delay = pollMs, force = false) => {
    clearTimer();
    if (
      !disposed &&
      listeners.size &&
      state.connected &&
      (force || needsPolling())
    ) {
      timer = setTimeout(() => {
        timer = undefined;
        void refresh();
      }, delay);
      timer.unref?.();
    }
  };
  const refresh = (): Promise<void> => {
    if (request) return request;
    if (!current(generation)) return Promise.resolve();
    clearTimer();
    const token = generation;
    const beforeStatus = statusVersion;
    publish({ ...state, loading: true });
    request = (async () => {
      try {
        const thread = await readHistory(
          connection.client,
          threadId,
          state.thread,
          () => current(token),
          !!state.thread,
        );
        if (!current(token)) return;
        // Existing reducer preserves streamed tails and terminal notifications
        // when a history snapshot was captured before those events arrived.
        let conversation = mergeThread(state.conversation, thread);
        const live = state.thread;
        if (live) {
          const merged = conversation.threads[threadId];
          conversation = {
            ...conversation,
            threads: {
              ...conversation.threads,
              [threadId]: {
                ...merged,
                status:
                  statusVersion !== beforeStatus ? live.status : merged.status,
                turns: merged.turns.map((turn) => {
                  const old = live.turns.find((entry) => entry.id === turn.id);
                  return {
                    ...turn,
                    ...(old &&
                    state.conversation.finishedTurns[threadId]?.[turn.id]
                      ? {
                          status: old.status,
                          completedAt: old.completedAt ?? turn.completedAt,
                          durationMs: old.durationMs ?? turn.durationMs,
                          error: old.error,
                        }
                      : {}),
                    items: turn.items.map((item) =>
                      state.conversation.completedItems[
                        operationKey(threadId, turn.id, item.id)
                      ]
                        ? (old?.items.find((entry) => entry.id === item.id) ??
                          item)
                        : item,
                    ),
                  };
                }),
              },
            },
          };
        }
        publish({
          ...state,
          conversation,
          thread: conversation.threads[threadId],
          loading: false,
          error: null,
          historyUnavailable: thread.ephemeral,
        });
      } catch (error) {
        if (current(token))
          publish({ ...state, loading: false, error: errorMessage(error) });
      } finally {
        request = undefined;
        const immediate = restartPending;
        restartPending = false;
        schedule(immediate ? 0 : pollMs, immediate);
      }
    })();
    return request;
  };
  const onConnection = () => {
    const next = connection.getSnapshot();
    const connected = next.status === "connected";
    if (next.epoch !== epoch || next.scope !== scope || !connected) {
      generation++;
      epoch = next.epoch;
      scope = next.scope;
      clearTimer();
      publish({
        conversation: emptyState(),
        connected,
        loading: false,
        lastEventAt: null,
        historyUnavailable: false,
        error: connected ? null : "连接已断开，子会话详情暂不可用。",
      });
    } else if (state.connected !== connected) publish({ ...state, connected });
    if (connected) {
      if (request) restartPending = true;
      else void refresh();
    }
  };
  const stop = () => {
    generation++;
    clearTimer();
    offConnection?.();
    offNotification?.();
    offConnection = offNotification = undefined;
    restartPending = false;
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      if (disposed) return () => {};
      listeners.add(listener);
      if (listeners.size === 1) {
        offConnection = connection.subscribe(onConnection);
        offNotification = connection.client.onNotification((event) => {
          if (!current(generation)) return;
          const params = event.params as unknown as {
            threadId?: string;
            thread?: Thread;
          };
          if ((params.threadId ?? params.thread?.id) !== threadId) return;
          if (
            event.method === "thread/status/changed" ||
            event.method === "thread/started" ||
            event.method === "turn/started" ||
            event.method === "turn/completed"
          )
            statusVersion++;
          const conversation = reduceNotification(state.conversation, event);
          publish({
            ...state,
            conversation,
            thread: conversation.threads[threadId],
            lastEventAt: Date.now(),
          });
          if (event.method === "item/started" && !needsPolling()) {
            if (request) restartPending = true;
            else schedule(0, true);
          } else if (!needsPolling()) clearTimer();
          else if (!timer && !request) schedule();
        });
        onConnection();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) stop();
      };
    },
    refresh,
    dispose() {
      disposed = true;
      stop();
      listeners.clear();
    },
  };
}

const agentObservers = new WeakMap<
  Pick<ConnectionStore, "client" | "subscribe" | "getSnapshot">,
  {
    epoch: number;
    scope: number;
    observers: Map<string, ReturnType<typeof createAgentObserver>>;
  }
>();

/** Cards and details share one reader and one live notification listener.
 * Subscribers own its lifetime; callers should unsubscribe rather than dispose. */
export function getAgentObserver(
  connection: Pick<ConnectionStore, "client" | "subscribe" | "getSnapshot">,
  threadId: string,
) {
  const { epoch, scope } = connection.getSnapshot();
  let registry = agentObservers.get(connection);
  if (!registry || registry.epoch !== epoch || registry.scope !== scope) {
    registry = { epoch, scope, observers: new Map() };
    agentObservers.set(connection, registry);
  }
  const threads = registry.observers;
  let observer = threads.get(threadId);
  if (!observer) {
    observer = createAgentObserver(connection, threadId);
    threads.set(threadId, observer);
  }
  return observer;
}
