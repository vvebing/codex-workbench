import {
  projectPanelKey,
  projectPanelState,
  normalizeProjectTab,
} from "../conversation/project-panel-state";
import {
  ScrollArea,
  ErrorNotice,
  Button,
  IconButton,
  Modal,
  SelectField,
} from "../../components/ui";
import { lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { projectsFor, normalizeProjectDirectory } from "../projects/store";
import { LazyFeature } from "../../components/LazyFeature";
import { ShellPanels } from "./ShellPanels";
import { useViewportWidth } from "./sidebar-layout";
import {
  PanelLeft,
  PanelRight,
  Plus,
  ArrowUpRight,
  X,
  Folder,
  Check,
  FileSearch,
  Search,
} from "lucide-react";
import { RuntimeContext, useRuntime } from "../../lib/runtime-context";
import { environments } from "../connection/environments";
import { EnvironmentIcon } from "../connection/EnvironmentIcon";
import { ConnectionBanner } from "../connection/ConnectionBanner";
import {
  AppServerReleaseChecks,
  AppServerUpdateNotice,
} from "../connection/AppServerUpdate";
import { ConnectionNotices } from "../connection/AccountStatus";
import {
  useStore,
  useNarrow,
  useVisualViewport,
  titleOf,
  folderOf,
} from "../../components/hooks";

import { WorkspacePicker } from "./WorkspacePicker";
import { BranchChanges } from "./BranchChanges";
import { ConversationWorkspace } from "../files/ConversationWorkspace";
import { TaskCenter } from "../task-center/TaskCenter";
import { Sidebar } from "../navigation/Sidebar";
import { ThreadMenu } from "../navigation/ThreadMenu";
import {
  navigationState,
  navigationEnvironmentKey,
} from "../navigation/navigation-state";
import { SessionActionNotifications } from "../navigation/SessionActionNotifications";
const SearchDialog = lazy(() =>
  import("../navigation/SearchDialog").then((module) => ({
    default: module.SearchDialog,
  })),
);
const QuickOpen = lazy(() =>
  import("../search/QuickOpen").then((module) => ({
    default: module.QuickOpen,
  })),
);
const SettingsDialog = lazy(() =>
  import("../settings/SettingsDialog").then((module) => ({
    default: module.SettingsDialog,
  })),
);
const Composer = lazy(() =>
  import("../composer/Composer").then((module) => ({
    default: module.Composer,
  })),
);
const AgentDrawer = lazy(() =>
  import("../conversation/AgentDrawer").then((module) => ({
    default: module.AgentDrawer,
  })),
);
const Timeline = lazy(() =>
  import("../conversation/Timeline").then((module) => ({
    default: module.Timeline,
  })),
);
import type { ProjectTab } from "../conversation/Details";
const Details = lazy(() =>
  import("../conversation/Details").then((module) => ({
    default: module.Details,
  })),
);
import { CompletionNotifications } from "../navigation/CompletionNotifications";
import { ApprovalQueue } from "../approvals/ApprovalQueue";
import { protectPageExit } from "../../lib/page-exit";
import { ProductIcon } from "../../components/ProductIcon";
import {
  browserIconState,
  updateBrowserIcon,
} from "../navigation/browser-icon";
import { SessionUrlStore } from "../navigation/session-url";
import { browserTitle } from "../navigation/browser-title";
const sessionUrl = new SessionUrlStore(environments, window);
export default function App() {
  useVisualViewport();
  const state = useStore(environments);
  const active = state.entries.find((entry) => entry.id === state.activeId)!;
  const iconState = browserIconState(state.entries);
  useEffect(() => sessionUrl.start(), []);
  useEffect(() => {
    const update = () => updateBrowserIcon(iconState, import.meta.env.BASE_URL);
    update();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [iconState]);
  useEffect(() => {
    return protectPageExit(
      () => environments.getSnapshot().entries.map((entry) => entry.runtime),
      environments.subscribe,
    );
  }, []);
  useEffect(() => {
    environments.restoreConnections();
    const updateVisibility = () => {
      for (const entry of environments.getSnapshot().entries) {
        entry.runtime.sessions.setPageFocused(document.hasFocus());
        entry.runtime.sessions.setPageVisible(
          document.visibilityState !== "hidden",
        );
      }
    };
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    window.addEventListener("focus", updateVisibility);
    window.addEventListener("blur", updateVisibility);
    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
      window.removeEventListener("focus", updateVisibility);
      window.removeEventListener("blur", updateVisibility);
    };
  }, []);
  return (
    <RuntimeContext.Provider value={active.runtime}>
      <AppView />
    </RuntimeContext.Provider>
  );
}
function AppView() {
  const route = useStore(sessionUrl);
  const runtime = useRuntime();
  const environmentState = useStore(environments);
  const environment = environments.active();
  const navigationPreferences = useStore(navigationState);
  const sessionFilter =
    navigationPreferences.scope === "current" ||
    (!environmentState.entries.some(
      (entry) => entry.id === navigationPreferences.scope,
    ) &&
      navigationPreferences.scope !== "all")
      ? environment.id
      : navigationPreferences.scope;
  const setSessionFilter = useCallback(
    (scope: string) => navigationState.setScope(scope),
    [],
  );
  const [newEnvironmentId, setNewEnvironmentId] = useState(environment.id);
  const newEnvironment =
    environmentState.entries.find((entry) => entry.id === newEnvironmentId) ||
    environment;
  const newSessions = useStore(newEnvironment.runtime.sessions);
  const newConnection = useStore(newEnvironment.runtime.connection);
  const newProjects = useMemo(
    () => projectsFor(newEnvironment.runtime.connection, newEnvironment.id),
    [newEnvironment.runtime.connection, newEnvironment.id],
  );
  const projectSettings = useStore(newProjects);
  const recentWorkspaces = [
    ...new Set(
      Object.values(newSessions.threads)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((thread) => thread.cwd)
        .filter(Boolean),
    ),
  ].slice(0, 5);
  const connection = useStore(runtime.connection);
  const sessions = useStore(runtime.sessions);
  const files = useStore(runtime.files);
  const requests = useStore(runtime.requests);
  const narrow = useNarrow();
  const [sidebar, setSidebar] = useState(true);
  const [details, setDetails] = useState(false);
  const viewportWidth = useViewportWidth();
  const detailsDrawer =
    narrow || viewportWidth < (sidebar ? 240 : 0) + 280 + 480 + 4;

  useEffect(() => {
    if (files.visible && detailsDrawer) setDetails(false);
  }, [files.visible, files.openRevision, detailsDrawer]);
  const [agentId, setAgentId] = useState<string>();
  const [taskAgent, setTaskAgent] = useState<{
    environmentId: string;
    id: string;
    hostThreadId?: string;
  }>();
  useEffect(() => {
    if (files.visible) setAgentId(undefined);
  }, [files.visible, files.openRevision]);
  const [mobileNav, setMobileNav] = useState(false);
  const [search, setSearch] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [taskCenter, setTaskCenter] = useState(false);
  const [settings, setSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    "general" | "activity"
  >("general");
  const [newOpen, setNewOpen] = useState(false);
  const [newCreated, setNewCreated] = useState(false);
  const [cwd, setCwd] = useState("");
  const projectDefaults = projectSettings.projects.find(
    (project) => project.cwd === normalizeProjectDirectory(cwd),
  );
  const [newBusy, setNewBusy] = useState(false);
  const [newError, setNewError] = useState("");
  const createLock = useRef(false);
  const thread = sessions.selectedId
    ? sessions.threads[sessions.selectedId]
    : undefined;
  const navigationKey = navigationEnvironmentKey(environment);
  useEffect(() => {
    if (sessions.selectedId)
      navigationState.visit(navigationKey, sessions.selectedId);
  }, [navigationKey, sessions.selectedId]);
  const panelScope = JSON.stringify([environment.id, connection.scope]);
  const panelKey = projectPanelKey(panelScope, thread);
  const hasThread = !!thread;
  const editorContext = useRef<
    | {
        runtime: typeof runtime;
        scope: string;
        project: string;
        threadId: string | null;
      }
    | undefined
  >(undefined);
  useEffect(() => {
    const previous = editorContext.current;
    // A destination that is still loading has no reliable project identity yet.
    // Keep the editor mounted while waiting for its metadata.
    if (sessions.selectedId && !hasThread) {
      if (previous?.runtime !== runtime || previous.scope !== panelScope)
        runtime.files.setVisible(false);
      return;
    }
    if (
      !previous ||
      previous.runtime !== runtime ||
      previous.scope !== panelScope ||
      !sessions.selectedId ||
      (previous.threadId !== sessions.selectedId &&
        previous.project !== panelKey)
    )
      runtime.files.setVisible(false);
    editorContext.current = {
      runtime,
      scope: panelScope,
      project: panelKey,
      threadId: sessions.selectedId,
    };
  }, [runtime, panelScope, panelKey, sessions.selectedId, hasThread]);
  const [panelChoice, setPanelChoice] = useState<{
    key: string;
    tab: ProjectTab;
  }>();
  const projectTab =
    panelChoice?.key === panelKey
      ? normalizeProjectTab(panelChoice.tab)
      : projectPanelState.tab(panelKey);
  const setProjectTab = useCallback(
    (tab: ProjectTab) => {
      projectPanelState.select(panelKey, tab);
      setPanelChoice({ key: panelKey, tab });
    },
    [panelKey],
  );
  const revealedRevision = useRef<typeof files.revealRequest>(undefined);
  useEffect(() => {
    const request = files.revealRequest;
    if (!request || request === revealedRevision.current) return;
    revealedRevision.current = request;
    if (
      !thread ||
      normalizeProjectDirectory(request.cwd) !==
        normalizeProjectDirectory(thread.cwd)
    )
      return;
    setProjectTab("files");
    setDetails(true);
  }, [files.revealRequest, thread, setProjectTab]);
  const pageTitle = browserTitle({
    thread: route.status === "ready" ? thread : undefined,
    draft: !!(thread && sessions.localDrafts[thread.id]),
    connected: connection.status === "connected",
    environmentName:
      environmentState.entries.length > 1 ? environment.name : undefined,
    pendingRequests: requests.pending,
  });
  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);
  const inspectAgent = useCallback(
    (id: string) => {
      setTaskAgent({
        environmentId: environment.id,
        id,
        hostThreadId: thread?.id,
      });
    },
    [environment.id, thread?.id],
  );
  const closeAgent = useCallback(() => {
    setTaskAgent(undefined);
    setAgentId(undefined);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>("[data-slot=agent-entry]")
        ?.focus(),
    );
  }, []);
  useEffect(() => {
    setAgentId(
      taskAgent?.environmentId === environment.id &&
        taskAgent.hostThreadId === thread?.id
        ? taskAgent.id
        : undefined,
    );
  }, [thread?.id, environment.id, taskAgent]);
  useEffect(() => {
    if (!agentId) return;
    const close = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !document.querySelector(
          "[data-slot=modal][data-state=open], [data-slot=agent-list]",
        )
      ) {
        event.preventDefault();
        closeAgent();
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [agentId, closeAgent]);
  const connected = connection.status === "connected";
  const openContentSearch = useCallback(() => {
    setQuickOpen(false);
    setAgentId(undefined);
    setProjectTab("search");
    setDetails(true);
    requestAnimationFrame(() =>
      window.dispatchEvent(new Event("workspace-content-search-focus")),
    );
  }, [setProjectTab]);
  const canCreate = environmentState.entries.some(
    (entry) => entry.runtime.connection.getSnapshot().status === "connected",
  );
  const newChat = useCallback(
    (path?: string, environmentId?: string) => {
      const state = environments.getSnapshot();
      const targetId =
        environmentId ||
        (sessionFilter === "all" ? state.activeId : sessionFilter);
      const target =
        state.entries.find((entry) => entry.id === targetId) ||
        environments.active();
      const sessions = target.runtime.sessions.getSnapshot();
      setNewEnvironmentId(target.id);
      setCwd(
        path ||
          (sessions.selectedId
            ? sessions.threads[sessions.selectedId]?.cwd
            : "") ||
          "",
      );
      setNewError("");
      setNewCreated(false);
      setNewOpen(true);
      setMobileNav(false);
    },
    [sessionFilter],
  );
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.isComposing || e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && thread?.cwd) {
        if (!e.shiftKey && e.key.toLowerCase() === "p") {
          e.preventDefault();
          setSearch(false);
          setQuickOpen(true);
          return;
        }
        if (e.shiftKey && e.key.toLowerCase() === "f") {
          e.preventDefault();
          setSearch(false);
          openContentSearch();
          return;
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch((v) => !v);
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "o" &&
        canCreate
      ) {
        e.preventDefault();
        newChat();
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [canCreate, newChat, thread?.cwd, openContentSearch]);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (createLock.current) return;
    createLock.current = true;
    setNewBusy(true);
    setNewError("");
    try {
      const created = await newEnvironment.runtime.sessions.create({
        ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
        ...(projectDefaults?.model ? { model: projectDefaults.model } : {}),
      });
      if (projectDefaults?.description)
        newEnvironment.runtime.drafts.setText(
          created.id,
          `项目说明：\n${projectDefaults.description}\n\n任务：\n`,
        );
      environments.select(newEnvironment.id);
      setNewCreated(true);
      setNewOpen(false);
    } catch (e) {
      setNewError(e instanceof Error ? e.message : String(e));
    } finally {
      createLock.current = false;
      setNewBusy(false);
    }
  }
  const openSearch = useCallback(() => {
    setSearch(true);
    setMobileNav(false);
  }, []);
  const openSettings = useCallback(() => {
    setSettingsSection("general");
    setSettings(true);
    setMobileNav(false);
  }, []);
  const collapseNavigation = useCallback(() => {
    if (narrow) setMobileNav(false);
    else setSidebar(false);
  }, [narrow]);
  const selectNavigation = useCallback(() => setMobileNav(false), []);
  const openTasks = useCallback(() => {
    setTaskCenter(true);
    setMobileNav(false);
  }, []);
  const openArchived = useCallback(() => {
    setSettingsSection("activity");
    setSettings(true);
    setMobileNav(false);
  }, []);
  const navigation = (
    <Sidebar
      filter={sessionFilter}
      onFilterChange={setSessionFilter}
      onTasks={openTasks}
      onSearch={openSearch}
      onSettings={openSettings}
      onArchived={openArchived}
      onNew={newChat}
      onCollapse={collapseNavigation}
      onSelect={selectNavigation}
    />
  );
  const detailView = (
    <div data-slot="details-shell" className="flex h-full flex-col bg-surface">
      <header className="flex h-[57px] shrink-0 items-center justify-between border-b border-border px-[17px] text-caption font-medium">
        <span>项目面板</span>
        <IconButton label="关闭项目面板" onClick={() => setDetails(false)}>
          <X size={17} />
        </IconButton>
      </header>
      <LazyFeature>
        <Details
          key={`${environment.id}:${thread?.id}`}
          thread={thread}
          cacheScope={panelScope}
          tab={projectTab}
          onTabChange={setProjectTab}
          environmentId={environment.id}
          onCreateProjectTask={(config) => newChat(config.cwd, environment.id)}
          onSelectWorktree={(path) => newChat(path, environment.id)}
        />
      </LazyFeature>
    </div>
  );
  const main = (
    <main
      className="flex h-full min-w-0 flex-col bg-background max-[900px]:w-full"
      id="main"
      aria-label={titleOf(thread)}
    >
      <header
        data-slot="topbar"
        className="flex h-[57px] min-h-[57px] items-center gap-[9px] border-b border-border/60 px-[22px] max-[1100px]:px-[13px] max-[900px]:gap-[5px] max-[900px]:px-[9px] max-[550px]:h-[55px] max-[550px]:min-h-[55px]"
      >
        {(narrow || !sidebar) && (
          <IconButton
            label="打开导航"
            onClick={() => (narrow ? setMobileNav(true) : setSidebar(true))}
          >
            <PanelLeft size={18} />
          </IconButton>
        )}
        <div
          data-slot="breadcrumb"
          className="flex min-w-0 items-center gap-[9px] text-caption text-muted max-[900px]:flex-1 max-[900px]:gap-1.5 max-[550px]:[&>span]:hidden"
        >
          <EnvironmentIcon environment={environment} cwd={thread?.cwd} />
          <span title={thread?.cwd}>
            {thread ? folderOf(thread.cwd) : "工作环境"}
          </span>
          <span className="text-subtle">/</span>
          <strong
            className="max-w-[280px] truncate font-medium text-foreground max-[1100px]:max-w-[180px] max-[550px]:max-w-[150px]"
            title={titleOf(thread)}
          >
            {titleOf(thread)}
          </strong>
        </div>
        {thread && (
          <ThreadMenu key={`${environment.id}:${thread.id}`} thread={thread} />
        )}
        <div className="flex-1 max-[900px]:hidden" />
        {thread?.cwd && (
          <>
            <IconButton
              label="快速打开文件"
              title="快速打开文件 (⌘/Ctrl+P)"
              onClick={() => setQuickOpen(true)}
            >
              <FileSearch size={18} />
            </IconButton>
            <IconButton
              label="搜索文件内容"
              title="搜索文件内容 (⌘/Ctrl+Shift+F)"
              onClick={openContentSearch}
            >
              <Search size={18} />
            </IconButton>
          </>
        )}
        <BranchChanges
          thread={thread}
          onOpenGit={() => {
            setAgentId(undefined);
            setProjectTab("git");
            setDetails(true);
          }}
        />

        <IconButton
          label={details ? "关闭项目面板" : "打开项目面板"}
          aria-expanded={details}
          onClick={() => {
            setAgentId(undefined);
            setDetails(!details);
          }}
        >
          <PanelRight size={18} />
        </IconButton>
      </header>
      {!connected && (
        <ConnectionBanner
          key={`connection-banner:${environment.id}`}
          environment={environment}
          connection={connection}
          onSettings={() => setSettings(true)}
        />
      )}
      <ConnectionNotices connection={runtime.connection} />
      <AppServerUpdateNotice environment={environment} />
      {connected && (sessions.error || connection.error) && (
        <ErrorNotice
          data-slot="global-error"
          className="mx-5 my-2 shrink-0"
          onDismiss={
            sessions.error ? () => runtime.sessions.clearError() : undefined
          }
        >
          {sessions.error || connection.error}
          {!sessions.error && (
            <Button
              size="sm"
              variant="quiet"
              className="mt-1"
              onClick={() => setSettings(true)}
            >
              连接设置
            </Button>
          )}
        </ErrorNotice>
      )}
      {files.documents.length > 0 && !files.visible && (
        <button
          className="border-b border-border px-5 py-2 text-left text-xs text-muted hover:bg-surface"
          onClick={() => runtime.files.setVisible(true)}
        >
          返回文件编辑器 · {files.documents.length} 个文件
          {files.documents.some((file) => file.dirty) ? " · 有未保存修改" : ""}
        </button>
      )}
      <ConversationWorkspace key={environment.id}>
        {route.status !== "ready" ? (
          <div
            className="m-auto max-w-lg px-6 text-center"
            data-slot="session-link-state"
          >
            <h1 className="mb-3 text-xl font-medium">
              {route.status === "error" ? "会话暂不可用" : "正在打开会话"}
            </h1>
            <p
              role={route.status === "error" ? "alert" : "status"}
              className="mb-5 text-sm text-muted"
            >
              {route.message}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {route.status === "error" && (
                <Button onClick={sessionUrl.retry}>重试</Button>
              )}
              {(route.status === "error" || route.status === "waiting") && (
                <Button onClick={() => setSettings(true)}>连接设置</Button>
              )}
              <Button variant="secondary" onClick={sessionUrl.home}>
                返回会话首页
              </Button>
            </div>
          </div>
        ) : thread ? (
          <>
            <LazyFeature>
              <Timeline
                cacheScope={JSON.stringify([environment.id, connection.scope])}
                hasOlder={Boolean(sessions.historyPages[thread.id]?.cursor)}
                loadingOlder={sessions.historyPages[thread.id]?.loading}
                onLoadOlder={() => {
                  void runtime.sessions.loadOlder(thread.id);
                }}
                loading={sessions.openingId === thread.id}
                onRollback={
                  connected && !sessions.archivedIds[thread.id]
                    ? (turnId, messageId) =>
                        runtime.revert(thread.id, turnId, messageId)
                    : undefined
                }
                key={`timeline:${environment.id}:${runtime.submissions.messages.threadIdentity(thread.id)}`}
                completedItems={sessions.completedItems}
                startedItems={sessions.startedItems}
                toolProgress={sessions.toolProgress}
                fileOutputs={sessions.fileOutputs[thread.id]}
                onInspectAgent={inspectAgent}
                turnDiffs={sessions.diffs[thread.id]}
                finishedTurns={sessions.finishedTurns[thread.id]}
                thread={thread}
              />
            </LazyFeature>
            {sessions.archivedIds[thread.id] ? (
              <div
                data-slot="archived-conversation"
                role="status"
                className="flex shrink-0 items-center gap-3 border-t border-border bg-surface px-5 py-4 text-xs text-muted"
              >
                <span className="flex-1">
                  此会话已归档，阅读位置和草稿已保留。恢复后可继续对话。
                </span>
                <Button
                  size="sm"
                  disabled={!connected || sessions.loading}
                  onClick={() =>
                    void runtime.sessions
                      .unarchive(thread.id, true)
                      .catch(() => {})
                  }
                >
                  恢复会话
                </Button>
              </div>
            ) : (
              <>
                <ScrollArea className="max-h-[38vh] shrink-0">
                  <div>
                    <ApprovalQueue threadId={thread.id} />
                  </div>
                </ScrollArea>
                <LazyFeature>
                  <Composer
                    key={`composer:${environment.id}:${sessions.draftOrigins[thread.id] || thread.id}`}
                    threadId={thread.id}
                    onInspectAgent={inspectAgent}
                  />
                </LazyFeature>
              </>
            )}
          </>
        ) : (
          <ScrollArea
            data-slot="welcome"
            className="m-auto max-h-full"
            viewportProps={{
              className:
                "px-6 pt-[30px] pb-[90px] text-center max-[550px]:pb-[55px]",
            }}
          >
            <ProductIcon className="mx-auto mb-[25px] size-16" />
            <span className="text-fine font-semibold tracking-[1.1px] text-muted">
              CODEX WORKBENCH
            </span>
            <h1 className="mt-[13px] mb-[17px] text-display font-[550] tracking-[-1px] max-[550px]:text-title">
              把想法，变成下一步。
            </h1>
            <p className="mb-[27px] text-body leading-intro text-muted">
              在你的工作区里思考、编写与验证。
              <br />
              从一个清晰的任务开始。
            </p>
            <Button
              variant="primary"
              onClick={() => (connected ? newChat() : setSettings(true))}
            >
              <Plus size={17} />
              {connected ? "开始新会话" : "连接工作环境"}
              <ArrowUpRight size={16} />
            </Button>
            {connected && (
              <div className="mt-[22px] text-meta text-muted">
                从左侧选择历史会话，或按 <kbd>⌘ K</kbd> 搜索
              </div>
            )}
          </ScrollArea>
        )}
      </ConversationWorkspace>
    </main>
  );
  return (
    <>
      <CompletionNotifications />
      <SessionActionNotifications />
      {taskCenter && (
        <TaskCenter
          open
          onOpenChange={setTaskCenter}
          onInspectAgent={(environmentId, id) =>
            setTaskAgent({
              environmentId,
              id,
              hostThreadId:
                environments
                  .getSnapshot()
                  .entries.find((entry) => entry.id === environmentId)
                  ?.runtime.sessions.getSnapshot().selectedId ?? undefined,
            })
          }
        />
      )}
      <AppServerReleaseChecks />
      <a
        href="#main"
        className="fixed top-[5px] left-[5px] z-[100] -translate-y-[150%] bg-elevated p-3 focus:translate-y-0"
      >
        跳转到对话
      </a>
      <div data-slot="app-shell" className="h-dvh overflow-hidden">
        {narrow ? (
          main
        ) : (
          <ShellPanels
            width={viewportWidth}
            navigation={sidebar ? navigation : undefined}
            details={details && !detailsDrawer ? detailView : undefined}
          >
            {main}
          </ShellPanels>
        )}
      </div>
      {agentId && (
        <LazyFeature>
          {narrow ? (
            <Modal
              open
              onOpenChange={(open) => {
                if (!open) closeAgent();
              }}
              title="子代理详情"
              variant="details"
              returnFocusSelector="[data-slot=agent-entry]"
            >
              <AgentDrawer
                key={`${environment.id}:${thread?.id}:${agentId}`}
                id={agentId}
                onClose={closeAgent}
              />
            </Modal>
          ) : (
            <div className="fixed inset-y-0 right-0 z-30 w-[min(560px,calc(100vw-16px))] border-l border-border shadow-xl">
              <AgentDrawer
                key={`${environment.id}:${thread?.id}:${agentId}`}
                id={agentId}
                onClose={closeAgent}
              />
            </div>
          )}
        </LazyFeature>
      )}
      <Modal
        open={narrow && mobileNav}
        onOpenChange={setMobileNav}
        title="工作区导航"
        returnFocusSelector='button[aria-label="打开导航"]'
        variant="drawer"
      >
        {navigation}
      </Modal>
      <Modal
        open={detailsDrawer && details}
        onOpenChange={setDetails}
        title="项目面板"
        variant="details"
      >
        {detailView}
      </Modal>
      {settings && (
        <LazyFeature>
          <SettingsDialog
            open={settings}
            initialSection={settingsSection}
            onOpenChange={setSettings}
            onRestored={(id) => {
              environments.select(id);
              setSettings(false);
            }}
          />
        </LazyFeature>
      )}
      {search && (
        <LazyFeature>
          <SearchDialog
            open={search}
            onOpenChange={setSearch}
            initialScope={sessionFilter}
            onLocated={selectNavigation}
          />
        </LazyFeature>
      )}
      {quickOpen && thread && (
        <LazyFeature>
          <QuickOpen
            key={JSON.stringify([
              environment.id,
              connection.epoch,
              connection.scope,
              thread.cwd,
              thread.id,
            ])}
            thread={thread}
            onClose={() => setQuickOpen(false)}
          />
        </LazyFeature>
      )}
      <Modal
        open={newOpen}
        onOpenChange={setNewOpen}
        title="新建会话"
        returnFocusSelector={newCreated ? "#message-input" : undefined}
        description="选择工作环境和项目目录，创建后发送第一条消息即可开始。"
      >
        <form onSubmit={(e) => void create(e)}>
          <div className="mb-5 flex flex-col gap-2">
            <span className="text-caption text-muted">工作环境</span>
            <SelectField
              label="新会话工作环境"
              value={newEnvironment.id}
              disabled={newBusy}
              className="w-full"
              onValueChange={(id) => {
                setNewEnvironmentId(id);
                setCwd("");
                setNewError("");
              }}
              options={environmentState.entries.map((entry) => ({
                value: entry.id,
                label: `${entry.name}${entry.runtime.connection.getSnapshot().status === "connected" ? "" : " · 未连接"}`,
              }))}
            />
          </div>
          {newConnection.status !== "connected" && (
            <p role="status" className="mb-4 text-xs text-warning">
              「{newEnvironment.name}
              」未连接。请先连接该环境，或明确选择其他环境。
            </p>
          )}
          <label
            htmlFor="new-workspace-path"
            className="block text-control font-medium"
          >
            工作目录
          </label>
          {newOpen && (
            <WorkspacePicker
              key={`${newEnvironment.id}-${newConnection.epoch}`}
              client={newEnvironment.runtime.connection.client}
              value={cwd}
              onChange={(path) => {
                setCwd(path);
                setNewError("");
              }}
              environmentName={newEnvironment.name}
              connected={newConnection.status === "connected"}
              disabled={newBusy}
              initialPath={recentWorkspaces[0]}
            />
          )}
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-caption text-muted">
              {cwd.trim() ? "已指定项目目录" : "将使用环境默认目录"}
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={newBusy || !cwd}
              onClick={() => {
                setCwd("");
                setNewError("");
              }}
            >
              使用默认目录
            </Button>
          </div>
          {projectDefaults && (
            <div className="mt-3 rounded-lg border border-border p-3 text-xs text-muted">
              <p>
                项目默认模型：{projectDefaults.model || "使用新会话默认设置"}
              </p>
              {projectDefaults.description && (
                <p className="mt-2 whitespace-pre-wrap">
                  以下项目说明将填入输入草稿，不会自动发送：{"\n"}
                  {projectDefaults.description}
                </p>
              )}
            </div>
          )}
          {recentWorkspaces.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-caption text-muted">最近使用的目录</p>
              <div className="flex flex-col gap-1">
                {recentWorkspaces.map((path) => (
                  <button
                    key={path}
                    type="button"
                    disabled={newBusy}
                    aria-pressed={cwd.trim() === path}
                    onClick={() => {
                      setCwd(path);
                      setNewError("");
                    }}
                    className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-border px-3 py-2 text-left hover:bg-hover aria-pressed:border-accent aria-pressed:bg-hover disabled:opacity-50"
                  >
                    <Folder size={16} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-caption">
                        {folderOf(path)}
                      </span>
                      <span className="block break-all font-mono text-meta text-muted">
                        {path}
                      </span>
                    </span>
                    {cwd.trim() === path && (
                      <Check size={15} className="shrink-0 text-accent" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
          {newError && (
            <ErrorNotice className="mt-3" onDismiss={() => setNewError("")}>
              {newError}
            </ErrorNotice>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setNewOpen(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={newConnection.status !== "connected" || newBusy}
            >
              {newBusy ? "正在创建…" : "创建会话"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
