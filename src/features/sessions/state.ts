import {
  emptyState,
  placeholderThread,
  reduceNotification,
  type ConversationState,
} from "../../lib/state";
import type { RpcNotification } from "../../lib/rpc";
import type { Thread } from "../../generated/v2/Thread";
import type { ThreadStartParams } from "../../generated/v2/ThreadStartParams";

export type ThreadAccess = "viewing" | "activating" | "editable" | "occupied";
export interface SessionsState extends ConversationState {
  sections: import("../../generated/v2/ThreadSection").ThreadSection[];
  sectionsLoading: boolean;
  sectionsError: string | null;
  sectionFilter: string;
  threadSettings: Record<
    string,
    import("../../generated/v2/ThreadSettings").ThreadSettings
  >;
  threadAccess: Record<string, ThreadAccess>;
  localDrafts: Record<
    string,
    { options: ThreadStartParams; serverId?: string }
  >;
  draftOrigins: Record<string, string>;
  selectedId: string | null;
  openingId?: string | null;
  historySyncError: string | null;
  unreadCompleted: Record<string, string>;
  completionNotifications: { id: string; threadId: string }[];
  /** Child identity survives late or incomplete thread snapshots. */
  subagentThreadIds: Record<string, true>;
  /** Stream events can precede metadata identifying the owning thread. */
  notificationMetadataPending: Record<string, true>;
  listIds: string[];
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
}

export const initialState = (): SessionsState => ({
  ...emptyState(),
  sections: [],
  sectionsLoading: false,
  sectionsError: null,
  sectionFilter: "all",
  threadSettings: {},
  threadAccess: {},
  localDrafts: {},
  draftOrigins: {},
  selectedId: null,
  openingId: null,
  historySyncError: null,
  unreadCompleted: {},
  completionNotifications: [],
  subagentThreadIds: {},
  notificationMetadataPending: {},
  listIds: [],
  nextCursor: null,
  loading: false,
  error: null,
});

function omit<T>(record: Record<string, T>, id: string): Record<string, T> {
  const result = { ...record };
  delete result[id];
  return result;
}

