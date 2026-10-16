import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ChevronDown,
  Folder,
  RefreshCw,
  RotateCcw,
  Search,
} from "lucide-react";
import { Button, SelectField } from "../../components/ui";
import { folderOf, titleOf, useStore } from "../../components/hooks";
import type { Environment } from "../connection/environments";
import type { Thread } from "../../generated/v2/Thread";
import type { ThreadSortKey } from "../../generated/v2/ThreadSortKey";

type Page = { data: Thread[]; nextCursor: string | null };
const date = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export function ArchivedThreads({
  environment,
  onRestored,
}: {
  environment: Environment;
  onRestored: (id: string) => void;
}) {
  const runtime = environment.runtime;
  const connection = useStore(runtime.connection);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ThreadSortKey>("updated_at");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const lock = useRef(false);
  const seenCursors = useRef(new Set<string>());
  const connected = connection.status === "connected";
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const current = ++generation.current;
    setThreads([]);
    setCursor(null);
    setError("");
    setRestoring(null);
    seenCursors.current.clear();
    lock.current = connected;
    setBusy(connected);
    if (!connected) return;
    void runtime.connection.client
      .request<Page>("thread/list", {
        archived: true,
        limit: 30,
        sortKey: sort,
        ...(search ? { searchTerm: search } : {}),
      })
      .then((page) => {
        if (generation.current !== current) return;
        setThreads(page.data);
        setCursor(page.nextCursor);
        if (page.nextCursor) seenCursors.current.add(page.nextCursor);
      })
      .catch((e: unknown) => {
        if (generation.current === current)
          setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (generation.current === current) {
          lock.current = false;
          setBusy(false);
        }
      });
    return () => {
      generation.current = current + 1;
    };
  }, [runtime, connection.epoch, connected, search, sort, revision]);
  async function action(task: (current: number) => Promise<void>) {
    if (lock.current || !connected) return;
    lock.current = true;
    const current = generation.current;
    setBusy(true);
    setError("");
    try {
      await task(current);
    } catch (e) {
      if (generation.current === current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (generation.current === current) {
        lock.current = false;
        setBusy(false);
        setRestoring(null);
      }
    }
  }
  const groups = new Map<string, Thread[]>();
  for (const thread of threads) {
    const group = groups.get(thread.cwd) ?? [];
    group.push(thread);
    groups.set(thread.cwd, group);
  }
  return (
    <div className="min-w-0">
      <div className="mb-4 flex items-center gap-2 max-[550px]:flex-wrap">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-elevated px-3 text-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent max-[550px]:basis-full">
          <Search size={16} />
          <input
            className="min-w-0 w-full border-0 bg-transparent py-2 outline-none"
            type="search"
            aria-label="搜索已归档会话"
            placeholder="搜索会话名称"
            value={query}
            disabled={!!restoring}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <SelectField
          label="归档会话排序"
          value={sort}
          disabled={!!restoring}
          onValueChange={(value) => setSort(value as ThreadSortKey)}
          options={[
            { value: "updated_at", label: "最近更新" },
            { value: "created_at", label: "创建时间" },
          ]}
        />
        <button
          type="button"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-foreground max-[900px]:size-10"
          title="刷新归档会话"
          aria-label="刷新归档会话"
          disabled={!connected || busy}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {!connected && (
        <div className="mt-6 flex flex-col items-center rounded-xl border border-dashed border-border bg-surface px-4 py-8 text-center text-muted">
          <Archive size={30} strokeWidth={1.5} />
          <h4 className="mt-4 mb-2 text-sm text-foreground">先连接工作环境</h4>
          <p className="text-xs leading-relaxed">
            连接 {environment.name} 后查看已归档会话。
          </p>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-danger/25 bg-danger-soft p-4 text-xs text-danger [overflow-wrap:anywhere]"
        >
          <p className="mb-2">{error}</p>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !connected}
            onClick={() => setRevision((value) => value + 1)}
          >
            重新加载
          </Button>
        </div>
      )}
      {connected && threads.length > 0 && (
        <p className="mb-3 text-xs text-muted">
          {groups.size} 个工作区 · 已加载 {threads.length} 个会话
          {cursor ? "，还有更多" : ""}
        </p>
      )}
      {[...groups].map(([cwd, entries]) => (
        <details
          data-slot="archive-group"
          className="group mb-4 overflow-hidden rounded-xl border border-border bg-elevated"
          key={cwd}
          open
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 bg-surface p-4 [&::-webkit-details-marker]:hidden max-[550px]:p-3">
            <ChevronDown
              size={15}
              className="-rotate-90 transition-transform group-open:rotate-0"
            />
            <Folder size={17} />
            <span className="min-w-0 flex-1">
              <strong className="block text-[13px] [overflow-wrap:anywhere]">
                {folderOf(cwd)}
              </strong>
              <small
                className="mt-1 block text-[11px] text-muted [overflow-wrap:anywhere]"
                title={cwd}
              >
                {cwd || "未指定工作区"}
              </small>
            </span>
            <span className="rounded-lg bg-hover px-2 py-1 text-[11px] text-muted">
              {entries.length}
            </span>
          </summary>
          <div>
            {entries.map((thread) => (
              <div
                data-slot="archive-thread"
                className="flex items-center gap-4 border-t border-border p-4 max-[550px]:gap-2 max-[550px]:p-3"
                key={thread.id}
              >
                <div className="min-w-0 flex-1">
                  <strong className="block text-[13px] font-medium leading-relaxed [overflow-wrap:anywhere]">
                    {titleOf(thread)}
                  </strong>
                  <time
                    className="mt-1 block text-[11px] text-muted"
                    dateTime={new Date(
                      (sort === "created_at"
                        ? thread.createdAt
                        : thread.updatedAt) * 1000,
                    ).toISOString()}
                  >
                    {sort === "created_at" ? "创建于" : "更新于"}{" "}
                    {date(
                      sort === "created_at"
                        ? thread.createdAt
                        : thread.updatedAt,
                    )}
                  </time>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  aria-label={`恢复 ${titleOf(thread)}`}
                  disabled={busy || !connected}
                  onClick={() =>
                    void action(async (current) => {
                      setRestoring(thread.id);
                      await runtime.connection.client.request(
                        "thread/unarchive",
                        { threadId: thread.id },
                      );
                      if (generation.current !== current) return;
                      await runtime.sessions.refresh();
                      if (generation.current !== current) return;
                      await runtime.sessions.open(thread.id);
                      if (generation.current !== current) return;
                      onRestored(environment.id);
                    })
                  }
                >
                  <RotateCcw size={14} />
                  {restoring === thread.id ? "正在恢复…" : "恢复"}
                </Button>
              </div>
            ))}
          </div>
        </details>
      ))}
      {connected && !threads.length && !busy && !error && (
        <div className="mt-6 flex flex-col items-center rounded-xl border border-dashed border-border bg-surface px-4 py-8 text-center text-muted">
          <Archive size={30} strokeWidth={1.5} />
          <h4 className="mt-4 mb-2 text-sm text-foreground">
            {search ? "没有匹配的会话" : "还没有归档的会话"}
          </h4>
          <p className="text-xs leading-relaxed">
            {search
              ? "试试其他会话名称。"
              : "归档后的会话会按工作区显示在这里。"}
          </p>
        </div>
      )}
      {busy && (
        <p role="status" className="py-4 text-center text-xs text-muted">
          {restoring ? "正在恢复会话…" : "正在加载归档会话…"}
        </p>
      )}
      {cursor && (
        <button
          type="button"
          className="mx-auto mt-6 flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2 text-xs font-medium hover:bg-hover max-[900px]:min-h-[42px]"
          disabled={busy || !connected}
          onClick={() =>
            void action(async (current) => {
              const page = await runtime.connection.client.request<Page>(
                "thread/list",
                {
                  archived: true,
                  limit: 30,
                  sortKey: sort,
                  cursor,
                  ...(search ? { searchTerm: search } : {}),
                },
              );
              if (generation.current !== current) return;
              if (page.nextCursor && seenCursors.current.has(page.nextCursor))
                throw Error("分页游标重复，请刷新后重试。");
              if (page.nextCursor) seenCursors.current.add(page.nextCursor);
              setThreads((old) => [
                ...new Map(
                  [...old, ...page.data].map((thread) => [thread.id, thread]),
                ).values(),
              ]);
              setCursor(page.nextCursor);
            })
          }
        >
          加载更多会话
        </button>
      )}
    </div>
  );
}
