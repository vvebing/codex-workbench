import { useEffect, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import { Search, ArrowUpRight } from "lucide-react";
import { HistorySearch } from "./history-search";
import {
  combineSearchResults,
  recentSearchSuggestions,
  sessionIdQuery,
} from "./search-results";
import { navigationTitle } from "./navigation-title";
import { navigationEnvironmentKey, navigationState } from "./navigation-state";
import type { Thread } from "../../generated/v2/Thread";
import { ScrollArea, Modal, Button, ErrorNotice } from "../../components/ui";
import {
  useStore,
  titleOf,
  folderOf,
  relativeTime,
} from "../../components/hooks";
import { environments, type Environment } from "../connection/environments";
import { EnvironmentIcon } from "../connection/EnvironmentIcon";
import { isSubagentThread } from "../sessions/state";

function EnvironmentResults({
  environment,
  query,
  close,
  onLocated,
}: {
  environment: Environment;
  query: string;
  close: () => void;
  onLocated?: () => void;
}) {
  const connection = useStore(environment.runtime.connection);
  return (
    <EnvironmentSearch
      key={JSON.stringify([
        query,
        connection.epoch,
        connection.scope,
        connection.status,
        environment.url,
      ])}
      environment={environment}
      query={query}
      close={close}
      onLocated={onLocated}
      connected={connection.status === "connected"}
    />
  );
}

function EnvironmentSearch({
  environment,
  query,
  close,
  onLocated,
  connected,
}: {
  environment: Environment;
  query: string;
  close: () => void;
  onLocated?: () => void;
  connected: boolean;
}) {
  const state = useStore(environment.runtime.sessions);
  const navigation = useStore(navigationState);
  const nextPage = useRef<HTMLDivElement>(null);
  const [search] = useState(() => {
    const connection = environment.runtime.connection;
    const { epoch, scope } = connection.getSnapshot();
    return new HistorySearch(connection.client, query, () => {
      const current = connection.getSnapshot();
      return (
        current.status === "connected" &&
        current.epoch === epoch &&
        current.scope === scope
      );
    });
  });
  const results = useStore(search);
  const exactId = sessionIdQuery(query);
  useEffect(() => {
    if (query && connected) search.start();
    return () => search.dispose();
  }, [search, query, connected]);
  useEffect(() => {
    const target = nextPage.current;
    if (
      !target ||
      !connected ||
      !results.nextCursor ||
      results.loading ||
      results.error ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) search.more();
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [connected, results.nextCursor, results.loading, results.error, search]);

  const environmentKey = navigationEnvironmentKey(environment);
  const threads = useMemo(() => {
    const promoted = new Set(
      Object.values(state.localDrafts).map((draft) => draft.serverId),
    );
    const visible = (thread: Thread) =>
      !isSubagentThread(thread) &&
      !state.subagentThreadIds[thread.id] &&
      !promoted.has(thread.id);
    const loaded = Object.values(state.threads).filter(visible);
    if (query)
      return combineSearchResults(
        loaded,
        results.threads.filter(visible),
        query,
      );
    return recentSearchSuggestions(
      loaded,
      navigation.visits,
      environmentKey,
    ).map((thread) => ({ thread, sources: [], excerpt: "" }));
  }, [
    state.threads,
    state.localDrafts,
    state.subagentThreadIds,
    query,
    results.threads,
    navigation.visits,
    environmentKey,
  ]);

  return (
    <Command.Group
      className="session-search-group"
      heading={`${environment.name}${connected ? "" : " · 未连接"}`}
      forceMount
    >
      {threads.map(({ thread, sources, excerpt }) => {
        const draft = !!state.localDrafts[thread.id];
        const cached = !!thread.turns.length;
        const visited =
          !!navigation.visits[JSON.stringify([environmentKey, thread.id])];
        return (
          <Command.Item
            className="session-search-result"
            key={thread.id}
            value={`${environment.id} ${thread.id}`}
            disabled={!connected && !draft && !cached}
            onSelect={() => {
              environments.select(environment.id);
              onLocated?.();
              void environment.runtime.sessions.open(thread.id).catch(() => {});
              close();
            }}
          >
            <EnvironmentIcon environment={environment} focusable={false} />
            <div className="min-w-0 flex-1">
              <strong
                className="block truncate text-control font-medium"
                title={titleOf(thread)}
              >
                {navigationTitle(thread)}
              </strong>
              <p className="session-search-result-context" title={thread.cwd}>
                {folderOf(thread.cwd)}
                <span aria-hidden="true"> · </span>
                {draft ? "未发送草稿" : excerpt || thread.preview || "暂无摘要"}
              </p>
              <div className="session-search-sources">
                {query ? (
                  sources.map((source) => <span key={source}>{source}</span>)
                ) : (
                  <span>
                    {draft ? "本地草稿" : visited ? "最近访问" : "已加载会话"}
                  </span>
                )}
                {!connected && (
                  <span>
                    {cached
                      ? "本地缓存 · 可离线查看"
                      : "本地缓存 · 连接后可打开"}
                  </span>
                )}
              </div>
            </div>
            <time className="session-search-time">
              {relativeTime(thread.updatedAt)}
            </time>
            <ArrowUpRight className="shrink-0" size={15} aria-hidden="true" />
          </Command.Item>
        );
      })}
      {!query && !threads.length && (
        <p className="session-search-message">
          暂无已加载会话。输入标题或 Session ID 查找历史。
        </p>
      )}
      {!connected && (
        <p className="session-search-message">
          环境未连接，仅搜索本地已加载内容；未缓存的历史需连接后查找和打开。
        </p>
      )}
      {query && connected && results.loading && (
        <p role="status" className="session-search-message">
          {exactId ? "正在定位 Session ID…" : "正在搜索历史标题…"}
        </p>
      )}
      {query && connected && results.error && (
        <ErrorNotice className="mx-[15px] my-3">
          {exactId ? "定位失败" : "搜索失败"}：{results.error}{" "}
          <Button variant="quiet" size="sm" onClick={() => search.retry()}>
            重试
          </Button>
        </ErrorNotice>
      )}
      {query &&
        connected &&
        !results.loading &&
        !results.error &&
        !threads.length && (
          <p className="session-search-message">
            {exactId
              ? "此环境未找到对应 Session ID。"
              : "当前范围内没有匹配结果；未加载的对话正文尚未检索。"}
          </p>
        )}
      {query && connected && results.nextCursor && !results.error && (
        <div ref={nextPage} className="px-[15px] py-2">
          <Button
            variant="quiet"
            size="sm"
            disabled={results.loading}
            onClick={() => search.more()}
          >
            {results.loading ? "正在加载更多…" : "加载更多搜索结果"}
          </Button>
        </div>
      )}
    </Command.Group>
  );
}

function SearchContent({
  initialScope,
  close,
  onLocated,
}: {
  initialScope?: string;
  close: () => void;
  onLocated?: () => void;
}) {
  const state = useStore(environments);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState(() =>
    initialScope === "all" ||
    state.entries.some((entry) => entry.id === initialScope)
      ? initialScope!
      : state.activeId,
  );
  const selectedScope =
    scope === "all" || state.entries.some((entry) => entry.id === scope)
      ? scope
      : state.activeId;
  const entries = state.entries.filter(
    (entry) => selectedScope === "all" || entry.id === selectedScope,
  );
  const trimmedQuery = query.trim();
  return (
    <Command
      className="flex min-h-0 flex-col"
      label="搜索会话"
      loop
      shouldFilter={false}
    >
      <div className="session-search-input">
        <Search size={19} aria-hidden="true" />
        <Command.Input
          className="min-w-0 w-full border-0 bg-transparent py-[7px] text-prose outline-none"
          placeholder="搜索标题、摘要或工作区…"
          aria-label="搜索标题、摘要、工作区、已加载对话或 Session ID"
          value={query}
          onValueChange={setQuery}
          autoFocus
        />
      </div>
      <div className="session-search-scope">
        <label htmlFor="session-search-scope">搜索范围</label>
        <select
          id="session-search-scope"
          value={selectedScope}
          onChange={(event) => setScope(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {state.entries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
              {entry.id === state.activeId ? "（当前环境）" : ""}
            </option>
          ))}
          <option value="all">全部环境</option>
        </select>
        {selectedScope !== "all" && state.entries.length > 1 && (
          <Button variant="quiet" size="sm" onClick={() => setScope("all")}>
            扩大到全部环境
          </Button>
        )}
      </div>
      <p className="session-search-coverage">
        {sessionIdQuery(trimmedQuery)
          ? "按完整 Session / Thread ID 精确定位，仅读取会话信息。"
          : trimmedQuery
            ? "历史标题按原文区分大小写匹配；标题、摘要、工作区和已加载对话在本地匹配。未加载正文不在搜索范围。"
            : "最近访问与已加载会话。可输入完整 Session ID 精确定位历史。"}
      </p>
      <ScrollArea className="max-h-[47dvh]">
        <Command.List className="p-2" label="会话搜索结果">
          {entries.map((environment) => (
            <EnvironmentResults
              key={environment.id}
              environment={environment}
              query={trimmedQuery}
              close={close}
              onLocated={onLocated}
            />
          ))}
        </Command.List>
      </ScrollArea>
      <footer className="session-search-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> 选择
        </span>
        <span>
          <kbd>Enter</kbd> 打开
        </span>
        <span>
          <kbd>Esc</kbd> 关闭
        </span>
      </footer>
    </Command>
  );
}

export function SearchDialog({
  open,
  onOpenChange,
  initialScope,
  onLocated,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  initialScope?: string;
  onLocated?: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="搜索会话"
      description="在当前范围查找会话，或切换到全部环境。"
      variant="search"
    >
      {open && (
        <SearchContent
          initialScope={initialScope}
          close={() => onOpenChange(false)}
          onLocated={onLocated}
        />
      )}
    </Modal>
  );
}
