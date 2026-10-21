import type { Thread } from "../../generated/v2/Thread";
import type { Turn } from "../../generated/v2/Turn";
import type { ThreadItemEntry } from "../../generated/v2/ThreadItemEntry";
import { operationKey } from "../../lib/state";
import { type CodexClient, type RpcCall } from "../../lib/rpc";

export type HydratedThread = Thread & {
  itemLifecycles?: Record<
    string,
    { startedAtMs: number | null; completedAtMs: number | null }
  >;
};

/** Read protocol history without acquiring a writer or changing session state. */
export async function readHistory(
  client: CodexClient,
  id: string,
  cached: Thread | undefined,
  current: () => boolean,
  incremental = false,
  metadata?: Thread,
  window?: { cursor: string | null; next: (cursor: string | null) => void },
): Promise<HydratedThread> {
  const check = () => {
    if (!current()) throw new Error("连接已改变，请重新操作。");
  };
  let thread =
    metadata ??
    (
      await client.request<{ thread: Thread }>("thread/read", {
        threadId: id,
        includeTurns: false,
      })
    ).thread;
  check();
  if (thread.ephemeral)
    return { ...thread, turns: cached?.turns ?? thread.turns };
  if (thread.historyMode !== "paginated") {
    // Resume responses and older servers may already supply legacy history.
    // Only legacy threads need the full-history compatibility request.
    if (!thread.turns.length) {
      thread = (
        await client.request<{ thread: Thread }>("thread/read", {
          threadId: id,
          includeTurns: true,
        })
      ).thread;
      check();
    }
    return thread;
  }

  const anchor = incremental ? cached?.turns.at(-1)?.id : undefined;
  let nextCursor: string | null = null;
  const turns = window
    ? await (async () => {
        const page = await client.request<{
          data: Turn[];
          nextCursor: string | null;
        }>("thread/turns/list", {
          threadId: id,
          limit: 30,
          sortDirection: "desc",
          itemsView: "full",
          cursor: window.cursor,
        });
        check();
        if (page.nextCursor && page.nextCursor === window.cursor)
          throw new Error("历史分页异常，请重试。");
        nextCursor = page.nextCursor;
        return page.data;
      })()
    : await pages<Turn>(
        client,
        [
          "thread/turns/list",
          {
            threadId: id,
            limit: incremental ? 50 : 100,
            sortDirection: incremental ? "desc" : "asc",
            itemsView: "full",
          },
        ],
        check,
        (data) => !!anchor && data.some((turn) => turn.id === anchor),
      );
  const itemLifecycles: NonNullable<HydratedThread["itemLifecycles"]> = {};
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index];
    const needsLifecycle =
      turn.status === "inProgress" &&
      turn.items.some(
        (item) =>
          !("status" in item) &&
          item.type !== "userMessage" &&
          item.type !== "agentMessage",
      );
    if (turn.itemsView === "full" && !needsLifecycle) continue;
    const items = await pages<ThreadItemEntry>(
      client,
      [
        "thread/items/list",
        {
          threadId: id,
          turnId: turn.id,
          limit: 100,
          sortDirection: "asc",
        },
      ],
      check,
    );
    for (const entry of items) {
      itemLifecycles[operationKey(id, turn.id, entry.item.id)] = {
        startedAtMs: entry.startedAtMs ?? null,
        completedAtMs: entry.completedAtMs ?? null,
      };
    }
    const entries = new Map(items.map((entry) => [entry.item.id, entry.item]));
    turns[index] = {
      ...turn,
      items:
        turn.itemsView === "full"
          ? [
              ...turn.items.map((item) => entries.get(item.id) ?? item),
              ...items
                .filter(
                  (entry) =>
                    !turn.items.some((item) => item.id === entry.item.id),
                )
                .map((entry) => entry.item),
            ]
          : items.map((entry) => entry.item),
      itemsView: "full",
    };
  }
  window?.next(nextCursor);
  return {
    ...thread,
    turns: incremental || window ? turns.reverse() : turns,
    itemLifecycles,
  };
}

async function pages<T>(
  client: CodexClient,
  [method, params]: RpcCall<"thread/turns/list" | "thread/items/list">,
  check: () => void,
  stop: (data: T[]) => boolean = () => false,
): Promise<T[]> {
  const result: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: { data: T[]; nextCursor: string | null } = await client.request(
      ...(method === "thread/turns/list"
        ? ([method, { ...params, cursor }] as const)
        : ([method, { ...params, cursor }] as const)),
    );
    check();
    result.push(...page.data);
    cursor = stop(page.data) ? null : page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("历史分页异常，请重试。");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return result;
}
