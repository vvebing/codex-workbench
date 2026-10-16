import type { SessionsState } from "../sessions/state";
import { SectionControls } from "./SectionControls";
import { pinnedOf } from "../sessions/management";
import { RuntimeContext } from "../../lib/runtime-context";
import { ThreadMenu } from "./ThreadMenu";
import { ScrollArea, Button, IconButton } from "../../components/ui";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronRight,
  Plus,
  Search,
  Settings,
  PanelLeftClose,
  LoaderCircle,
  CircleHelp,
  CircleCheck,
  Archive,
  Trash2,
  Pin,
} from "lucide-react";
import { environments, type Environment } from "../connection/environments";
import { EnvironmentIcon } from "../connection/EnvironmentIcon";
import { ProductIcon } from "../../components/ProductIcon";
import { conversationExecuting } from "../conversation/activity";
import { groupThreadsByRecency, updatedTimeAttributes } from "./model";
import {
  useStore,
  folderOf,
  titleOf,
  relativeTime,
} from "../../components/hooks";

function visibleThreads(sessions: SessionsState) {
  return [...Object.keys(sessions.localDrafts), ...sessions.listIds]
    .map((id) => sessions.threads[id])
    .filter(Boolean)
    .filter(
      (thread) =>
        sessions.sectionFilter === "all" ||
        (sessions.sectionFilter === "unsectioned"
          ? !thread.section
          : thread.section?.id === sessions.sectionFilter),
    );
}

