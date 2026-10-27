import { getLocale, t, useLocale } from "../../lib/i18n";
import { memo, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Tabs } from "radix-ui";
import {
  Archive,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  LoaderCircle,
  LocateFixed,
  MoreHorizontal,
  PanelLeftClose,
  Pin,
  Plus,
  Search,
  Settings,
  Star,
} from "lucide-react";
import {
  Button,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  SelectField,
} from "../../components/ui";
import { RuntimeContext } from "../../lib/runtime-context";
import {
  folderOf,
  relativeTime,
  titleOf,
  useStore,
} from "../../components/hooks";
import { ProductIcon } from "../../components/ProductIcon";
import { environments } from "../connection/environments";
import { ThreadMenu } from "./ThreadMenu";
import { SectionControls } from "./SectionControls";
import { NavigationList, type NavigationListRow } from "./NavigationList";
import { navigationState, type NavigationStatus } from "./navigation-state";
import {
  navigationPersonalization,
  personalizationKey,
} from "./navigation-personalization";
import {
  navigationProjects,
  navigationThreads,
  navigationActivityAt,
  matchesNavigationStatus,
  recentDateLabel,
  threadStatus,
  type NavigationProject,
  type NavigationThread,
} from "./navigation-model";
import { navigationTitle } from "./navigation-title";
import { useNavigationData } from "./use-navigation-data";
import { historyLoading } from "./history-loading";
import { EnvironmentFilter } from "./EnvironmentFilter";

type SidebarProps = {
  onSearch: () => void;
  onTasks?: () => void;
  onSettings: () => void;
  onArchived: () => void;
  onNew: (cwd?: string, environmentId?: string) => void;
  filter: string;
  onFilterChange: (scope: string) => void;
  onCollapse: () => void;
  onSelect: () => void;
};
type Row = NavigationListRow &
  (
    | { kind: "project"; project: NavigationProject; collapsed: boolean }
    | { kind: "thread"; item: NavigationThread; nested: boolean }
    | { kind: "label"; label: string }
    | {
        kind: "more";
        project: NavigationProject;
        expanded: boolean;
        remaining: number;
      }
  );
const PROJECT_PREVIEW_SIZE = 5;
const filters: { value: NavigationStatus; label: string }[] = [
  {
    value: "all",
    get label() {
      return t("全部会话");
    },
  },
  {
    value: "attention",
    get label() {
      return t("待处理");
    },
  },
  {
    value: "running",
    get label() {
      return t("运行中");
    },
  },
  {
    value: "unread",
    get label() {
      return t("未读结果");
    },
  },
];

