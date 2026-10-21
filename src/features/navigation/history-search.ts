import type { CodexClient } from "../../lib/rpc";
import type { Thread } from "../../generated/v2/Thread";
import type { ThreadListResponse } from "../../generated/v2/ThreadListResponse";
import type { ThreadReadResponse } from "../../generated/v2/ThreadReadResponse";
import { ROOT_THREAD_SOURCES } from "../sessions/list";
import { isSubagentThread } from "../sessions/state";
import { Store, errorMessage } from "../../lib/store";
import { sessionIdQuery } from "./search-results";

export type HistorySearchClient = Pick<CodexClient, "request">;

/** Dialog-owned results: searching never changes sidebar discovery or access. */
export class HistorySearch extends Store<{
  threads: Thread[];
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
}> {
  private generation = 0;
  private cursors = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private client: HistorySearchClient,
    private query: string,
    private current: () => boolean,
  ) {
    super({ threads: [], nextCursor: null, loading: true, error: null });
  }
  start(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(false), 250);
  }
  dispose(): void {
    this.generation++;
    clearTimeout(this.timer);
  }
  more(): void {
    if (!this.state.loading && this.state.nextCursor) void this.load(true);
  }
  retry(): void {
    if (!this.state.loading) void this.load(!!this.state.nextCursor);
  }
  private async load(append: boolean): Promise<void> {
    const generation = this.generation;
    if (!this.current()) return;
    if (!append) this.cursors.clear();
    this.update({ ...this.state, loading: true, error: null });
    try {
      const threadId = sessionIdQuery(this.query);
      if (threadId) {
        const { thread } = await this.client.request<ThreadReadResponse>(
          "thread/read",
          { threadId, includeTurns: false },
        );
        if (generation !== this.generation || !this.current()) return;
        const exact = [thread.id, thread.sessionId].some(
          (id) => id?.toLowerCase() === threadId,
        );
        this.update({
          threads: exact && !isSubagentThread(thread) ? [thread] : [],
          nextCursor: null,
          loading: false,
          error: null,
        });
        return;
      }
      const page = await this.client.request<ThreadListResponse>(
        "thread/list",
        {
          searchTerm: this.query,
          sourceKinds: ROOT_THREAD_SOURCES,
          limit: 50,
          sortKey: "updated_at",
          sortDirection: "desc",
          ...(append ? { cursor: this.state.nextCursor } : {}),
        },
      );
      if (generation !== this.generation || !this.current()) return;
      if (page.nextCursor && this.cursors.has(page.nextCursor)) {
        this.update({
          ...this.state,
          nextCursor: null,
          loading: false,
          error: "服务器返回了重复的分页游标，请重新搜索。",
        });
        return;
      }
      if (page.nextCursor) this.cursors.add(page.nextCursor);
      const threads = new Map(
        (append ? this.state.threads : []).map((thread) => [thread.id, thread]),
      );
      for (const thread of page.data) {
        if (!isSubagentThread(thread)) threads.set(thread.id, thread);
      }
      this.update({
        threads: [...threads.values()],
        nextCursor: page.nextCursor,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (generation !== this.generation || !this.current()) return;
      if (
        sessionIdQuery(this.query) &&
        /no such thread|thread[^\n]*(?:not found|does not exist)|会话不存在/i.test(
          errorMessage(error),
        )
      ) {
        this.update({
          threads: [],
          nextCursor: null,
          loading: false,
          error: null,
        });
        return;
      }
      this.update({
        ...this.state,
        loading: false,
        error: errorMessage(error),
      });
    }
  }
}
