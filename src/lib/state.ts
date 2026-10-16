import type { HydratedThread } from "../features/sessions/history";
import type { Thread } from "../generated/v2/Thread";
import type { TurnPlanStep } from "../generated/v2/TurnPlanStep";
import type { Turn } from "../generated/v2/Turn";
import type { ThreadItem } from "../generated/v2/ThreadItem";
import type { ThreadTokenUsage } from "../generated/v2/ThreadTokenUsage";
import type { RpcNotification } from "./rpc";

export type ConversationState = {
  threads: Record<string, Thread>;
  tokenUsage: Record<string, ThreadTokenUsage>;
  /** Live results isolated by thread ID and turn ID. */
  diffs: Record<string, Record<string, string>>;
  fileOutputs: Record<string, Record<string, string>>;
  completedItems: Record<string, boolean>;
  /** Items with observed live starts or streaming activity, never inferred from snapshots. */
  startedItems: Record<string, boolean>;
  /** Recent MCP progress messages, isolated by thread, turn, and item. */
  toolProgress: Record<string, string[]>;
  /** Terminal notifications remain authoritative when legacy timing is absent. */
  finishedTurns: Record<string, Record<string, true>>;
  plans: Record<string, Record<string, TurnPlanStep[]>>;
};
export const emptyState = (): ConversationState => ({
  threads: {},
  tokenUsage: {},
  diffs: {},
  plans: {},
  fileOutputs: {},
  completedItems: {},
  startedItems: {},
  toolProgress: {},
  finishedTurns: {},
});

export function operationKey(
  threadId: string,
  turnId: string,
  itemId: string,
): string {
  return JSON.stringify([threadId, turnId, itemId]);
}

export function placeholderThread(id: string): Thread {
  // Events can arrive before the start/resume response supplies thread metadata.
  return {
    id,
    name: null,
    preview: "",
    cwd: "",
    turns: [],
    createdAt: 0,
    updatedAt: 0,
    status: { type: "idle" },
    model: null,
    reasoningEffort: null,
    sessionId: id,
    forkedFromId: null,
    parentThreadId: null,
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    historyMode: "legacy",
    modelProvider: "",
    recencyAt: null,
    path: null,
    cliVersion: "",
    originator: null,
    source: "unknown",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
  };
}
function placeholderTurn(id: string): Turn {
  return {
    id,
    rootTurnId: null,
    items: [],
    itemsView: "full",
    status: "inProgress",
    error: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
  };
}
function mergeItems(
  current: ThreadItem[],
  incoming: ThreadItem[],
  history = false,
): ThreadItem[] {
  const result = history
    ? [
        ...incoming.map(
          (item) => current.find((old) => old.id === item.id) ?? item,
        ),
        ...current.filter(
          (item) => !incoming.some((next) => next.id === item.id),
        ),
      ]
    : [...current];
  for (const item of incoming) {
    const index = result.findIndex((old) => old.id === item.id);
    if (index < 0) {
      result.push(item);
      continue;
    }
    const old = result[index];
    // An in-flight resume snapshot may precede already received stream deltas.
    if (
      (old.type === "agentMessage" && item.type === "agentMessage") ||
      (old.type === "plan" && item.type === "plan")
    ) {
      result[index] = {
        ...item,
        text: old.text.startsWith(item.text) ? old.text : item.text,
      };
    } else if (
      old.type === "commandExecution" &&
      item.type === "commandExecution"
    ) {
      const output = old.aggregatedOutput ?? "";
      result[index] = {
        ...item,
        status:
          old.status !== "inProgress" && item.status === "inProgress"
            ? old.status
            : item.status,
        aggregatedOutput: output.startsWith(item.aggregatedOutput ?? "")
          ? old.aggregatedOutput
          : item.aggregatedOutput,
      };
    } else if (old.type === "reasoning" && item.type === "reasoning") {
      const mergeParts = (previous: string[], next: string[]) =>
        Array.from(
          { length: Math.max(previous.length, next.length) },
          (_, index) =>
            (previous[index] ?? "").startsWith(next[index] ?? "")
              ? previous[index]
              : next[index],
        );
      result[index] = {
        ...item,
        summary: mergeParts(old.summary, item.summary),
        content: mergeParts(old.content, item.content),
      };
    } else if (old.type === "fileChange" && item.type === "fileChange") {
      result[index] = {
        ...item,
        status:
          old.status !== "inProgress" && item.status === "inProgress"
            ? old.status
            : item.status,
      };
    } else result[index] = item;
  }
  return result;
}
function mergeTurnStatus(
  old: Turn,
  incoming: Turn,
  confirmed = false,
): Turn["status"] {
  if (old.status === "inProgress" || incoming.status !== "inProgress")
    return incoming.status;
  return !confirmed &&
    old.status === "interrupted" &&
    old.completedAt == null &&
    !old.error
    ? incoming.status
    : old.status;
}

