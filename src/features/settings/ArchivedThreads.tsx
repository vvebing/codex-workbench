import { t, useLocale, getLocale } from "../../lib/i18n";
import { ROOT_THREAD_SOURCES } from "../sessions/list";
import { mergeArchivedThreads } from "./archived-threads";
import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ChevronDown,
  Folder,
  RefreshCw,
  RotateCcw,
  Search,
} from "lucide-react";
import {
  Button,
  ErrorNotice,
  IconButton,
  SelectField,
} from "../../components/ui";
import { folderOf, titleOf, useStore } from "../../components/hooks";
import type { Environment } from "../connection/environments";
import type { Thread } from "../../generated/v2/Thread";
import type { ThreadSortKey } from "../../generated/v2/ThreadSortKey";

type Page = { data: Thread[]; nextCursor: string | null };
const date = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleString(getLocale(), {
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
  useLocale();
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
        sourceKinds: ROOT_THREAD_SOURCES,
        limit: 30,
        sortKey: sort,
        ...(search ? { searchTerm: search } : {}),
      })
      .then((page) => {
        if (generation.current !== current) return;
        setThreads(mergeArchivedThreads([], page.data));
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
            aria-label={t("搜索已归档会话")}
            placeholder={t("搜索会话名称")}
            value={query}
            disabled={!!restoring}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <SelectField
          label={t("归档会话排序")}
          value={sort}
          disabled={!!restoring}
          onValueChange={(value) => setSort(value as ThreadSortKey)}
          options={[
            { value: "updated_at", label: t("最近更新") },
            { value: "created_at", label: t("创建时间") },
          ]}
        />
        <IconButton
          label={t("刷新归档会话")}
          disabled={!connected || busy}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={16} />
        </IconButton>
      </div>
      {!connected && (
        <div className="mt-6 flex flex-col items-start px-1 py-6 text-left text-muted">
          <Archive size={20} strokeWidth={1.5} aria-hidden="true" />
          <h4 className="mt-3 mb-1 text-sm font-medium text-foreground">
            {t("先连接工作环境")}
          </h4>
          <p className="text-xs leading-relaxed">
            {t("连接 {{name}} 后查看已归档会话。", { name: environment.name })}
          </p>
        </div>
      )}
      {error && (
        <ErrorNotice className="mb-4">
          <p className="mb-2">{error}</p>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !connected}
            onClick={() => setRevision((value) => value + 1)}
          >
            {t("重新加载")}
          </Button>
        </ErrorNotice>
      )}
      {connected && threads.length > 0 && (
        <p className="mb-3 text-xs text-muted">
          {t("工作区：{{workspaces}} · 已加载会话：{{sessions}}", {
            workspaces: groups.size,
            sessions: threads.length,
          })}
          {cursor ? t("，还有更多") : ""}
        </p>
      )}
      {[...groups].map(([cwd, entries]) => (
        <details
          data-slot="archive-group"
          className="group mb-4 border-y border-border"
          key={cwd}
          open
        >
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 bg-surface px-3 py-3 [&::-webkit-details-marker]:hidden">
            <ChevronDown
              size={15}
              className="-rotate-90 transition-transform group-open:rotate-0"
            />
            <Folder size={17} />
            <span className="min-w-0 flex-1">
              <strong className="block text-control [overflow-wrap:anywhere]">
                {folderOf(cwd)}
              </strong>
              <small
                className="mt-1 block text-meta text-muted [overflow-wrap:anywhere]"
                title={cwd}
              >
                {cwd || t("未指定工作区")}
              </small>
            </span>
            <span className="px-1 text-meta tabular-nums text-muted">
              {entries.length}
            </span>
          </summary>
          <div>
            {entries.map((thread) => (
              <div
                data-slot="archive-thread"
                className="flex items-center gap-4 border-t border-border px-3 py-3 max-[550px]:gap-2"
                key={thread.id}
              >
                <div className="min-w-0 flex-1">
                  <strong className="block text-control font-medium leading-relaxed [overflow-wrap:anywhere]">
                    {titleOf(thread)}
                  </strong>
                  <time
                    className="mt-1 block text-meta text-muted"
                    dateTime={new Date(
                      (sort === "created_at"
                        ? thread.createdAt
                        : thread.updatedAt) * 1000,
                    ).toISOString()}
                  >
                    {sort === "created_at" ? t("创建于") : t("更新于")}{" "}
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
                  aria-label={t("恢复 {{v0}}", { v0: titleOf(thread) })}
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
                  {restoring === thread.id ? t("正在恢复…") : t("恢复")}
                </Button>
              </div>
            ))}
          </div>
        </details>
      ))}
      {connected && !threads.length && !busy && !error && (
        <div className="mt-6 flex flex-col items-start px-1 py-6 text-left text-muted">
          <Archive size={20} strokeWidth={1.5} aria-hidden="true" />
          <h4 className="mt-3 mb-1 text-sm font-medium text-foreground">
            {search ? t("没有匹配的会话") : t("还没有归档的会话")}
          </h4>
          <p className="text-xs leading-relaxed">
            {search
              ? t("试试其他会话名称。")
              : t("归档后的会话会按工作区显示在这里。")}
          </p>
        </div>
      )}
      {busy && (
        <p role="status" className="py-4 text-center text-xs text-muted">
          {restoring ? t("正在恢复会话…") : t("正在加载归档会话…")}
        </p>
      )}
      {cursor && (
        <Button
          className="mx-auto mt-6 flex w-fit"
          disabled={busy || !connected}
          onClick={() =>
            void action(async (current) => {
              const page = await runtime.connection.client.request<Page>(
                "thread/list",
                {
                  archived: true,
                  sourceKinds: ROOT_THREAD_SOURCES,
                  limit: 30,
                  sortKey: sort,
                  cursor,
                  ...(search ? { searchTerm: search } : {}),
                },
              );
              if (generation.current !== current) return;
              if (page.nextCursor && seenCursors.current.has(page.nextCursor))
                throw Error(t("分页游标重复，请刷新后重试。"));
              if (page.nextCursor) seenCursors.current.add(page.nextCursor);
              setThreads((old) => mergeArchivedThreads(old, page.data));
              setCursor(page.nextCursor);
            })
          }
        >
          {t("加载更多会话")}
        </Button>
      )}
    </div>
  );
}