export const Sidebar = memo(function Sidebar(props: SidebarProps) {
  const i18nLocale = useLocale();
  void i18nLocale;

  const state = useStore(environments),
    preferences = useStore(navigationState),
    personal = useStore(navigationPersonalization);
  const data = useNavigationData(state.entries);
  const visible = data.filter(
    (source) =>
      props.filter === "all" || source.environment.id === props.filter,
  );
  const active = data.find(
    (source) => source.environment.id === state.activeId,
  )!;
  const newTarget = visible.length === 1 ? visible[0] : active;
  const [focusKey, setFocusKey] = useState<string>();
  const [expandedProjects, setExpandedProjects] = useState(new Set<string>());
  const [selectionReveal, setSelectionReveal] = useState(0);
  const [locateRequested, setLocateRequested] = useState(false);
  const [selectionVisible, setSelectionVisible] = useState(false);
  const expansionSelection = useRef("");
  const [showSections, setShowSections] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [openError, setOpenError] = useState("");
  const loadingScope = visible
    .map((source) =>
      JSON.stringify([
        source.environmentKey,
        source.environment.runtime.connection.getSnapshot().epoch,
        source.connected,
        source.sessions.sectionFilter,
      ]),
    )
    .join("|");
  useEffect(() => {
    const cancel = [...visible]
      .sort(
        (a, b) =>
          Number(b.environment.id === state.activeId) -
          Number(a.environment.id === state.activeId),
      )
      .filter((source) => source.connected)
      .map((source) =>
        historyLoading.enqueue(
          JSON.stringify([
            source.environmentKey,
            source.environment.runtime.connection.getSnapshot().epoch,
            source.sessions.sectionFilter,
          ]),
          () => source.environment.runtime.sessions.loadAll(),
        ),
      );
    return () => cancel.forEach((stop) => stop());
    // A failed history load waits for an explicit retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingScope]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const items = navigationThreads(visible, preferences.visits);
  const allProjects = navigationProjects(items);
  const selected = items.find(
    (item) =>
      item.source.environment.id === state.activeId &&
      item.thread.id === item.source.sessions.selectedId,
  );
  const selectedKey = selected?.key;
  const isThreadPinned = (item: NavigationThread) =>
    personal.pinnedThreads.includes(
      personalizationKey(item.source.environmentKey, item.thread.id),
    );
  const isProjectPinned = (project: NavigationProject) =>
    personal.pinnedProjects.includes(
      personalizationKey(project.source.environmentKey, project.id),
    );
  const isCollapsed = (project: NavigationProject) =>
    preferences.collapsed[project.key] ?? false;
  const projects = [...allProjects].sort(
    (a, b) => Number(isProjectPinned(b)) - Number(isProjectPinned(a)),
  );
  const filtered = items.filter((item) =>
    matchesNavigationStatus(item, preferences.status),
  );
  const count = (status: NavigationStatus) =>
    items.filter((item) => matchesNavigationStatus(item, status)).length;
  const compareThreads = (a: NavigationThread, b: NavigationThread) =>
    Number(isThreadPinned(b)) - Number(isThreadPinned(a)) ||
    navigationActivityAt(b.thread) - navigationActivityAt(a.thread) ||
    a.key.localeCompare(b.key);
  const projectNames = new Map(
    allProjects.map((project) => [project.key, project.name]),
  );
  const threadDescription = (item: NavigationThread, nested: boolean) => {
    const statusLabel = threadStatus(item);
    const status = item.source.sessions.localDrafts[item.thread.id]
      ? t("草稿 · 未发送")
      : !item.source.connected && !item.thread.turns.length
        ? t("离线 · 正文未缓存")
        : statusLabel === t("运行中")
          ? ""
          : statusLabel;
    if (nested) return status;
    const location = `${projectNames.get(item.projectKey) ?? folderOf(item.thread.cwd)} · ${item.source.environment.name}`;
    return status ? `${location} · ${status}` : location;
  };
  const rows: Row[] = [];
  if (preferences.view === "projects") {
    for (const project of projects) {
      const children = project.threads.filter((item) =>
        matchesNavigationStatus(item, preferences.status),
      );
      if (!children.length) continue;
      rows.push({
        kind: "project",
        key: project.key,
        project,
        collapsed: isCollapsed(project),
        height: 46,
        navigable: true,
        sticky: true,
      });
      if (!isCollapsed(project)) {
        const expanded = expandedProjects.has(project.key);
        const sorted = [...children].sort(compareThreads);
        for (const item of expanded
          ? sorted
          : sorted.slice(0, PROJECT_PREVIEW_SIZE))
          rows.push({
            kind: "thread",
            key: item.key,
            item,
            nested: true,
            height: threadDescription(item, true) ? 54 : 44,
            navigable: true,
          });
        if (sorted.length > PROJECT_PREVIEW_SIZE)
          rows.push({
            kind: "more",
            key: `more:${project.key}`,
            project,
            expanded,
            remaining: sorted.length - PROJECT_PREVIEW_SIZE,
            height: 44,
            navigable: true,
          });
      }
    }
  } else {
    const sorted = [...filtered].sort(compareThreads);
    let previousLabel = "";
    for (const item of sorted) {
      const label = isThreadPinned(item)
        ? t("收藏会话")
        : recentDateLabel(navigationActivityAt(item.thread) * 1000);
      if (label !== previousLabel) {
        rows.push({
          kind: "label",
          key: `date:${label}`,
          label,
          height: 30,
          navigable: false,
        });
        previousLabel = label;
      }
      rows.push({
        kind: "thread",
        key: item.key,
        item,
        nested: false,
        height: 54,
        navigable: true,
      });
    }
  }
  const selectedNeedsExpansion =
    !!selected &&
    [
      ...(projects.find((project) => project.key === selected.projectKey)
        ?.threads || []),
    ]
      .sort(compareThreads)
      .findIndex((item) => item.key === selected.key) >= PROJECT_PREVIEW_SIZE;
  const selectedWas = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!selected) return;
    if (selectedWas.current !== selected.key) {
      selectedWas.current = selected.key;
      expansionSelection.current = "";
      navigationState.setCollapsed(selected.projectKey, false);
    }
    if (selectedNeedsExpansion && expansionSelection.current !== selected.key) {
      expansionSelection.current = selected.key;
      setExpandedProjects((previous) =>
        new Set(previous).add(selected.projectKey),
      );
      setSelectionReveal((revision) => revision + 1);
    }
  }, [selected, selectedNeedsExpansion]);
  function toggleProjectHistory(key: string, expanded: boolean) {
    if (selected?.projectKey === key) expansionSelection.current = selected.key;
    setExpandedProjects((previous) => {
      const next = new Set(previous);
      if (expanded) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const taskCount = data.reduce((sum, source) => sum + source.tasks.length, 0);
  const otherTasks = data
    .filter((source) => !visible.includes(source))
    .reduce((sum, source) => sum + source.tasks.length, 0);
  const connectedCount = data.filter((source) => source.connected).length;
  const anyHistoryLoading = visible.some(
    (source) => source.sessions.loading || source.sessions.historyLoading,
  );
  const anySection = visible.some(
    (source) => source.sessions.sectionFilter !== "all",
  );
  const allCollapsed = projects.length > 0 && projects.every(isCollapsed);
  const canLocateCurrent =
    !!active?.sessions.selectedId &&
    !active.sessions.archivedIds[active.sessions.selectedId];
  const outsideCurrentScope =
    canLocateCurrent &&
    (!selected || !matchesNavigationStatus(selected, preferences.status));
  const hiddenCurrent =
    canLocateCurrent &&
    (outsideCurrentScope ||
      !rows.some((row) => row.key === selectedKey) ||
      !selectionVisible);
  const scopeKey = JSON.stringify([
    props.filter,
    preferences.view,
    preferences.status,
    visible.map((source) => [
      source.environmentKey,
      source.sessions.sectionFilter,
    ]),
  ]);
  function clearFilters() {
    navigationState.setStatus("all");
    for (const source of visible)
      if (source.sessions.sectionFilter !== "all")
        void source.environment.runtime.sessions
          .setSectionFilter("all")
          .catch(() => {});
  }
  function revealCurrent() {
    if (!canLocateCurrent) return;
    if (props.filter !== "all" && props.filter !== state.activeId)
      props.onFilterChange(state.activeId);
    if (outsideCurrentScope) navigationState.setStatus("all");
    if (
      active.environment.runtime.sessions.getSnapshot().sectionFilter !== "all"
    )
      void active.environment.runtime.sessions
        .setSectionFilter("all")
        .catch(() => {});
    const thread = active.sessions.threads[active.sessions.selectedId!];
    if (thread)
      navigationState.setCollapsed(
        JSON.stringify([
          active.environmentKey,
          thread.projectId
            ? `project:${thread.projectId}`
            : `cwd:${thread.cwd}`,
        ]),
        false,
      );
    expansionSelection.current = "";
    setLocateRequested(true);
  }
  function keyboard(event: KeyboardEvent, key: string) {
    const row = rows.find((row) => row.key === key);
    if (!row) return;
    if (
      row.kind === "project" &&
      ["ArrowLeft", "ArrowRight"].includes(event.key)
    ) {
      event.preventDefault();
      navigationState.setCollapsed(key, event.key === "ArrowLeft");
    } else if (
      row.kind === "thread" &&
      row.nested &&
      event.key === "ArrowLeft"
    ) {
      event.preventDefault();
      navigationState.setCollapsed(row.item.projectKey, true);
      setFocusKey(row.item.projectKey);
      requestAnimationFrame(() =>
        [...document.querySelectorAll<HTMLElement>("[data-navigation-key]")]
          .find((node) => node.dataset.navigationKey === row.item.projectKey)
          ?.querySelector<HTMLElement>("[data-navigation-primary]")
          ?.focus(),
      );
    }
  }
  const mac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <aside
      data-slot="sidebar"
      className="flex h-full min-w-0 flex-col border-r border-border bg-surface"
    >
      <div className="flex h-[62px] shrink-0 items-center gap-2.5 px-4">
        <ProductIcon className="size-7 shrink-0" />
        <strong className="text-brand tracking-[-0.6px]">Codex</strong>
        <span className="flex-1 text-meta text-muted">{t("工作台")}</span>
        <IconButton label={t("收起导航")} onClick={props.onCollapse}>
          <PanelLeftClose size={17} />
        </IconButton>
      </div>
      <div data-slot="sidebar-actions" className="shrink-0 px-3 pb-3">
        <Button
          variant="secondary"
          className="mb-1.5 w-full justify-start shadow-sm"
          onClick={() => props.onNew(undefined, newTarget?.environment.id)}
        >
          <Plus size={17} />
          {t("新建会话")}
          <span className="ml-auto text-fine text-subtle">
            {mac ? "⌘ ⇧ O" : "Ctrl ⇧ O"}
          </span>
        </Button>
        <Button
          variant="quiet"
          className="w-full justify-start"
          onClick={props.onSearch}
        >
          <Search size={16} />
          {t("搜索会话")}
          <span className="ml-auto text-fine text-subtle">
            {mac ? "⌘ K" : "Ctrl K"}
          </span>
        </Button>
        <Button
          variant="quiet"
          className="w-full justify-start"
          onClick={props.onTasks}
          aria-label={t("待办中心")}
        >
          <CircleHelp size={16} />
          {t("待办中心")}
          {taskCount > 0 && (
            <span
              className="ml-auto rounded-full bg-warning/10 px-2 text-xs text-warning"
              aria-label={t("{{value0}} 项待办", { value0: taskCount })}
            >
              {taskCount}
            </span>
          )}
        </Button>
        {otherTasks > 0 && (
          <button
            className="pl-8 text-fine text-warning"
            onClick={props.onTasks}
          >
            {t("其他环境有")}
            {otherTasks} {t("项待处理")}
          </button>
        )}
      </div>
      <div className="shrink-0 px-3 pb-3">
        <EnvironmentFilter
          entries={state.entries}
          value={props.filter}
          onValueChange={props.onFilterChange}
        />
      </div>
      <div className="shrink-0 px-3 pb-2">
        <div className="mb-2 flex items-center gap-1">
          <Tabs.Root
            value={preferences.view}
            onValueChange={(view) =>
              navigationState.setView(view === "recent" ? "recent" : "projects")
            }
            className="min-w-0 flex-1"
          >
            <Tabs.List aria-label={t("会话视图")} className="flex gap-4">
              <Tabs.Trigger value="projects" className="navigation-view">
                {t("项目")}
              </Tabs.Trigger>
              <Tabs.Trigger value="recent" className="navigation-view">
                {t("最近")}
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
          <IconButton
            size="sm"
            label={t("定位当前会话")}
            title={
              outsideCurrentScope
                ? t("当前会话不在此范围 · 定位当前会话")
                : hiddenCurrent
                  ? t("当前会话不在可见区域 · 定位当前会话")
                  : t("定位当前会话")
            }
            data-slot="locate-current-session"
            disabled={!canLocateCurrent}
            highlighted={hiddenCurrent}
            className="disabled:opacity-40"
            onClick={revealCurrent}
          >
            <LocateFixed size={14} aria-hidden="true" />
          </IconButton>
          {preferences.view === "projects" && (
            <IconButton
              size="sm"
              label={allCollapsed ? t("展开全部项目") : t("折叠全部项目")}
              disabled={!projects.length}
              onClick={() =>
                navigationState.collapseAll(
                  projects.map((project) => project.key),
                  !allCollapsed,
                )
              }
            >
              {allCollapsed ? (
                <ChevronsUpDown size={14} />
              ) : (
                <ChevronsDownUp size={14} />
              )}
            </IconButton>
          )}
          <Menu
            label={t("导航选项")}
            trigger={
              <IconButton size="sm" label={t("导航选项")}>
                <MoreHorizontal size={16} />
              </IconButton>
            }
          >
            <MenuItem
              onSelect={() => {
                if (anySection) {
                  clearFilters();
                  setShowSections(false);
                } else setShowSections((value) => !value);
              }}
            >
              {anySection
                ? t("清除分区筛选")
                : showSections
                  ? t("隐藏分区筛选")
                  : t("分区筛选与管理")}
            </MenuItem>
            <MenuItem
              onSelect={() => {
                clearFilters();
                props.onFilterChange("current");
              }}
            >
              {t("恢复默认视图范围")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={props.onArchived}>
              <Archive size={15} />
              {t("已归档的会话")}
            </MenuItem>
          </Menu>
        </div>
        <SelectField
          label={t("会话状态")}
          value={preferences.status}
          options={filters.map((filter) => ({
            value: filter.value,
            label: `${filter.label}${filter.value === "all" ? "" : ` · ${count(filter.value)}`}`,
          }))}
          onValueChange={(status) =>
            navigationState.setStatus(status as NavigationStatus)
          }
          className="w-full min-h-8 bg-transparent py-1 text-xs"
        />
        {(showSections || anySection) && (
          <div className="mt-2 flex items-center justify-between gap-2 text-fine text-muted">
            <span>{t("分区")}</span>
            <SectionControls
              entries={data
                .filter((source) => source.connected)
                .map((source) => source.environment)}
              preferredId={newTarget?.environment.id}
              deviceFilter={props.filter}
              onDeviceFilterChange={props.onFilterChange}
            />
          </div>
        )}
      </div>
      {rows.length > 0 ? (
        <NavigationList
          rows={rows}
          scope={scopeKey}
          selectedKey={selectedKey}
          selectionRevision={`${selected?.visited || 0}:${selectionReveal}`}
          selectionLoading={anyHistoryLoading}
          revealSelection={locateRequested}
          onSelectionRevealed={() => setLocateRequested(false)}
          onSelectionVisibilityChange={setSelectionVisible}
          focusKey={focusKey}
          onFocusKey={setFocusKey}
          onKeyDown={keyboard}
          render={(row, tabStop) => {
            if (row.kind === "more")
              return (
                <button
                  data-slot="project-history-toggle"
                  data-navigation-primary
                  data-project-key={row.project.key}
                  aria-expanded={row.expanded}
                  tabIndex={tabStop ? 0 : -1}
                  className="flex h-10 w-full items-center gap-1.5 rounded-lg pl-5 pr-2 text-left text-fine text-muted hover:bg-hover hover:text-foreground"
                  onClick={() =>
                    toggleProjectHistory(row.project.key, row.expanded)
                  }
                >
                  {row.expanded ? (
                    <ChevronUp size={13} />
                  ) : (
                    <ChevronDown size={13} />
                  )}
                  {row.expanded
                    ? t("收起为 {{value0}} 条", {
                        value0: PROJECT_PREVIEW_SIZE,
                      })
                    : t("展开其余 {{value0}} 条会话", {
                        value0: row.remaining,
                      })}
                </button>
              );
            if (row.kind === "label")
              return (
                <div className="px-3 pt-2 text-fine font-medium text-subtle">
                  {row.label}
                </div>
              );
            if (row.kind === "project") {
              const { project, collapsed } = row,
                pinned = isProjectPinned(project);
              const collision =
                projects.filter((other) => other.name === project.name).length >
                1;
              return (
                <div
                  data-slot="workspace-heading"
                  data-environment-id={project.source.environment.id}
                  role="treeitem"
                  aria-level={1}
                  aria-expanded={!collapsed}
                  className="group flex h-full min-w-0 items-center gap-0.5"
                >
                  <button
                    data-slot="workspace-toggle"
                    data-navigation-primary
                    aria-expanded={!collapsed}
                    tabIndex={tabStop ? 0 : -1}
                    title={`${project.source.environment.name} · ${project.cwd}`}
                    onClick={() =>
                      navigationState.setCollapsed(project.key, !collapsed)
                    }
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-hover"
                  >
                    {collapsed ? (
                      <ChevronRight size={13} />
                    ) : (
                      <ChevronDown size={13} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 text-xs font-semibold text-muted">
                        {pinned && (
                          <Star size={11} className="fill-accent text-accent" />
                        )}
                        <span className="truncate">{project.name}</span>
                        {project.attention > 0 && (
                          <span className="ml-auto text-fine text-warning">
                            {project.attention} {t("待处理")}
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-fine text-subtle">
                        {props.filter === "all"
                          ? `${project.source.environment.name} · `
                          : ""}
                        {collision
                          ? project.cwd
                          : project.source.connected
                            ? project.source.sessions.historyComplete
                              ? t("{{value0}} 条会话", {
                                  value0: project.threads.length,
                                })
                              : t("已加载 {{value0}} 条", {
                                  value0: project.threads.length,
                                })
                            : t("离线缓存 · 状态待同步")}
                      </span>
                    </span>
                  </button>
                  <IconButton
                    size="sm"
                    tabIndex={tabStop ? 0 : -1}
                    className="navigation-row-menu"
                    label={t("{{value0}}：{{value1}}", {
                      value0: pinned ? t("取消收藏项目") : t("收藏项目"),
                      value1: project.name,
                    })}
                    aria-pressed={pinned}
                    onClick={() =>
                      navigationPersonalization.toggleProject(
                        project.source.environmentKey,
                        project.id,
                      )
                    }
                  >
                    <Star
                      size={14}
                      className={pinned ? "fill-accent text-accent" : ""}
                    />
                  </IconButton>
                  <IconButton
                    size="sm"
                    tabIndex={tabStop ? 0 : -1}
                    label={t("在 {{value0}} 新建会话", {
                      value0: project.name,
                    })}
                    disabled={!project.source.connected}
                    onClick={() =>
                      props.onNew(project.cwd, project.source.environment.id)
                    }
                  >
                    <Plus size={14} />
                  </IconButton>
                </div>
              );
            }
            const { item } = row,
              { thread, source } = item,
              status = threadStatus(item),
              description = threadDescription(item, row.nested),
              selected = item.key === selectedKey;
            const pinned = isThreadPinned(item);
            const activityAt = navigationActivityAt(thread);
            const updated = !item.running && (
              <time
                dateTime={new Date(activityAt * 1000).toISOString()}
                title={t("最近活动：{{value0}}", {
                  value0: new Date(activityAt * 1000).toLocaleString(
                    getLocale(),
                  ),
                })}
                className="shrink-0 text-fine text-subtle"
              >
                {relativeTime(activityAt, now)}
              </time>
            );
            const icon = item.initializing ? (
              <LoaderCircle
                data-slot="initializing-indicator"
                size={14}
                className="animate-spin text-accent"
                role="img"
                aria-label={t(item.initializing)}
              >
                <title>{t(item.initializing)}</title>
              </LoaderCircle>
            ) : !source.connected && item.running ? (
              <CircleAlert
                size={13}
                className="text-subtle"
                aria-label={t("状态待同步")}
              />
            ) : item.waiting || status === t("待核实") ? (
              <CircleHelp
                size={13}
                className="text-warning"
                aria-label={t(item.waiting || "待核实")}
              />
            ) : item.failed ? (
              <CircleAlert
                size={13}
                className="text-danger"
                aria-label={t("执行失败")}
              />
            ) : item.running ? (
              <LoaderCircle
                data-slot="running-indicator"
                size={13}
                className="animate-spin text-accent"
                role="img"
                aria-label={t("运行中")}
              />
            ) : item.unread ? (
              <CircleCheck
                data-slot="thread-completion-indicator"
                size={14}
                strokeWidth={2.5}
                className="shrink-0 text-success"
                role="img"
                aria-label={t("已完成，结果未读")}
              >
                <title>{t("已完成，结果未读")}</title>
              </CircleCheck>
            ) : null;
            return (
              <RuntimeContext.Provider value={source.environment.runtime}>
                <div
                  data-slot="thread-row"
                  data-environment-id={source.environment.id}
                  role="treeitem"
                  aria-level={row.nested ? 2 : 1}
                  aria-selected={selected}
                  data-selected={selected}
                  style={{ height: row.height - 4 }}
                  className={`group relative flex min-w-0 items-center gap-0.5 rounded-lg ${selected ? "bg-selected" : "hover:bg-hover"}`}
                >
                  <ThreadMenu
                    thread={thread}
                    environmentKey={source.environmentKey}
                  >
                    <button
                      aria-current={selected ? "page" : undefined}
                      data-navigation-primary
                      data-slot="thread-link"
                      tabIndex={tabStop ? 0 : -1}
                      title={t(
                        "{{value0}}\n{{value1}} · {{value2}}\n最近更新：{{value3}}",
                        {
                          value0: titleOf(thread),
                          value1: source.environment.name,
                          value2: thread.cwd,
                          value3: new Date(
                            thread.updatedAt * 1000,
                          ).toLocaleString(getLocale()),
                        },
                      )}
                      className="flex h-full min-w-0 flex-1 items-center gap-2 py-1.5 pl-5 pr-1 text-left"
                      onClick={() => {
                        setOpenError("");
                        environments.select(source.environment.id);
                        void source.environment.runtime.sessions
                          .open(thread.id)
                          .then(() => props.onSelect())
                          .catch((error) =>
                            setOpenError(
                              error instanceof Error
                                ? error.message
                                : t("打开失败，请重试。"),
                            ),
                          );
                      }}
                    >
                      <span className="min-w-0 flex-1 pl-1">
                        <span className="relative flex min-w-0 items-center gap-1.5">
                          {icon && (
                            <span
                              data-slot="thread-status"
                              className="absolute -left-4.5 top-1/2 flex size-3.5 -translate-y-1/2 items-center justify-center"
                            >
                              {icon}
                            </span>
                          )}
                          <span
                            data-slot="thread-title"
                            className="min-w-0 flex-1 truncate text-xs"
                          >
                            {navigationTitle(thread)}
                          </span>
                          {pinned && <Pin size={10} aria-label={t("已收藏")} />}
                          {!description && updated}
                        </span>
                        {description && (
                          <span
                            data-slot="thread-description"
                            className="mt-0.5 flex min-w-0 items-center gap-1 text-fine text-subtle"
                          >
                            <span
                              className={`min-w-0 flex-1 truncate ${item.waiting || status === t("待核实") ? "text-warning" : item.failed ? "text-danger" : ""}`}
                            >
                              {description}
                            </span>
                            {updated}
                          </span>
                        )}
                      </span>
                    </button>
                  </ThreadMenu>
                  <ThreadMenu
                    thread={thread}
                    environmentKey={source.environmentKey}
                    trigger={
                      <IconButton
                        size="sm"
                        tabIndex={tabStop ? 0 : -1}
                        className="navigation-row-menu navigation-thread-menu"
                        label={t("会话操作：{{value0}}", {
                          value0: titleOf(thread),
                        })}
                      >
                        <MoreHorizontal size={15} />
                      </IconButton>
                    }
                  />
                </div>
              </RuntimeContext.Provider>
            );
          }}
        />
      ) : (
        <div
          className="min-h-0 flex-1 px-5 py-8 text-xs leading-relaxed text-muted"
          role="status"
        >
          {anyHistoryLoading ? (
            <>
              <LoaderCircle size={18} className="mb-3 animate-spin" />
              {t("正在加载会话…")}
            </>
          ) : preferences.status !== "all" || anySection ? (
            <>
              <p>{t("当前筛选条件下没有会话。")}</p>
              <Button
                size="sm"
                variant="quiet"
                className="mt-3"
                onClick={clearFilters}
              >
                {t("清除筛选")}
              </Button>
            </>
          ) : visible.some((source) => source.connected) ? (
            <>
              <p>{t("还没有会话，从一个新任务开始。")}</p>
              <Button
                size="sm"
                className="mt-3"
                onClick={() =>
                  props.onNew(undefined, newTarget?.environment.id)
                }
              >
                {t("创建第一个会话")}
              </Button>
            </>
          ) : (
            <>
              <p>{t("工作环境未连接。")}</p>
              <Button size="sm" className="mt-3" onClick={props.onSettings}>
                {t("打开连接设置")}
              </Button>
            </>
          )}
        </div>
      )}
      <div className="shrink-0 px-3 text-fine text-muted" aria-live="polite">
        {visible.map((source) => (
          <div
            key={source.environmentKey}
            data-slot="environment-projects"
            data-connected={source.connected}
          >
            {!source.connected && (
              <p className="my-2">
                {source.environment.name} ·{" "}
                {source.environment.runtime.connection.getSnapshot().error
                  ? t("连接失败")
                  : t("未连接")}
                {source.sessions.listIds.length
                  ? t(" · 显示缓存，状态待同步")
                  : t(" · 历史尚未同步")}
              </p>
            )}
            {source.sessions.historyLoading && (
              <p className="my-2 flex items-center gap-1.5">
                <LoaderCircle size={11} className="animate-spin" />
                {source.environment.name} {t("· 正在补齐历史…")}
              </p>
            )}
            {(source.sessions.historyError || source.sessions.error) && (
              <div className="my-2 rounded-md bg-danger-soft p-2 text-danger">
                <p>
                  {source.environment.name} ·{" "}
                  {source.sessions.listIds.length
                    ? t("部分历史未加载")
                    : t("会话加载失败")}
                </p>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={!source.connected || source.sessions.historyLoading}
                  onClick={() =>
                    void source.environment.runtime.sessions
                      .loadAll()
                      .catch(() => {})
                  }
                >
                  {t("重试")}
                </Button>
              </div>
            )}
          </div>
        ))}
        {openError && (
          <div role="alert" className="my-2 text-danger">
            {openError}
            <button className="ml-2 underline" onClick={() => setOpenError("")}>
              {t("关闭")}
            </button>
          </div>
        )}
      </div>
      <footer
        data-slot="sidebar-footer"
        className="shrink-0 border-t border-border px-3 py-2"
      >
        <nav aria-label={t("工作台工具")} className="grid grid-cols-2 gap-1">
          <Button
            size="sm"
            variant="quiet"
            className="justify-start"
            aria-label={t("已归档的会话")}
            onClick={props.onArchived}
          >
            <Archive size={15} />
            {t("归档")}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            data-slot="connection-entry"
            data-settings-trigger
            className="justify-start"
            onClick={props.onSettings}
          >
            <Settings size={15} />
            <strong className="font-medium">{t("设置")}</strong>
          </Button>
        </nav>
        <div
          className="flex items-center gap-1.5 px-2 pt-1 text-fine text-subtle"
          title={data
            .map((source) =>
              t("{{value0}}：{{value1}}", {
                value0: source.environment.name,
                value1: source.connected ? t("已连接") : t("未连接"),
              }),
            )
            .join("\n")}
        >
          <span
            aria-hidden="true"
            className={`size-1.5 shrink-0 rounded-full ${connectedCount === data.length ? "bg-success" : connectedCount ? "bg-warning" : "bg-subtle"}`}
          />
          <span>
            {connectedCount === data.length
              ? t("{{value0}} 个环境已连接", { value0: connectedCount })
              : connectedCount
                ? t("{{value0}} / {{value1}} 个环境已连接", {
                    value0: connectedCount,
                    value1: data.length,
                  })
                : t("工作环境未连接")}
          </span>
        </div>
      </footer>
    </aside>
  );
});