function mergeTurns(
  current: Turn[],
  incoming: Turn[],
  finished: Record<string, true> = {},
): Turn[] {
  const cached = new Map(current.map((turn) => [turn.id, turn]));
  const incomingIds = new Set(incoming.map((turn) => turn.id));
  const anchor = incoming.find((turn) => cached.has(turn.id));
  const prefixEnd = anchor
    ? current.findIndex((turn) => turn.id === anchor.id)
    : 0;
  const merged = incoming.map((turn) => {
    const old = cached.get(turn.id);
    if (!old) return turn;
    return {
      ...old,
      ...turn,
      status: mergeTurnStatus(old, turn, finished[turn.id]),
      items: mergeItems(old.items, turn.items, true),
    };
  });
  // Incremental reads start at a known turn; full reads may start before all
  // cached turns. Keep both the cached prefix and newer streamed tail in order.
  return [
    ...current.slice(0, prefixEnd).filter((turn) => !incomingIds.has(turn.id)),
    ...merged,
    ...current.slice(prefixEnd).filter((turn) => !incomingIds.has(turn.id)),
  ];
}

/** Hydrate history without discarding notifications received during the request. */
export function mergeThread(
  state: ConversationState,
  thread: HydratedThread,
  preserveUpdatedAt = false,
): ConversationState {
  const { itemLifecycles, ...threadSnapshot } = thread;
  const startedItems = { ...state.startedItems };
  const completedItems = { ...state.completedItems };
  for (const [key, timing] of Object.entries(itemLifecycles ?? {})) {
    // Null timings in older snapshots cannot revoke a live completion.
    if (timing.startedAtMs != null) startedItems[key] = true;
    if (timing.completedAtMs != null) completedItems[key] = true;
  }
  const old = state.threads[thread.id];
  const turns = mergeTurns(
    old?.turns ?? [],
    thread.turns ?? [],
    state.finishedTurns[thread.id],
  );
  const activityAt = Math.max(
    0,
    ...turns.flatMap((turn) => [turn.startedAt ?? 0, turn.completedAt ?? 0]),
  );
  return {
    ...state,
    startedItems,
    completedItems,
    threads: {
      ...state.threads,
      [thread.id]: {
        ...old,
        ...threadSnapshot,
        turns,
        updatedAt: Math.max(
          old?.updatedAt ?? 0,
          activityAt,
          preserveUpdatedAt
            ? (old?.updatedAt ?? thread.updatedAt)
            : thread.updatedAt,
        ),
      },
    },
  };
}
function updateTurn(
  state: ConversationState,
  threadId: string,
  turnId: string,
  update: (turn: Turn) => Turn,
): ConversationState {
  const thread = state.threads[threadId] ?? placeholderThread(threadId);
  const index = thread.turns.findIndex((turn) => turn.id === turnId);
  const turns = [...thread.turns];
  const turn = update(index < 0 ? placeholderTurn(turnId) : turns[index]);
  if (index < 0) turns.push(turn);
  else turns[index] = turn;
  return {
    ...state,
    threads: {
      ...state.threads,
      [threadId]: {
        ...thread,
        turns,
        updatedAt: Math.max(
          thread.updatedAt,
          ...turns.flatMap((turn) => [
            turn.startedAt ?? 0,
            turn.completedAt ?? 0,
          ]),
        ),
      },
    },
  };
}
function updateItem(
  state: ConversationState,
  threadId: string,
  turnId: string,
  itemId: string,
  update: (item: ThreadItem | undefined) => ThreadItem,
): ConversationState {
  return updateTurn(state, threadId, turnId, (turn) => {
    const items = [...turn.items];
    const index = items.findIndex((item) => item.id === itemId);
    const item = update(index < 0 ? undefined : items[index]);
    if (index < 0) items.push(item);
    else items[index] = item;
    return { ...turn, items };
  });
}

