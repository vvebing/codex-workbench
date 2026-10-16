import {
  ScrollArea,
  ErrorNotice,
  Button,
  IconButton,
  Modal,
  SelectField,
} from "../../components/ui";
import { lazy, useCallback, useEffect, useRef, useState } from "react";
import { LazyFeature } from "../../components/LazyFeature";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  PanelLeft,
  PanelRight,
  Plus,
  ArrowUpRight,
  X,
  Folder,
  Check,
} from "lucide-react";
import { RuntimeContext, useRuntime } from "../../lib/runtime-context";
import { environments } from "../connection/environments";
import { EnvironmentIcon } from "../connection/EnvironmentIcon";
import { ConnectionBanner } from "../connection/ConnectionBanner";
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
import { Sidebar } from "../navigation/Sidebar";
import { ThreadMenu } from "../navigation/ThreadMenu";
const SearchDialog = lazy(() =>
  import("../navigation/SearchDialog").then((module) => ({
    default: module.SearchDialog,
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
  const [sessionFilter, setSessionFilter] = useState("all");
  const [newEnvironmentId, setNewEnvironmentId] = useState(environment.id);
  const newEnvironment =
    environmentState.entries.find((entry) => entry.id === newEnvironmentId) ||
    environment;
  const newSessions = useStore(newEnvironment.runtime.sessions);
  const newConnection = useStore(newEnvironment.runtime.connection);
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
  const [projectTab, setProjectTab] = useState<ProjectTab>("files");
  useEffect(() => {
    if (files.visible && narrow) setDetails(false);
  }, [files.visible, files.openRevision, narrow]);
  const [agentId, setAgentId] = useState<string>();
  useEffect(() => {
    if (files.visible) setAgentId(undefined);
  }, [files.visible, files.openRevision]);
  useEffect(() => {
    runtime.files.setVisible(false);
  }, [runtime, sessions.selectedId]);
  const [mobileNav, setMobileNav] = useState(false);
  const [search, setSearch] = useState(false);
  const [settings, setSettings] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [cwd, setCwd] = useState("");
  const [newBusy, setNewBusy] = useState(false);
  const [newError, setNewError] = useState("");
  const createLock = useRef(false);
  const thread = sessions.selectedId
    ? sessions.threads[sessions.selectedId]
    : undefined;
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
  const inspectAgent = useCallback((id: string) => {
    setAgentId(id);
  }, []);
  const closeAgent = useCallback(() => {
    setAgentId(undefined);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>("[data-slot=agent-entry]")
        ?.focus(),
    );
  }, []);
  useEffect(() => {
    setAgentId(undefined);
  }, [thread?.id, environment.id]);
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
        state.entries.find(
          (entry) =>
            entry.id === targetId &&
            entry.runtime.connection.getSnapshot().status === "connected",
        ) ||
        state.entries.find(
          (entry) =>
            entry.runtime.connection.getSnapshot().status === "connected",
        ) ||
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
      setNewOpen(true);
      setMobileNav(false);
    },
    [sessionFilter],
  );
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.isComposing || e.defaultPrevented) return;
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
  }, [canCreate, newChat]);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (createLock.current) return;
    createLock.current = true;
    setNewBusy(true);
    setNewError("");
    try {
      await newEnvironment.runtime.sessions.create({
        ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
      });
      environments.select(newEnvironment.id);
      setNewOpen(false);
    } catch (e) {
      setNewError(e instanceof Error ? e.message : String(e));
    } finally {
      createLock.current = false;
      setNewBusy(false);
    }
  }
  const navigation = (
    <Sidebar
      filter={sessionFilter}
      onFilterChange={setSessionFilter}
      onSearch={() => {
        setSearch(true);
        setMobileNav(false);
      }}
      onSettings={() => {
        setSettings(true);
        setMobileNav(false);
      }}
      onNew={newChat}
      onCollapse={() => (narrow ? setMobileNav(false) : setSidebar(false))}
      onSelect={() => setMobileNav(false)}
    />
  );
  const detailView = (
    <div data-slot="details-shell" className="flex h-full flex-col bg-surface">
      <header className="flex h-[57px] shrink-0 items-center justify-between border-b border-border px-[17px] text-[12px] font-medium">
        <span>项目面板</span>
        <IconButton label="关闭项目面板" onClick={() => setDetails(false)}>
          <X size={17} />
        </IconButton>
      </header>
      <LazyFeature>
        <Details
          key={`${environment.id}:${thread?.id}`}
          thread={thread}
          tab={projectTab}
          onTabChange={setProjectTab}
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
          className="flex min-w-0 items-center gap-[9px] text-[12px] text-muted max-[900px]:flex-1 max-[900px]:gap-1.5 max-[550px]:[&>span]:hidden"
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
            <button
              className="mt-1 block underline"
              onClick={() => setSettings(true)}
            >
              连接设置
            </button>
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
                loading={sessions.openingId === thread.id}
                onRollback={
                  connected
                    ? (turnId, messageId) =>
                        runtime.revert(thread.id, turnId, messageId)
                    : undefined
                }
                key={`timeline:${environment.id}:${thread.id}`}
                completedItems={sessions.completedItems}
                startedItems={sessions.startedItems}
                onInspectAgent={inspectAgent}
                toolProgress={sessions.toolProgress}
                waitingItems={requests.pending.flatMap((request) =>
                  "threadId" in request.params &&
                  request.params.threadId === thread.id &&
                  "itemId" in request.params
                    ? [String(request.params.itemId)]
                    : [],
                )}
                fileOutputs={sessions.fileOutputs[thread.id]}
                turnDiffs={sessions.diffs[thread.id]}
                turnPlans={sessions.plans[thread.id]}
                finishedTurns={sessions.finishedTurns[thread.id]}
                thread={thread}
              />
            </LazyFeature>
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
        ) : (
          <div
            data-slot="welcome"
            className="m-auto max-h-full overflow-y-auto px-6 pt-[30px] pb-[90px] text-center max-[550px]:pb-[55px]"
          >
            <ProductIcon className="mx-auto mb-[25px] size-16" />
            <span className="text-[10px] font-semibold tracking-[1.1px] text-muted">
              CODEX WORKBENCH
            </span>
            <h1 className="mt-[13px] mb-[17px] text-[32px] font-[550] tracking-[-1px] max-[550px]:text-[26px]">
              把想法，变成下一步。
            </h1>
            <p className="mb-[27px] text-[14px] leading-[1.9] text-muted">
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
              <div className="mt-[22px] text-[11px] text-muted">
                从左侧选择历史会话，或按 <kbd>⌘ K</kbd> 搜索
              </div>
            )}
          </div>
        )}
      </ConversationWorkspace>
    </main>
  );
  return (
    <>
      <CompletionNotifications />
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
          <PanelGroup
            direction="horizontal"
            autoSaveId="codex-workbench-panels"
          >
            {sidebar && (
              <>
                <Panel
                  id="navigation"
                  order={1}
                  defaultSize={21}
                  minSize={16}
                  maxSize={30}
                >
                  {navigation}
                </Panel>
                <PanelResizeHandle
                  className="w-0.5 bg-border/60 transition-colors hover:bg-accent data-[resize-handle-active]:bg-accent"
                  aria-label="调整导航宽度"
                />
              </>
            )}
            <Panel id="conversation" order={2} minSize={35}>
              {main}
            </Panel>
            {details && (
              <>
                <PanelResizeHandle
                  className="w-0.5 bg-border/60 transition-colors hover:bg-accent data-[resize-handle-active]:bg-accent"
                  aria-label="调整详情宽度"
                />
                <Panel
                  id="details"
                  order={3}
                  defaultSize={27}
                  minSize={22}
                  maxSize={40}
                >
                  {detailView}
                </Panel>
              </>
            )}
          </PanelGroup>
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
        variant="drawer"
      >
        {navigation}
      </Modal>
      <Modal
        open={narrow && details}
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
          <SearchDialog open={search} onOpenChange={setSearch} />
        </LazyFeature>
      )}
      <Modal
        open={newOpen}
        onOpenChange={setNewOpen}
        title="新建会话"
        description="选择工作环境和项目目录，创建后发送第一条消息即可开始。"
      >
        <form onSubmit={(e) => void create(e)}>
          <div className="mb-5 flex flex-col gap-2">
            <span className="text-[12px] text-muted">工作环境</span>
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
              options={environmentState.entries
                .filter(
                  (entry) =>
                    entry.runtime.connection.getSnapshot().status ===
                    "connected",
                )
                .map((entry) => ({ value: entry.id, label: entry.name }))}
            />
          </div>
          <label
            htmlFor="new-workspace-path"
            className="block text-[13px] font-medium"
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
            <span className="text-[12px] text-muted">
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
          {recentWorkspaces.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[12px] text-muted">最近使用的目录</p>
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
                      <span className="block truncate text-[12px]">
                        {folderOf(path)}
                      </span>
                      <span className="block break-all font-mono text-[11px] text-muted">
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
