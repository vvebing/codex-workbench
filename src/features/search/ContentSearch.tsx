import { useEffect, useMemo, useRef, useState } from "react";
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  File,
  Search,
  X,
} from "lucide-react";
import { ErrorNotice, IconButton, ScrollArea } from "../../components/ui";
import { useStore } from "../../components/hooks";
import { useRuntime } from "../../lib/runtime-context";
import type { Thread } from "../../generated/v2/Thread";
import { settingsInputClass } from "../settings/settings-ui";
import { workspacePath } from "../shell/project-files";
import { searchWorkspaceContent } from "./content-search";

type SearchResults = Awaited<ReturnType<typeof searchWorkspaceContent>>;
type Match = SearchResults["matches"][number];

export function ContentSearch({
  thread,
  active = true,
}: {
  thread: Thread;
  active?: boolean;
}) {
  const { connection } = useRuntime();
  const { epoch, scope, status } = useStore(connection);
  if (status !== "connected")
    return <p className="p-4 text-xs text-muted">连接环境后可搜索项目内容。</p>;
  if (!thread.cwd)
    return <p className="p-4 text-xs text-muted">当前会话没有项目目录。</p>;
  return (
    <ConnectedSearch
      key={JSON.stringify([epoch, scope, thread.cwd])}
      thread={thread}
      active={active}
    />
  );
}