export function createDraft(
  state: SessionsState,
  options: ThreadStartParams,
): SessionsState {
  const id = `local-draft-${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  const thread: Thread = {
    ...placeholderThread(id),
    sessionId: "",
    cwd: options.cwd ?? "",
    model: options.model ?? null,
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...state,
    localDrafts: {
      ...state.localDrafts,
      [id]: { options: structuredClone(options) },
    },
    threads: { ...state.threads, [id]: thread },
    threadAccess: { ...state.threadAccess, [id]: "viewing" },
    selectedId: id,
    error: null,
  };
}

export function removeDraft(state: SessionsState, id: string): SessionsState {
  return {
    ...state,
    localDrafts: omit(state.localDrafts, id),
    threads: omit(state.threads, id),
    threadAccess: omit(state.threadAccess, id),
    selectedId: state.selectedId === id ? null : state.selectedId,
  };
}

export function promoteDraft(
  state: SessionsState,
  id: string,
  serverId: string,
  foreground: boolean,
): SessionsState {
  const selected = state.selectedId === id;
  return {
    ...removeDraft(state, id),
    unreadCompleted:
      selected && foreground
        ? omit(state.unreadCompleted, serverId)
        : state.unreadCompleted,
    draftOrigins: { ...state.draftOrigins, [serverId]: id },
    listIds: Array.from(new Set([serverId, ...state.listIds])),
    selectedId: selected ? serverId : state.selectedId,
  };
}

export function clearCompletion(
  state: SessionsState,
  id: string,
): SessionsState {
  return {
    ...state,
    unreadCompleted: omit(state.unreadCompleted, id),
    completionNotifications: state.completionNotifications.filter(
      (notice) => notice.threadId !== id,
    ),
  };
}

export function removeThread(state: SessionsState, id: string): SessionsState {
  const completedItems = { ...state.completedItems };
  for (const turn of state.threads[id]?.turns ?? [])
    for (const item of turn.items) delete completedItems[item.id];
  return {
    ...clearCompletion(state, id),
    threads: omit(state.threads, id),
    threadSettings: omit(state.threadSettings, id),
    threadAccess: omit(state.threadAccess, id),
    diffs: omit(state.diffs, id),
    plans: omit(state.plans, id),
    tokenUsage: omit(state.tokenUsage, id),
    fileOutputs: omit(state.fileOutputs, id),
    draftOrigins: omit(state.draftOrigins, id),
    notificationMetadataPending: omit(state.notificationMetadataPending, id),
    completedItems,
    finishedTurns: omit(state.finishedTurns, id),
    listIds: state.listIds.filter((entry) => entry !== id),
    selectedId: state.selectedId === id ? null : state.selectedId,
  };
}

export function descendantIds(state: SessionsState, id: string): string[] {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const thread of Object.values(state.threads)) {
      if (
        thread.parentThreadId &&
        ids.has(thread.parentThreadId) &&
        !ids.has(thread.id)
      ) {
        ids.add(thread.id);
        changed = true;
      }
    }
  }
  return [...ids];
}
export function isSubagentThread(thread?: Thread): boolean {
  return (
    !!thread &&
    (thread.parentThreadId != null ||
      (thread.source !== null &&
        typeof thread.source === "object" &&
        ("subAgent" in thread.source || "subagent" in thread.source)))
  );
}

export function shouldNotifyThread(
  state: SessionsState,
  threadId: string,
): boolean {
  return (
    !!state.threads[threadId] &&
    !state.notificationMetadataPending[threadId] &&
    !state.subagentThreadIds[threadId] &&
    !isSubagentThread(state.threads[threadId])
  );
}

/** Apply the same child policy to streamed events and every metadata merge. */
export function reconcileNotifications(
  previous: SessionsState,
  next: SessionsState,
): SessionsState {
  let children = next.subagentThreadIds;
  const remember = (id: string) => {
    if (!children[id]) children = { ...children, [id]: true };
  };
  for (const thread of Object.values(next.threads)) {
    if (thread === previous.threads[thread.id]) continue;
    if (isSubagentThread(thread)) remember(thread.id);
    for (const turn of thread.turns)
      for (const item of turn.items) {
        if (item.type === "subAgentActivity") {
          if (item.agentThreadId !== thread.id) remember(item.agentThreadId);
        } else if (
          item.type === "collabAgentToolCall" &&
          item.tool === "spawnAgent" &&
          item.senderThreadId === thread.id
        ) {
          for (const id of new Set([
            ...item.receiverThreadIds,
            ...Object.keys(item.agentsStates),
          ]))
            if (id !== thread.id) remember(id);
        }
      }
  }
  const silent = (id: string) =>
    !!children[id] || isSubagentThread(next.threads[id]);
  return {
    ...next,
    subagentThreadIds: children,
    unreadCompleted: Object.fromEntries(
      Object.entries(next.unreadCompleted).filter(([id]) => !silent(id)),
    ),
    completionNotifications: next.completionNotifications.filter(
      (notice) => !silent(notice.threadId),
    ),
  };
}

export function sessionNotification(
  state: SessionsState,
  event: RpcNotification,
  completed: Set<string>,
  foreground: boolean,
): SessionsState {
  if (
    event.method === "thread/status/changed" &&
    event.params.status.type === "active" &&
    state.threadAccess[event.params.threadId] === "editable"
  ) {
    const thread = state.threads[event.params.threadId];
    const last = thread?.turns.at(-1);
    // Ignore a stale active event after completion; turn/started owns the next run.
    if (
      last &&
      state.finishedTurns[event.params.threadId]?.[last.id] &&
      !thread.turns.some((turn) => turn.status === "inProgress")
    )
      return state;
  }
  let next = { ...state, ...reduceNotification(state, event) };
  if (event.method === "thread/started") {
    next.notificationMetadataPending = omit(
      next.notificationMetadataPending,
      event.params.thread.id,
    );
  } else {
    for (const id of Object.keys(next.threads))
      if (!state.threads[id])
        next.notificationMetadataPending = {
          ...next.notificationMetadataPending,
          [id]: true,
        };
  }
  next = reconcileNotifications(state, next);
  if (
    event.method === "turn/completed" &&
    event.params.turn.status === "completed" &&
    !next.subagentThreadIds[event.params.threadId] &&
    !isSubagentThread(next.threads[event.params.threadId])
  ) {
    const { threadId, turn } = event.params;
    const key = JSON.stringify([threadId, turn.id]);
    if (!completed.has(key)) {
      completed.add(key);
      const selected =
        threadId === next.selectedId ||
        (next.selectedId &&
          next.localDrafts[next.selectedId]?.serverId === threadId);
      next = {
        ...next,
        unreadCompleted:
          !selected || !foreground
            ? { ...next.unreadCompleted, [threadId]: turn.id }
            : next.unreadCompleted,
        completionNotifications: [
          ...next.completionNotifications,
          { id: key, threadId },
        ],
      };
    }
  }
  if (event.method === "thread/archived")
    next = removeThread(state, event.params.threadId);
  if (event.method === "thread/deleted")
    next = descendantIds(state, event.params.threadId).reduce(
      removeThread,
      state,
    );
  if (event.method === "thread/settings/updated") {
    const { threadId, threadSettings } = event.params;
    const thread = next.threads[threadId];
    next = {
      ...next,
      threadSettings: { ...next.threadSettings, [threadId]: threadSettings },
      ...(thread
        ? {
            threads: {
              ...next.threads,
              [threadId]: {
                ...thread,
                cwd: threadSettings.cwd,
                model: threadSettings.model,
                modelProvider: threadSettings.modelProvider,
                reasoningEffort: threadSettings.effort,
              },
            },
          }
        : {}),
    };
  }
  if (event.method === "thread/closed")
    next = {
      ...next,
      threadAccess: {
        ...next.threadAccess,
        [event.params.threadId]: "viewing",
      },
    };

  return next;
}
