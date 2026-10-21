import { pendingAsyncQuestions } from "../conversation/async-questions";
import type { SessionsState } from "./state";

export interface HistoryCacheOptions {
  protectedIds?: ReadonlySet<string>;
  touched?: ReadonlyMap<string, number>;
  maxThreads?: number;
  maxBytes?: number;
}
const threadRecords = [
  "diffs",
  "plans",
  "fileOutputs",
  "tokenUsage",
  "finishedTurns",
  "historyPages",
] as const;
const operationRecords = [
  "completedItems",
  "startedItems",
  "toolProgress",
] as const;

// Immutable store members retain identity across navigation. Weak keys avoid
// retaining evicted histories; changed streaming arrays get fresh estimates.
const byteEstimates = new WeakMap<object, number>();
export function estimateHistoryValueBytes(value: unknown): number {
  if (value === undefined) return 0;
  if (value !== null && typeof value === "object") {
    const cached = byteEstimates.get(value);
    if (cached !== undefined) return cached;
    const bytes = JSON.stringify(value).length * 2;
    byteEstimates.set(value, bytes);
    return bytes;
  }
  return JSON.stringify(value).length * 2;
}

function owner(key: string): string | undefined {
  try {
    const value: unknown = JSON.parse(key);
    return Array.isArray(value) && typeof value[0] === "string"
      ? value[0]
      : undefined;
  } catch {
    return undefined;
  }
}

/** Called at navigation boundaries, never for streamed tokens. Budgets are soft:
 * pending interactions, live threads and drafts always take priority over size. */
export function pruneHistoryCache(
  state: SessionsState,
  options: HistoryCacheOptions = {},
): { state: SessionsState; evictedIds: string[] } {
  const maxThreads = Math.max(0, options.maxThreads ?? 20);
  const maxBytes = Math.max(0, options.maxBytes ?? 32 * 1024 * 1024);
  const operations = new Map<string, Record<string, unknown>>();
  for (const field of operationRecords) {
    for (const [key, value] of Object.entries(state[field])) {
      const id = owner(key);
      if (!id) continue;
      const entries = operations.get(id) ?? {};
      entries[`${field}:${key}`] = value;
      operations.set(id, entries);
    }
  }
  const draftIds = new Set(
    Object.entries(state.localDrafts).flatMap(([id, draft]) =>
      draft.serverId ? [id, draft.serverId] : [id],
    ),
  );
  const notices = new Set(
    state.completionNotifications.map((notice) => notice.threadId),
  );
  const candidates = Object.values(state.threads).flatMap((thread) => {
    const id = thread.id;
    // Include fixed envelope overhead rather than reserializing a combined
    // payload: each stable turns/derived-record member is measured just once.
    let bytes = 256 + estimateHistoryValueBytes(thread.turns);
    bytes += estimateHistoryValueBytes(operations.get(id));
    for (const field of threadRecords)
      bytes += estimateHistoryValueBytes(state[field][id]);
    const hasBody =
      thread.turns.length > 0 ||
      operations.has(id) ||
      threadRecords.some((field) => state[field][id] !== undefined);
    if (!hasBody) return [];
    const protectedThread =
      options.protectedIds?.has(id) ||
      id === state.selectedId ||
      id === state.openingId ||
      thread.status.type === "active" ||
      thread.turns.some((turn) => turn.status === "inProgress") ||
      state.threadAccess[id] === "editable" ||
      state.threadAccess[id] === "activating" ||
      draftIds.has(id) ||
      thread.ephemeral ||
      state.unreadCompleted[id] !== undefined ||
      notices.has(id) ||
      state.notificationMetadataPending[id] ||
      state.historyPages[id]?.loading ||
      pendingAsyncQuestions(thread).length > 0;
    return [
      {
        id,
        protectedThread,
        bytes,
        touched: options.touched?.get(id) ?? 0,
      },
    ];
  });
  let count = candidates.length;
  let bytes = candidates.reduce((sum, entry) => sum + entry.bytes, 0);
  const evictedIds: string[] = [];
  for (const entry of candidates
    .filter((entry) => !entry.protectedThread)
    .sort((a, b) => a.touched - b.touched || a.id.localeCompare(b.id))) {
    if (count <= maxThreads && bytes <= maxBytes) break;
    evictedIds.push(entry.id);
    count--;
    bytes -= entry.bytes;
  }
  if (!evictedIds.length) return { state, evictedIds };
  const evicted = new Set(evictedIds);
  const next = { ...state, threads: { ...state.threads } };
  for (const id of evictedIds)
    next.threads[id] = { ...state.threads[id], turns: [] };
  for (const field of threadRecords) {
    next[field] = Object.fromEntries(
      Object.entries(state[field]).filter(([id]) => !evicted.has(id)),
    ) as never;
  }
  for (const field of operationRecords) {
    next[field] = Object.fromEntries(
      Object.entries(state[field]).filter(
        ([key]) => !evicted.has(owner(key) ?? ""),
      ),
    ) as never;
  }
  return { state: next, evictedIds };
}