export function reduceNotification(
  state: ConversationState,
  event: RpcNotification,
): ConversationState {
  if (
    event.method === "item/started" &&
    state.completedItems[
      JSON.stringify([
        event.params.threadId,
        event.params.turnId,
        event.params.item.id,
      ])
    ]
  )
    return state;
  if (event.method === "item/completed")
    state = {
      ...state,
      completedItems: {
        ...state.completedItems,
        [JSON.stringify([
          event.params.threadId,
          event.params.turnId,
          event.params.item.id,
        ])]: true,
      },
    };
  const startKey =
    event.method === "item/started"
      ? operationKey(
          event.params.threadId,
          event.params.turnId,
          event.params.item.id,
        )
      : event.method.startsWith("item/") &&
          "threadId" in event.params &&
          "turnId" in event.params &&
          "itemId" in event.params &&
          (event.method.endsWith("Delta") ||
            event.method.endsWith("/delta") ||
            event.method === "item/reasoning/summaryPartAdded" ||
            event.method === "item/mcpToolCall/progress")
        ? operationKey(
            event.params.threadId,
            event.params.turnId,
            event.params.itemId,
          )
        : undefined;
  if (startKey && !state.completedItems[startKey])
    state = {
      ...state,
      startedItems: { ...state.startedItems, [startKey]: true },
    };
  switch (event.method) {
    case "error":
      return updateTurn(
        state,
        event.params.threadId,
        event.params.turnId,
        (turn) => ({
          ...turn,
          error: event.params.willRetry ? null : event.params.error,
        }),
      );
    case "thread/tokenUsage/updated":
      return {
        ...state,
        tokenUsage: {
          ...state.tokenUsage,
          [event.params.threadId]: event.params.tokenUsage,
        },
      };
    case "thread/started":
      return mergeThread(state, event.params.thread);
    case "thread/status/changed": {
      const { threadId, status } = event.params;
      const thread = state.threads[threadId] ?? placeholderThread(threadId);
      return {
        ...state,
        threads: { ...state.threads, [threadId]: { ...thread, status } },
      };
    }
    case "thread/name/updated": {
      const { threadId, threadName } = event.params;
      const thread = state.threads[threadId];
      return thread
        ? {
            ...state,
            threads: {
              ...state.threads,
              [threadId]: { ...thread, name: threadName ?? null },
            },
          }
        : state;
    }
    case "thread/archived": {
      const threads = { ...state.threads };
      const diffs = { ...state.diffs };
      const plans = { ...state.plans };
      const tokenUsage = { ...state.tokenUsage };
      const finishedTurns = { ...state.finishedTurns };
      const toolProgress = Object.fromEntries(
        Object.entries(state.toolProgress).filter(
          ([key]) => (JSON.parse(key) as string[])[0] !== event.params.threadId,
        ),
      );
      const retainOtherThreads = (items: Record<string, boolean>) =>
        Object.fromEntries(
          Object.entries(items).filter(
            ([key]) =>
              (JSON.parse(key) as string[])[0] !== event.params.threadId,
          ),
        );
      const startedItems = retainOtherThreads(state.startedItems);
      const completedItems = retainOtherThreads(state.completedItems);
      delete finishedTurns[event.params.threadId];
      delete threads[event.params.threadId];
      delete diffs[event.params.threadId];
      delete plans[event.params.threadId];
      delete tokenUsage[event.params.threadId];
      return {
        ...state,
        threads,
        diffs,
        plans,
        tokenUsage,
        finishedTurns,
        startedItems,
        completedItems,
        toolProgress,
      };
    }
    case "turn/started":
    case "turn/completed": {
      const { threadId, turn } = event.params;
      let next = updateTurn(state, threadId, turn.id, (old) => ({
        ...old,
        ...turn,
        status: mergeTurnStatus(
          old,
          turn,
          state.finishedTurns[threadId]?.[turn.id],
        ),
        items: mergeItems(old.items, turn.items),
      }));
      if (event.method === "turn/completed" && turn.status !== "inProgress")
        next = {
          ...next,
          finishedTurns: {
            ...next.finishedTurns,
            [threadId]: { ...next.finishedTurns[threadId], [turn.id]: true },
          },
        };
      const thread = next.threads[threadId];
      if (
        event.method === "turn/started" &&
        thread.turns.some((candidate) => candidate.status === "inProgress")
      )
        return {
          ...next,
          threads: {
            ...next.threads,
            [threadId]: {
              ...thread,
              status: { type: "active", activeFlags: [] },
            },
          },
        };
      if (
        event.method === "turn/completed" &&
        thread.status.type === "active" &&
        !thread.turns.some((candidate) => candidate.status === "inProgress")
      ) {
        return {
          ...next,
          threads: {
            ...next.threads,
            [threadId]: { ...thread, status: { type: "idle" } },
          },
        };
      }
      return next;
    }
    case "item/started":
    case "item/completed": {
      const { threadId, turnId, item } = event.params;
      return updateItem(state, threadId, turnId, item.id, (old) =>
        event.method === "item/completed" || !old
          ? item
          : mergeItems([old], [item])[0],
      );
    }
    case "item/agentMessage/delta":
    case "item/plan/delta": {
      const { threadId, turnId, itemId, delta } = event.params;
      const type = event.method === "item/plan/delta" ? "plan" : "agentMessage";
      return updateItem(state, threadId, turnId, itemId, (old) => {
        const item =
          old?.type === type
            ? old
            : {
                type,
                id: itemId,
                text: "",
                phase: null,
                memoryCitation: null,
                delivery: null,
                questions: null,
              };
        return { ...item, text: item.text + delta } as ThreadItem;
      });
    }
    case "item/commandExecution/outputDelta": {
      const { threadId, turnId, itemId, delta } = event.params;
      return updateItem(state, threadId, turnId, itemId, (old) => {
        const item =
          old?.type === "commandExecution"
            ? old
            : {
                type: "commandExecution" as const,
                id: itemId,
                command: "",
                cwd: "",
                status: "inProgress" as const,
                aggregatedOutput: "",
                commandActions: [],
                pluginId: null,
                scriptPath: null,
                processId: null,
                source: "agent" as const,
                exitCode: null,
                durationMs: null,
              };
        return {
          ...item,
          aggregatedOutput: (item.aggregatedOutput ?? "") + delta,
        };
      });
    }
    case "item/reasoning/summaryPartAdded":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta": {
      const params = event.params;
      return updateItem(
        state,
        params.threadId,
        params.turnId,
        params.itemId,
        (old) => {
          const item =
            old?.type === "reasoning"
              ? old
              : {
                  type: "reasoning" as const,
                  id: params.itemId,
                  summary: [],
                  content: [],
                };
          const field =
            event.method === "item/reasoning/textDelta" ? "content" : "summary";
          const index =
            "contentIndex" in params
              ? params.contentIndex
              : params.summaryIndex;
          const values = [...item[field]];
          while (values.length <= index) values.push("");
          if ("delta" in params) values[index] += params.delta;
          return { ...item, [field]: values };
        },
      );
    }
    case "item/mcpToolCall/progress": {
      const { threadId, turnId, itemId, message } = event.params;
      const key = operationKey(threadId, turnId, itemId);
      return {
        ...state,
        toolProgress: {
          ...state.toolProgress,
          [key]: [...(state.toolProgress[key] ?? []), message].slice(-100),
        },
      };
    }
    case "item/fileChange/outputDelta": {
      const { threadId, itemId, delta } = event.params;
      const outputs = state.fileOutputs[threadId] ?? {};
      return {
        ...state,
        fileOutputs: {
          ...state.fileOutputs,
          [threadId]: { ...outputs, [itemId]: (outputs[itemId] ?? "") + delta },
        },
      };
    }
    case "item/fileChange/patchUpdated": {
      const { threadId, turnId, itemId, changes } = event.params;
      return updateItem(state, threadId, turnId, itemId, (old) =>
        old?.type === "fileChange"
          ? { ...old, changes }
          : { type: "fileChange", id: itemId, status: "inProgress", changes },
      );
    }
    case "turn/diff/updated":
      return {
        ...state,
        diffs: {
          ...state.diffs,
          [event.params.threadId]: {
            ...state.diffs[event.params.threadId],
            [event.params.turnId]: event.params.diff,
          },
        },
      };
    case "turn/plan/updated":
      return {
        ...state,
        plans: {
          ...state.plans,
          [event.params.threadId]: {
            ...state.plans[event.params.threadId],
            [event.params.turnId]: event.params.plan,
          },
        },
      };
    default:
      return state;
  }
}
