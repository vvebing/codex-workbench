import { useEffect, useState } from "react";
import { HistorySearch } from "./history-search";
import type { Thread } from "../../generated/v2/Thread";
import { ScrollArea, Modal } from "../../components/ui";
import { Command } from "cmdk";
import { Search, ArrowUpRight } from "lucide-react";

import {
  useStore,
  titleOf,
  folderOf,
  relativeTime,
} from "../../components/hooks";
import { environments, type Environment } from "../connection/environments";
import { EnvironmentIcon } from "../connection/EnvironmentIcon";
function EnvironmentResults({
  environment,
  query,
  close,
}: {
  environment: Environment;
  query: string;
  close: () => void;
}) {
  const state = useStore(environment.runtime.sessions);
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
      connected={connection.status === "connected"}
      initialThreads={state.listIds
        .map((id) => state.threads[id])
        .filter(Boolean)}
    />
  );
}
function EnvironmentSearch({
  environment,
  query,
  close,
  connected,
  initialThreads,
}: {
  environment: Environment;
  query: string;
  close: () => void;
  connected: boolean;
  initialThreads: Thread[];
}) {
  const state = useStore(environment.runtime.sessions);
  const [search] = useState(() => {
    const connection = environment.runtime.connection;
    const epoch = connection.getSnapshot().epoch;
    const scope = connection.getSnapshot().scope;
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
  useEffect(() => {
    if (query && connected) search.start();
    return () => search.dispose();
  }, [search, query, connected]);
  const drafts = Object.keys(state.localDrafts)
    .map((id) => state.threads[id])
    .filter(Boolean)
    .filter((t) =>
      `${titleOf(t)} ${t.preview} ${t.cwd}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  const history = query
    ? [
        ...new Map(
          [
            ...initialThreads.filter((t) =>
              `${titleOf(t)} ${t.preview} ${t.cwd}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            ),
            ...results.threads,
          ].map((t) => [t.id, t]),
        ).values(),
      ]
    : initialThreads;
  const threads = [
    ...drafts,
    ...history.filter(
      (t) =>
        !state.localDrafts[t.id] &&
        !Object.values(state.localDrafts).some(
          (draft) => draft.serverId === t.id,
        ),
    ),
  ];
  return (
    <Command.Group className="session-search-group" heading={environment.name}>
      {threads.map((t) => (
        <Command.Item
          className="flex cursor-pointer items-center gap-[11px] rounded-lg px-[13px] py-[11px] text-muted data-[selected=true]:bg-selected data-[selected=true]:text-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
          key={t.id}
          value={`${environment.id} ${t.id} ${titleOf(t)} ${t.preview} ${t.cwd}`}
          disabled={!connected && !state.localDrafts[t.id]}
          onSelect={() => {
            environments.select(environment.id);
            void environment.runtime.sessions.open(t.id).catch(() => {});
            close();
          }}
        >
          <EnvironmentIcon environment={environment} focusable={false} />
          <div className="min-w-0 flex-1">
            <strong className="block truncate text-[13px] font-medium">
              {titleOf(t)}
            </strong>
            <p className="mt-1 truncate text-[11px] text-subtle">
              {folderOf(t.cwd)} ·{" "}
              {state.localDrafts[t.id] ? "未发送草稿" : t.preview || "暂无摘要"}
            </p>
          </div>
          <time className="whitespace-nowrap text-[10px]">
            {relativeTime(t.updatedAt)}
          </time>
          <ArrowUpRight size={15} />
        </Command.Item>
      ))}
      {query && !connected && (
        <p className="px-[15px] py-3 text-xs text-muted">
          环境未连接，连接后可搜索历史标题。
        </p>
      )}
      {query && connected && results.loading && (
        <p role="status" className="px-[15px] py-3 text-xs text-muted">
          正在搜索历史标题…
        </p>
      )}
      {query && connected && results.error && (
        <div role="alert" className="px-[15px] py-3 text-xs text-muted">
          搜索失败：{results.error}{" "}
          <button type="button" onClick={() => search.retry()}>
            重试
          </button>
        </div>
      )}
      {query &&
        connected &&
        !results.loading &&
        !results.error &&
        !threads.length && (
          <p className="px-[15px] py-3 text-xs text-muted">
            没有找到匹配的会话。
          </p>
        )}
      {query && connected && results.nextCursor && !results.error && (
        <button
          type="button"
          className="px-[15px] py-3 text-xs text-muted"
          disabled={results.loading}
          onClick={() => search.more()}
        >
          加载更多搜索结果
        </button>
      )}
    </Command.Group>
  );
}
export function SearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const state = useStore(environments);
  const [query, setQuery] = useState("");
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="搜索会话"
      description="搜索所有已连接环境的历史标题（区分大小写、子串匹配）；已加载会话和本地草稿还支持摘要、工作区搜索。历史搜索不检索正文。"
      variant="search"
    >
      <Command
        className="flex min-h-0 flex-col"
        label="搜索会话标题"
        loop
        shouldFilter={false}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-5 pb-[15px] text-muted">
          <Search size={19} />
          <Command.Input
            className="min-w-0 w-full border-0 bg-transparent py-[7px] text-[15px] outline-none"
            placeholder="搜索标题、摘要或工作区…"
            value={query}
            onValueChange={setQuery}
            autoFocus
          />
        </div>
        <ScrollArea className="max-h-[47dvh]">
          <Command.List className="p-2">
            {open &&
              state.entries.map((environment) => (
                <EnvironmentResults
                  key={environment.id}
                  environment={environment}
                  query={query.trim()}
                  close={() => onOpenChange(false)}
                />
              ))}
          </Command.List>
        </ScrollArea>
        <footer className="flex shrink-0 flex-wrap gap-[18px] border-t border-border bg-surface px-[22px] py-[13px] text-[10px] text-muted">
          <span>
            <kbd className="rounded border border-border bg-elevated px-[5px] py-0.5 font-mono text-[11px]">
              ↑
            </kbd>
            <kbd className="rounded border border-border bg-elevated px-[5px] py-0.5 font-mono text-[11px]">
              ↓
            </kbd>{" "}
            选择
          </span>
          <span>
            <kbd className="rounded border border-border bg-elevated px-[5px] py-0.5 font-mono text-[11px]">
              Enter
            </kbd>{" "}
            打开
          </span>
          <span>
            <kbd className="rounded border border-border bg-elevated px-[5px] py-0.5 font-mono text-[11px]">
              Esc
            </kbd>{" "}
            关闭
          </span>
        </footer>
      </Command>
    </Modal>
  );
}