function ConnectedSearch({
  thread,
  active,
}: {
  thread: Thread;
  active: boolean;
}) {
  const { connection, files } = useRuntime();
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SearchResults>();
  const [submitted, setSubmitted] = useState<{
    query: string;
    caseSensitive: boolean;
  }>();
  const [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    const focus = () => {
      if (!active) return;
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("workspace-content-search-focus", focus);
    if (active) input.current?.focus();
    return () => {
      window.removeEventListener("workspace-content-search-focus", focus);
    };
  }, [active]);
  useEffect(() => {
    return () => {
      controller.current?.abort();
      controller.current = undefined;
    };
  }, []);
  const groups = useMemo(() => {
    const grouped = new Map<string, Match[]>();
    for (const match of results?.matches ?? []) {
      const matches = grouped.get(match.path) ?? [];
      matches.push(match);
      grouped.set(match.path, matches);
    }
    return [...grouped];
  }, [results]);
  const stale =
    submitted &&
    (submitted.query !== query || submitted.caseSensitive !== caseSensitive);
  const cancel = () => {
    controller.current?.abort();
    controller.current = undefined;
    setBusy(false);
    setCancelled(true);
  };
  const search = async () => {
    if (!query || /[\r\n]/.test(query)) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");
    setResults(undefined);
    setCancelled(false);
    setCollapsed(new Set());
    setSubmitted({ query, caseSensitive });
    try {
      const value = await searchWorkspaceContent(
        connection.client,
        thread.cwd,
        query,
        {
          caseSensitive,
          signal: request.signal,
          onProgress: (value) => {
            if (controller.current === request) setResults(value);
          },
        },
      );
      if (controller.current === request) setResults(value);
    } catch (cause) {
      if (controller.current === request && !request.signal.aborted)
        setError(String(cause));
    } finally {
      if (controller.current === request) {
        controller.current = undefined;
        setBusy(false);
      }
    }
  };
  const open = async (match: Match) => {
    try {
      await files.open({
        path: workspacePath(thread.cwd, match.path),
        cwd: thread.cwd,
        threadId: thread.id,
        line: match.line,
        column: match.column,
      });
    } catch (cause) {
      setError(String(cause));
    }
  };
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="项目内容搜索">
      <form
        className="space-y-2 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <div className="flex items-center gap-1">
          <input
            ref={input}
            className={`${settingsInputClass} min-w-0 flex-1`}
            aria-label="搜索文件内容"
            placeholder="搜索文件内容…"
            value={query}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              if (!value) {
                controller.current?.abort();
                controller.current = undefined;
                setBusy(false);
                setCancelled(false);
                setResults(undefined);
                setSubmitted(undefined);
                setError("");
                setCollapsed(new Set());
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && busy) {
                event.preventDefault();
                cancel();
              }
            }}
          />
          <IconButton
            label="区分大小写"
            title="区分大小写"
            aria-pressed={caseSensitive}
            className={caseSensitive ? "bg-selected text-accent" : "text-muted"}
            onClick={() => setCaseSensitive((value) => !value)}
          >
            <CaseSensitive size={16} />
          </IconButton>
          {busy ? (
            <IconButton
              label="取消内容搜索"
              title="取消搜索 (Esc)"
              onClick={cancel}
            >
              <X size={16} />
            </IconButton>
          ) : (
            <IconButton
              type="submit"
              label="搜索内容"
              title="搜索 (Enter)"
              disabled={!query || /[\r\n]/.test(query)}
            >
              <Search size={16} />
            </IconButton>
          )}
        </div>
        <p className="text-xs text-muted">按 Enter 搜索普通字符串。</p>
        {/[\r\n]/.test(query) && (
          <p className="text-xs text-danger">请输入单行搜索文本。</p>
        )}
      </form>
      {error && <ErrorNotice className="mx-3 mb-2">{error}</ErrorNotice>}
      <div
        role="status"
        aria-live="polite"
        className="px-3 pb-2 text-xs text-muted"
      >
        {busy
          ? `正在搜索…已找到 ${results?.matches.length ?? 0} 个匹配行，位于 ${groups.length} 个文件中。`
          : cancelled
            ? `搜索已取消，保留 ${results?.matches.length ?? 0} 个匹配行，位于 ${groups.length} 个文件中。`
            : results
              ? `${results.matches.length} 个匹配行，位于 ${groups.length} 个文件中${results.matches.length === 0 ? "。" : ""}`
              : !error
                ? "搜索当前项目中的文件内容，点击结果跳转到匹配位置。"
                : ""}
        {stale && !busy && (
          <span className="mt-1 block">
            搜索条件已更改，按 Enter 更新结果。
          </span>
        )}
        {results?.truncated && (
          <span className="mt-1 block">结果已达到上限，请细化搜索。</span>
        )}
        {results?.warning && (
          <span className="mt-1 block">{results.warning}</span>
        )}
      </div>
      <ScrollArea
        className="flex-1"
        viewportProps={{ className: "pb-3" }}
        aria-label="内容搜索结果"
        aria-busy={busy}
      >
        {groups.map(([path, matches]) => (
          <div key={path}>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs hover:bg-hover"
              aria-expanded={!collapsed.has(path)}
              title={path}
              onClick={() =>
                setCollapsed((old) => {
                  const next = new Set(old);
                  if (next.has(path)) next.delete(path);
                  else next.add(path);
                  return next;
                })
              }
            >
              {collapsed.has(path) ? (
                <ChevronRight size={12} className="shrink-0" />
              ) : (
                <ChevronDown size={12} className="shrink-0" />
              )}
              <File size={14} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{path}</span>
              <span className="shrink-0 rounded bg-hover px-1.5 text-muted">
                {matches.length}
              </span>
            </button>
            {!collapsed.has(path) &&
              matches.map((match) => (
                <button
                  type="button"
                  key={`${match.line}:${match.column}`}
                  className="flex w-full gap-2 py-1.5 pl-7 pr-3 text-left font-mono text-xs hover:bg-hover focus-visible:bg-selected"
                  title={`${path}:${match.line}:${match.column}\n${match.text}`}
                  aria-label={`${path}，第 ${match.line} 行，第 ${match.column} 列：${match.text}`}
                  onClick={() => void open(match)}
                >
                  <span className="w-8 shrink-0 text-right text-muted">
                    {match.line}
                  </span>
                  <span className="min-w-0 flex-1 truncate whitespace-pre">
                    <MatchPreview match={match} />
                  </span>
                </button>
              ))}
          </div>
        ))}
      </ScrollArea>
    </section>
  );
}

function MatchPreview({ match }: { match: Match }) {
  const start = Math.max(0, match.column - 1);
  const from = Math.max(0, start - 50);
  return (
    <>
      {from > 0 && "…"}
      {match.text.slice(from, start)}
      <mark className="rounded-sm bg-accent/20 text-foreground">
        {match.text.slice(start, start + match.matchLength)}
      </mark>
      {match.text.slice(
        start + match.matchLength,
        start + match.matchLength + 200,
      )}
    </>
  );
}