type SidebarProps = {
  onSearch: () => void;
  onSettings: () => void;
  onNew: (cwd?: string, environmentId?: string) => void;
  filter: string;
  onFilterChange: Dispatch<SetStateAction<string>>;
  onCollapse: () => void;
  onSelect: () => void;
};
function EnvironmentGroups({
  environment,
  onNew,
  onSelect,
  now,
  collapsed,
  onToggleWorkspace,
}: SidebarProps & {
  environment: Environment;
  now: number;
  collapsed: Record<string, boolean>;
  onToggleWorkspace: (cwd: string) => void;
}) {
  const runtime = environment.runtime;
  const activeId = useStore(environments).activeId;
  const sessions = useStore(runtime.sessions);
  const connection = useStore(runtime.connection);
  const requests = useStore(runtime.requests);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const threads = visibleThreads(sessions);
  const groups = groupThreadsByRecency(threads);
  const connected = connection.status === "connected";
  return (
    <div
      data-slot="environment-projects"
      className="min-w-0"
      data-connected={connected}
    >
      {!connected && (
        <p className="px-3 py-2 text-xs text-muted" role="status">
          {environment.name} ·{" "}
          {connection.status === "connecting"
            ? "连接中"
            : connection.error
              ? "连接失败"
              : "未连接"}
          {threads.length > 0 ? " · 显示已加载的会话" : " · 连接成功后加载会话"}
        </p>
      )}
      {[...groups].map(([cwd, list]) => (
        <section className="mb-[18px]" key={cwd}>
          <div
            data-slot="workspace-heading"
            className="flex items-center gap-0.5 px-[3px]"
          >
            <span className="ml-2 inline-flex">
              <EnvironmentIcon environment={environment} cwd={cwd} />
            </span>
            <button
              className="flex min-w-0 flex-1 items-center gap-1.5 px-[3px] py-1.5 text-left text-xs font-semibold text-muted"
              data-slot="workspace-toggle"
              aria-expanded={!collapsed[cwd]}
              onClick={() => onToggleWorkspace(cwd)}
            >
              {collapsed[cwd] ? (
                <ChevronRight size={13} />
              ) : (
                <ChevronDown size={13} />
              )}
              <span className="truncate" title={cwd}>
                {folderOf(cwd)}
              </span>
              <small className="ml-auto font-normal text-subtle">
                {list.length}
              </small>
            </button>
            <IconButton
              label={`在 ${folderOf(cwd)} 新建会话`}
              disabled={!connected || sessions.loading}
              onClick={() => {
                onNew(cwd, environment.id);
              }}
            >
              <Plus size={15} />
            </IconButton>
          </div>
          {!collapsed[cwd] && (
            <div className="min-w-0">
              {[...list]
                .sort((a, b) => Number(pinnedOf(b)) - Number(pinnedOf(a)))
                .slice(0, counts[cwd] || 5)
                .map((thread) => {
                  const timeAttributes = updatedTimeAttributes(
                    thread.updatedAt,
                  );
                  const waiting = requests.pending.some(
                    (r) =>
                      "threadId" in r.params && r.params.threadId === thread.id,
                  );
                  const running = conversationExecuting(thread);
                  const showArchive =
                    !running &&
                    !sessions.loading &&
                    sessions.openingId !== thread.id;
                  const failed =
                    thread.status.type === "systemError" ||
                    thread.turns.at(-1)?.status === "failed";
                  return (
                    <RuntimeContext.Provider value={runtime} key={thread.id}>
                      <ThreadMenu thread={thread}>
                        <div
                          data-slot="thread-row"
                          data-selected={
                            activeId === environment.id &&
                            sessions.selectedId === thread.id
                          }
                          className={`group relative flex min-w-0 items-center rounded-[7px] hover:bg-hover ${activeId === environment.id && sessions.selectedId === thread.id ? "bg-selected" : ""}`}
                          key={thread.id}
                        >
                          <button
                            data-slot="thread-link"
                            className="relative flex min-w-0 flex-1 items-center gap-[5px] py-2.5 pr-2 pl-[27px] text-left text-xs max-[900px]:min-h-11"
                            aria-current={
                              activeId === environment.id &&
                              sessions.selectedId === thread.id
                                ? "page"
                                : undefined
                            }
                            onClick={() => {
                              environments.select(environment.id);
                              void runtime.sessions
                                .open(thread.id)
                                .catch(() => {});
                              onSelect();
                            }}
                            title={`${titleOf(thread)}\n${timeAttributes.title}`}
                          >
                            {waiting ? (
                              <CircleHelp
                                size={12}
                                className="pointer-events-none absolute top-1/2 left-2 -mt-1.5 size-3 text-warning"
                                aria-label="待确认"
                              />
                            ) : running ? (
                              <LoaderCircle
                                data-slot="running-indicator"
                                size={12}
                                className="pointer-events-none absolute top-1/2 left-2 -mt-1.5 size-3 animate-spin text-accent"
                                role="img"
                                aria-hidden={false}
                                aria-label="运行中"
                              />
                            ) : sessions.unreadCompleted[thread.id] ? (
                              <CircleCheck
                                size={12}
                                className="pointer-events-none absolute top-1/2 left-2 -mt-1.5 size-3 text-success"
                                role="img"
                                aria-hidden={false}
                                aria-label="会话已完成，未读"
                              />
                            ) : null}
                            {pinnedOf(thread) && (
                              <Pin size={11} aria-label="已置顶" />
                            )}
                            <span
                              data-slot="thread-title"
                              className="flex-1 truncate"
                            >
                              {titleOf(thread)}
                            </span>
                            {sessions.localDrafts[thread.id] && (
                              <span className="shrink-0 text-[10px] text-subtle">
                                草稿
                              </span>
                            )}
                            {(!running || waiting || failed) && (
                              <time
                                {...timeAttributes}
                                className={`whitespace-nowrap text-[10px] text-subtle ${showArchive ? "group-hover:invisible group-focus-within:invisible" : ""} max-[900px]:text-[9px]`}
                              >
                                {sessions.localDrafts[thread.id]
                                  ? "未发送"
                                  : waiting
                                    ? "待确认"
                                    : failed
                                      ? "执行失败"
                                      : relativeTime(thread.updatedAt, now)}
                              </time>
                            )}
                          </button>
                          {showArchive && (
                            <IconButton
                              className="absolute top-1/2 right-1.5 h-[26px] w-6 -translate-y-1/2 pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
                              label={`${sessions.localDrafts[thread.id] ? "删除草稿" : "归档会话"}：${titleOf(thread)}`}
                              disabled={!connected || sessions.loading}
                              onClick={() => {
                                if (sessions.localDrafts[thread.id])
                                  runtime.discardDraft(thread.id);
                                else
                                  void runtime.sessions
                                    .archive(thread.id, true)
                                    .catch(() => {});
                              }}
                            >
                              {sessions.localDrafts[thread.id] ? (
                                <Trash2 size={16} />
                              ) : (
                                <Archive size={16} />
                              )}
                            </IconButton>
                          )}
                        </div>
                      </ThreadMenu>
                    </RuntimeContext.Provider>
                  );
                })}
              {list.length > (counts[cwd] || 5) && (
                <button
                  className="flex items-center gap-1.5 pt-2 pb-0.5 pl-[27px] text-[11px] text-muted"
                  onClick={() =>
                    setCounts({ ...counts, [cwd]: (counts[cwd] || 5) + 20 })
                  }
                >
                  <ChevronDown size={13} />
                  展开更多 · {list.length - (counts[cwd] || 5)}
                </button>
              )}
              {(counts[cwd] || 5) > 5 && (
                <button
                  className="flex items-center gap-1.5 pt-2 pb-0.5 pl-[27px] text-[11px] text-muted"
                  onClick={() => setCounts({ ...counts, [cwd]: 5 })}
                >
                  收起
                </button>
              )}
            </div>
          )}
        </section>
      ))}
      {!threads.length && (
        <div className="px-[18px] py-[25px] text-xs leading-[1.8] text-muted">
          {connected
            ? "还没有会话，从一个新任务开始。"
            : "环境已断开，请在设置中连接。"}
        </div>
      )}
      {sessions.nextCursor && (
        <Button
          variant="secondary"
          size="sm"
          className="mx-auto my-3 flex text-[11px]"
          disabled={sessions.loading || !connected}
          onClick={() => void runtime.sessions.loadMore().catch(() => {})}
        >
          {sessions.loading ? "正在加载…" : "加载下一页会话"}
        </Button>
      )}
    </div>
  );
}
export function Sidebar(props: SidebarProps) {
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const state = useStore(environments);
  const active = environments.active();
  const connectedEntries = state.entries.filter(
    (entry) => entry.runtime.connection.getSnapshot().status === "connected",
  );
  const visibleEntries = state.entries;
  const { filter, onFilterChange: setFilter } = props;
  const visibleWorkspaces = visibleEntries
    .filter((entry) => filter === "all" || entry.id === filter)
    .flatMap((entry) =>
      [
        ...new Set(
          visibleThreads(entry.runtime.sessions.getSnapshot()).map(
            (thread) => thread.cwd,
          ),
        ),
      ].map((cwd) => ({ environmentId: entry.id, cwd })),
    );
  const allCollapsed =
    visibleWorkspaces.length > 0 &&
    visibleWorkspaces.every(
      ({ environmentId, cwd }) => collapsedWorkspaces[environmentId]?.[cwd],
    );
  function toggleAllWorkspaces() {
    setCollapsedWorkspaces((previous) => {
      const next = { ...previous };
      for (const { environmentId, cwd } of visibleWorkspaces) {
        next[environmentId] = { ...next[environmentId], [cwd]: !allCollapsed };
      }
      return next;
    });
  }

  const newEnvironment =
    connectedEntries.find((entry) => entry.id === filter) ||
    connectedEntries.find((entry) => entry.id === active.id) ||
    connectedEntries[0];
  const ids = visibleEntries.map((entry) => entry.id).join(",");
  useEffect(() => {
    setFilter((value) => (value === "all" ? value : state.activeId));
  }, [state.activeId, setFilter]);
  useEffect(() => {
    setFilter((value) =>
      value !== "all" && !ids.split(",").includes(value) ? "all" : value,
    );
  }, [ids, setFilter]);
  return (
    <aside
      data-slot="sidebar"
      className="flex h-full flex-col border-r border-border bg-surface"
    >
      <div className="flex h-[68px] shrink-0 items-center gap-[9px] px-[19px]">
        <ProductIcon className="size-7 shrink-0" />
        <strong className="text-[19px] tracking-[-0.6px]">Codex</strong>
        <span className="flex-1 text-[11px] text-muted min-[901px]:max-[1100px]:hidden">
          工作台
        </span>
        <IconButton label="收起导航" onClick={props.onCollapse}>
          <PanelLeftClose size={17} />
        </IconButton>
      </div>
      <div data-slot="sidebar-actions" className="px-3 pt-[3px] pb-[18px]">
        <button
          className="mb-[7px] flex min-h-10 w-full items-center gap-2.5 rounded-lg border border-border bg-elevated px-[11px] py-2.5 text-left text-[13px] shadow-sm hover:bg-hover max-[900px]:min-h-11"
          onClick={() => {
            if (newEnvironment) {
              props.onNew(undefined, newEnvironment.id);
            }
          }}
          disabled={
            !newEnvironment ||
            newEnvironment.runtime.sessions.getSnapshot().loading
          }
        >
          <Plus size={18} />
          新建会话<span className="ml-auto text-[10px] text-subtle">⌘ ⇧ O</span>
        </button>
        <button
          className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-[11px] py-2.5 text-left text-[13px] hover:bg-hover max-[900px]:min-h-11"
          onClick={props.onSearch}
        >
          <Search size={17} />
          搜索会话<span className="ml-auto text-[10px] text-subtle">⌘ K</span>
        </button>
      </div>
      {visibleEntries.length > 0 && (
        <ScrollArea className="mx-3.5 mb-[18px] shrink-0" orientation="both">
          <div
            className="w-max min-w-full flex gap-1 rounded-[9px] bg-hover p-[3px]"
            role="tablist"
            aria-label="按工作环境筛选会话"
            onKeyDown={(event) => {
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                ),
              );
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              if (
                index < 0 ||
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
              buttons[next].focus();
              buttons[next].click();
            }}
          >
            <button
              className="inline-flex h-[30px] min-w-9 shrink-0 items-center justify-center rounded-md px-[11px] text-xs text-muted aria-selected:bg-elevated aria-selected:text-accent aria-selected:shadow-sm"
              role="tab"
              tabIndex={filter === "all" ? 0 : -1}
              aria-selected={filter === "all"}
              aria-controls="sidebar-sessions"
              id="session-filter-all"
              onClick={() => setFilter("all")}
            >
              全部
            </button>
            {visibleEntries.map((entry) => (
              <button
                className="inline-flex h-[30px] min-w-9 shrink-0 items-center justify-center rounded-md px-[11px] text-xs text-muted aria-selected:bg-elevated aria-selected:text-accent aria-selected:shadow-sm"
                role="tab"
                tabIndex={filter === entry.id ? 0 : -1}
                key={entry.id}
                id={`session-filter-${entry.id}`}
                aria-selected={filter === entry.id}
                aria-controls="sidebar-sessions"
                aria-label={entry.name}
                onClick={() => setFilter(entry.id)}
              >
                <EnvironmentIcon
                  environment={entry}
                  connection={entry.runtime.connection.getSnapshot()}
                  focusable={false}
                  tooltipSide="bottom"
                />
              </button>
            ))}
          </div>
        </ScrollArea>
      )}
      <div className="flex items-center justify-between pr-[18px] pb-2 pl-6 text-[11px] tracking-[0.6px] text-muted">
        <span className="shrink-0">项目与会话</span>
        <div className="flex min-w-0 items-center gap-1">
          <IconButton
            size="sm"
            label={allCollapsed ? "展开全部项目" : "折叠全部项目"}
            aria-controls="sidebar-sessions"
            disabled={!visibleWorkspaces.length}
            onClick={toggleAllWorkspaces}
          >
            {allCollapsed ? (
              <ChevronsUpDown size={15} />
            ) : (
              <ChevronsDownUp size={15} />
            )}
          </IconButton>
          <SectionControls
            entries={connectedEntries}
            preferredId={newEnvironment?.id}
            deviceFilter={filter}
            onDeviceFilterChange={setFilter}
          />
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div
          className="px-2.5 pb-5"
          id="sidebar-sessions"
          role={visibleEntries.length > 0 ? "tabpanel" : undefined}
          aria-labelledby={
            visibleEntries.length > 0 ? `session-filter-${filter}` : undefined
          }
        >
          {!visibleEntries.length && (
            <div className="px-[18px] py-[25px] text-xs leading-[1.8] text-muted">
              连接工作环境后，会话将在这里显示。
            </div>
          )}
          {visibleEntries
            .filter((entry) => filter === "all" || entry.id === filter)
            .map((environment) => (
              <EnvironmentGroups
                key={environment.id}
                environment={environment}
                now={now}
                collapsed={collapsedWorkspaces[environment.id] || {}}
                onToggleWorkspace={(cwd) =>
                  setCollapsedWorkspaces((value) => ({
                    ...value,
                    [environment.id]: {
                      ...value[environment.id],
                      [cwd]: !value[environment.id]?.[cwd],
                    },
                  }))
                }
                {...props}
              />
            ))}
        </div>
      </ScrollArea>
      <div className="border-t border-border px-4 py-[13px]">
        <button
          data-slot="connection-entry"
          data-settings-trigger
          className="flex w-full items-center gap-2.5 text-left"
          onClick={props.onSettings}
        >
          <span
            className={`inline-block size-1.5 shrink-0 rounded-full ${connectedEntries.length ? "bg-success" : "bg-border"}`}
          />
          <span className="flex-1">
            <strong className="block text-xs font-medium">
              {connectedEntries.length ? "设置" : "连接工作环境"}
            </strong>
            <small className="mt-[3px] block text-[10px] text-muted">
              {connectedEntries.length
                ? `${connectedEntries.length} 个环境已连接`
                : "管理工作环境与偏好"}
            </small>
          </span>
          <Settings size={17} />
        </button>
      </div>
    </aside>
  );
}
