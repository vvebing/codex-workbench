import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ChevronDown,
  Copy,
  Eye,
  ListChecks,
  LockKeyhole,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Plus,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
import { Popover } from "radix-ui";
import { Button, ErrorNotice, IconButton, Modal } from "../../components/ui";
import { useNarrow, useStore } from "../../components/hooks";
import { t, useLocale } from "../../lib/i18n";
import { useRuntime } from "../../lib/runtime-context";
import {
  terminalsFor,
  normalizeTerminalDirectory,
  type TerminalSession,
  type TerminalStore,
} from "./store";
import { TerminalSurface } from "./TerminalSurface";
import { singleLineCommand } from "./presentation";
import "./terminal.css";

export interface TerminalPanelProps {
  environmentId: string;
  environmentName: string;
  cwd: string;
  threadId?: string;
  onAddToConversation?: (text: string, session: TerminalSession) => void;
  taskContent?: ReactNode;
  taskRevision?: string;
}

interface TerminalLayout {
  height: number;
  maximized: boolean;
  view: "terminal" | "tasks";
  lastTaskRevision?: string;
}
// Responsive shell changes remount the panel. Keep layout for this page only;
// execution state, terminal output and browser storage are unaffected.
const terminalLayouts = new WeakMap<
  TerminalStore,
  Map<string, TerminalLayout>
>();
function rememberTerminalLayout(
  store: TerminalStore,
  key: string,
  layout: TerminalLayout,
) {
  let entries = terminalLayouts.get(store);
  if (!entries) {
    entries = new Map();
    terminalLayouts.set(store, entries);
  }
  entries.delete(key);
  entries.set(key, layout);
  while (entries.size > 64) entries.delete(entries.keys().next().value!);
}

function statusLabel(status: TerminalSession["status"]) {
  const labels = {
    starting: t("正在启动"),
    running: t("已连接"),
    stopping: t("正在结束"),
    exited: t("已退出"),
    unknown: t("状态待核实"),
    unsupported: t("终端不可用"),
    failed: t("启动失败"),
  };
  return labels[status];
}
function live(session: TerminalSession) {
  return ["starting", "running", "stopping"].includes(session.status);
}
function activityLabel(session: TerminalSession) {
  if (session.status !== "running") return statusLabel(session.status);
  if (session.background) return t("后台任务运行中");
  if (session.activity === "idle") return t("空闲");
  if (session.activity === "busy") return t("运行中");
  return t("状态待确认");
}
interface TerminalCloseTarget {
  id: string;
  cwd: string;
  scope: number;
  epoch: number;
  store: TerminalStore;
  kind: "busy" | "unverified" | "record";
  name: string;
  trigger: HTMLElement | null;
}

export function TerminalPanel({
  environmentId,
  environmentName,
  cwd: projectDirectory,
  threadId,
  onAddToConversation,
  taskContent,
  taskRevision,
}: TerminalPanelProps) {
  useLocale();
  const { connection } = useRuntime();
  const detailsTitle = useId();
  const cwd = normalizeTerminalDirectory(projectDirectory);
  const store = useMemo(
    () => terminalsFor(connection, environmentId),
    [connection, environmentId],
  );
  const state = useStore(store);
  const connectionState = useStore(connection);
  const connected = connectionState.status === "connected";
  const layoutKey = JSON.stringify([connectionState.scope, cwd]);
  const narrow = useNarrow();
  const [view, setView] = useState<"terminal" | "tasks">(() => {
    const saved = terminalLayouts.get(store)?.get(layoutKey);
    return taskRevision && taskRevision !== saved?.lastTaskRevision
      ? "tasks"
      : (saved?.view ?? "terminal");
  });
  const [height, setHeight] = useState(
    () => terminalLayouts.get(store)?.get(layoutKey)?.height ?? 280,
  );
  const [maximized, setMaximized] = useState(
    () => terminalLayouts.get(store)?.get(layoutKey)?.maximized ?? false,
  );
  const [lastTaskRevision, setLastTaskRevision] = useState(taskRevision);
  const [actualHeight, setActualHeight] = useState(280);
  const [selection, setSelection] = useState<{ id: string; text: string }>();
  const [notice, setNotice] = useState("");
  const [closeTarget, setCloseTarget] = useState<TerminalCloseTarget>();
  const [command, setCommand] = useState("");
  const [readiness, setReadiness] = useState<{ id: string; ready: boolean }>();
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ pointer: number; y: number; height: number } | null>(
    null,
  );
  const sessions = state.sessions.filter((session) => session.cwd === cwd);
  const session =
    sessions.find((item) => item.id === state.selected[cwd]) ?? sessions.at(-1);
  const selectedText =
    selection?.id === session?.id ? (selection?.text ?? "") : "";
  const writable =
    connected &&
    !narrow &&
    !!session &&
    ["starting", "running"].includes(session.status);
  const pending =
    state.pendingCommand?.cwd === cwd ? state.pendingCommand : undefined;
  const surfaceReady =
    !!session && readiness?.id === session.id && readiness.ready;
  const focusContext = useRef({
    store,
    cwd,
    sessionId: session?.id,
    writable,
    ready: surfaceReady,
    visible: state.visible,
    view,
  });
  focusContext.current = {
    store,
    cwd,
    sessionId: session?.id,
    writable,
    ready: surfaceReady,
    visible: state.visible,
    view,
  };
  const sessionId = session?.id;
  const updateReadiness = useCallback(
    (ready: boolean) => {
      const target = focusContext.current;
      if (
        !sessionId ||
        target.store !== store ||
        target.cwd !== cwd ||
        target.sessionId !== sessionId
      )
        return;
      setReadiness((previous) =>
        previous?.id === sessionId && previous.ready === ready
          ? previous
          : { id: sessionId, ready },
      );
    },
    [store, cwd, sessionId],
  );
  const maximumHeight = () =>
    Math.max(180, Math.floor(window.innerHeight * 0.75));
  const changeHeight = (value: number) => {
    setMaximized(false);
    setHeight(Math.max(180, Math.min(maximumHeight(), value)));
  };

  useEffect(() => {
    const element = panel.current;
    if (!element || !state.visible) return;
    const observer = new ResizeObserver(([entry]) => {
      setActualHeight(
        Math.round(entry.borderBoxSize[0]?.blockSize ?? element.clientHeight),
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [state.visible]);
  useLayoutEffect(() => {
    rememberTerminalLayout(store, layoutKey, {
      height,
      maximized,
      view,
      lastTaskRevision,
    });
  }, [store, layoutKey, height, maximized, view, lastTaskRevision]);
  useEffect(() => {
    if (taskRevision === lastTaskRevision) return;
    if (taskRevision) setView("tasks");
    setLastTaskRevision(taskRevision);
  }, [taskRevision, lastTaskRevision]);
  useEffect(() => {
    if (pending) {
      setCommand(singleLineCommand(pending.command));
      setView("terminal");
    }
  }, [pending]);
  const updateSelection = useCallback(
    (text: string) => {
      if (session) setSelection({ id: session.id, text });
    },
    [session],
  );

  const create = () => {
    if (!connected || narrow || !cwd) return;
    setView("terminal");
    setNotice("");
    void store.create(cwd);
  };
  const copySelection = async () => {
    if (!selectedText) return;
    try {
      await navigator.clipboard.writeText(selectedText);
      setNotice("");
    } catch {
      setNotice(t("复制失败，请检查浏览器剪贴板权限。"));
    }
  };
  const requestClose = (
    item: TerminalSession,
    index: number,
    trigger: HTMLElement,
  ) => {
    const owner = connection.getSnapshot();
    const currentSession = store
      .getSnapshot()
      .sessions.find((entry) => entry.id === item.id && entry.cwd === cwd);
    if (!currentSession || currentSession.status === "stopping") return;
    if (["exited", "failed", "unsupported"].includes(currentSession.status)) {
      store.remove(currentSession.id);
      return;
    }
    if (narrow && live(currentSession)) return;
    if (
      owner.status === "connected" &&
      currentSession.status === "running" &&
      currentSession.activity === "idle" &&
      !currentSession.background
    ) {
      void store.close(currentSession.id);
      return;
    }
    setCloseTarget({
      id: currentSession.id,
      cwd,
      scope: owner.scope,
      epoch: owner.epoch,
      store,
      kind:
        owner.status !== "connected" || currentSession.status === "unknown"
          ? "record"
          : currentSession.activity === "busy" || currentSession.background
            ? "busy"
            : "unverified",
      name: t("终端 {{value0}}", { value0: index + 1 }),
      trigger,
    });
  };
  const confirmClose = () => {
    const target = closeTarget;
    const owner = connection.getSnapshot();
    if (
      !target ||
      target.store !== store ||
      target.cwd !== cwd ||
      target.scope !== owner.scope ||
      target.epoch !== owner.epoch
    ) {
      setCloseTarget(undefined);
      return;
    }
    const item = store
      .getSnapshot()
      .sessions.find((entry) => entry.id === target.id && entry.cwd === cwd);
    if (!item) {
      setCloseTarget(undefined);
      return;
    }
    if (target.kind === "record") {
      if (!live(item)) store.remove(item.id);
    } else if (["exited", "failed", "unsupported"].includes(item.status)) {
      store.remove(item.id);
    } else if (owner.status !== "connected" || item.status === "unknown") {
      setCloseTarget({ ...target, kind: "record" });
      return;
    } else if (!narrow) {
      void store.close(item.id);
    } else return;
    setCloseTarget(undefined);
  };
  const fillCommand = async () => {
    if (!session || !pending || !writable || !surfaceReady || !command.trim())
      return;
    const owner = connection.getSnapshot();
    // No newline or control bytes: Enter always remains the user's action.
    await store.write(session.id, singleLineCommand(command));
    store.consumeCommand(pending.revision);
    // Consuming the pending command removes its focused button. Wait for that
    // render, then return focus only to the exact shell that received the text.
    requestAnimationFrame(() => {
      const target = focusContext.current;
      const currentConnection = connection.getSnapshot();
      if (
        target.store !== store ||
        target.cwd !== cwd ||
        target.sessionId !== session.id ||
        !target.writable ||
        !target.ready ||
        !target.visible ||
        target.view !== "terminal" ||
        currentConnection.status !== "connected" ||
        currentConnection.epoch !== owner.epoch ||
        currentConnection.scope !== owner.scope
      )
        return;
      const surface = panel.current?.querySelector<HTMLElement>(
        "[data-slot=terminal-surface]",
      );
      if (surface?.dataset.terminalId !== session.id) return;
      const input = surface.querySelector<HTMLTextAreaElement>("textarea");
      if (input && !input.readOnly && !input.disabled) input.focus();
    });
  };

  const projectName = cwd.split("/").filter(Boolean).at(-1) || cwd;
  const sessionStatus = !connected
    ? t("环境已断线，暂不可输入")
    : session
      ? activityLabel(session)
      : t("终端将在新建后启动");
  const sessionWarning = !connected
    ? t("环境已断线，暂不可输入")
    : session?.status === "unknown"
      ? t("无法确认原进程是否仍在运行。请先核实，再重新执行命令。")
      : session?.error ||
        (session && !live(session)
          ? `${statusLabel(session.status)}${session.exitCode !== undefined ? ` · ${t("退出码 {{value0}}", { value0: session.exitCode })}` : ""}`
          : "");

  if (!state.visible) return null;
  return (
    <section
      ref={panel}
      className="terminal-panel"
      data-slot="terminal-panel"
      data-maximized={maximized || undefined}
      aria-label={t("项目终端")}
      style={{ height: maximized ? undefined : height }}
    >
      <div
        className="terminal-resize"
        role="separator"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label={t("调整终端高度")}
        aria-valuemin={180}
        aria-valuemax={Math.max(actualHeight, maximumHeight())}
        aria-valuenow={actualHeight}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointer: event.pointerId,
            y: event.clientY,
            height: maximized
              ? (event.currentTarget.parentElement?.clientHeight ?? height)
              : height,
          };
        }}
        onPointerMove={(event) => {
          if (drag.current?.pointer === event.pointerId)
            changeHeight(drag.current.height + drag.current.y - event.clientY);
        }}
        onPointerUp={(event) => {
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 64 : 24;
          if (event.key === "ArrowUp") changeHeight(height + step);
          else if (event.key === "ArrowDown") changeHeight(height - step);
          else if (event.key === "Home") changeHeight(180);
          else if (event.key === "End") changeHeight(maximumHeight());
          else return;
          event.preventDefault();
        }}
      />
      <div
        className="terminal-toolbar"
        data-has-selection={!!selectedText || undefined}
      >
        <div
          className="terminal-view-tabs"
          role="group"
          aria-label={t("执行面板")}
        >
          <IconButton
            size="sm"
            label={t("终端")}
            className="terminal-view-tab"
            highlighted={view === "terminal"}
            aria-pressed={view === "terminal"}
            onClick={() => setView("terminal")}
          >
            <TerminalIcon size={15} aria-hidden="true" />
          </IconButton>
          {taskContent && (
            <IconButton
              size="sm"
              label={t("项目命令")}
              className="terminal-view-tab"
              highlighted={view === "tasks"}
              aria-pressed={view === "tasks"}
              onClick={() => setView("tasks")}
            >
              <ListChecks size={15} aria-hidden="true" />
            </IconButton>
          )}
        </div>
        {view === "terminal" && (
          <div
            className="terminal-session-tabs"
            role="group"
            aria-label={t("终端会话")}
          >
            {sessions.map((item, index) => {
              const name = t("终端 {{value0}}", { value0: index + 1 });
              const activity = activityLabel(item);
              const stopping = item.status === "stopping";
              const busy =
                item.status === "running" &&
                (item.activity === "busy" || item.background);
              const mobileReadOnly = narrow && live(item);
              return (
                <div
                  key={item.id}
                  className="terminal-tab"
                  data-slot="terminal-tab"
                  data-terminal-id={item.id}
                  data-active={item.id === session?.id || undefined}
                  data-activity={item.activity ?? "unknown"}
                >
                  <button
                    type="button"
                    className="terminal-session-tab"
                    aria-pressed={item.id === session?.id}
                    aria-label={`${name} · ${activity}`}
                    title={`${item.initialCwd} · ${activity}`}
                    onClick={() => store.select(cwd, item.id)}
                  >
                    {busy ? (
                      <LoaderCircle
                        size={12}
                        className="terminal-activity-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <span
                        className="terminal-status-dot"
                        data-status={item.status}
                        aria-hidden="true"
                      />
                    )}
                    <span className="terminal-tab-name">{name}</span>
                    {!(
                      item.status === "running" &&
                      item.activity === "idle" &&
                      !item.background
                    ) && (
                      <span className="terminal-activity-label">
                        {activity}
                      </span>
                    )}
                  </button>
                  <IconButton
                    size="sm"
                    className="terminal-tab-close"
                    label={t("关闭终端 {{value0}}", { value0: index + 1 })}
                    title={
                      mobileReadOnly
                        ? t("手机仅支持查看输出，无法关闭运行中的终端。")
                        : stopping
                          ? t("正在结束")
                          : t("关闭终端 {{value0}}", { value0: index + 1 })
                    }
                    aria-description={
                      mobileReadOnly
                        ? t("手机仅支持查看输出，无法关闭运行中的终端。")
                        : undefined
                    }
                    disabled={stopping || mobileReadOnly}
                    onClick={(event) => {
                      event.stopPropagation();
                      requestClose(item, index, event.currentTarget);
                    }}
                  >
                    {stopping ? (
                      <LoaderCircle
                        size={12}
                        className="terminal-activity-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <X size={13} aria-hidden="true" />
                    )}
                  </IconButton>
                </div>
              );
            })}
          </div>
        )}
        {view === "tasks" && <span className="terminal-toolbar-space" />}
        {view === "terminal" && (
          <span
            className="terminal-readonly"
            data-slot="terminal-readonly"
            title={t(
              "终端以只读方式运行，不允许网络访问；文件访问仍受执行环境策略限制。",
            )}
          >
            <LockKeyhole size={12} aria-hidden="true" />
            {t("只读")}
          </span>
        )}
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="terminal-scope"
              data-slot="terminal-scope"
              aria-label={t("查看终端环境与权限")}
              title={`${environmentName} · ${cwd}`}
            >
              {narrow ? (
                <Eye
                  size={13}
                  aria-label={t("手机仅支持查看输出")}
                  role="img"
                />
              ) : null}
              <span className="terminal-environment">{environmentName}</span>
              {projectName && (
                <span className="terminal-project-name">/ {projectName}</span>
              )}
              <ChevronDown
                size={11}
                className="terminal-scope-chevron"
                aria-hidden="true"
              />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="terminal-details"
              data-slot="terminal-details"
              side="top"
              align="end"
              sideOffset={8}
              collisionPadding={12}
              aria-labelledby={detailsTitle}
            >
              <div className="terminal-details-heading">
                <strong id={detailsTitle}>
                  {view === "terminal" ? t("终端信息") : t("项目命令信息")}
                </strong>
                <Popover.Close asChild>
                  <IconButton size="sm" label={t("关闭终端信息")}>
                    <X size={14} />
                  </IconButton>
                </Popover.Close>
              </div>
              <dl>
                <div>
                  <dt>{t("执行环境")}</dt>
                  <dd>{environmentName}</dd>
                </div>
                <div>
                  <dt>{t("项目目录")}</dt>
                  <dd>
                    <code>{cwd || t("尚未选择项目")}</code>
                  </dd>
                </div>
                {view === "terminal" && session && (
                  <div>
                    <dt>{t("初始目录")}</dt>
                    <dd>
                      <code>{session.initialCwd}</code>
                    </dd>
                  </div>
                )}
                <div>
                  <dt>{t("权限配置")}</dt>
                  <dd>
                    {view === "terminal" ? t("只读") : t("由执行环境决定")}
                  </dd>
                </div>
                <div>
                  <dt>{t("网络")}</dt>
                  <dd>
                    {view === "terminal" ? t("网络受限") : t("由执行环境决定")}
                  </dd>
                </div>
                {view === "terminal" && (
                  <div>
                    <dt>{t("状态")}</dt>
                    <dd>
                      {sessionStatus}
                      {session?.exitCode !== undefined &&
                        ` · ${t("退出码 {{value0}}", { value0: session.exitCode })}`}
                    </dd>
                  </div>
                )}
              </dl>
              {narrow && <p>{t("手机仅支持查看输出")}</p>}
              {view === "terminal" ? (
                <>
                  <p>
                    {t(
                      "支持文件浏览、内容搜索、日志查看、环境检查，以及 Git 查询。",
                    )}
                  </p>
                  <p>
                    {t(
                      "终端以只读方式运行，不允许网络访问；文件访问仍受执行环境策略限制。",
                    )}
                  </p>
                </>
              ) : (
                <p>{t("项目命令沿用执行环境配置。")}</p>
              )}
              {view === "terminal" && session?.error && (
                <p className="terminal-details-warning">{session.error}</p>
              )}
              {view === "terminal" && session?.truncated && (
                <p>{t("早期输出已清理")}</p>
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        {view === "terminal" && !!selectedText && (
          <div className="terminal-selection-actions">
            <IconButton
              size="sm"
              label={t("复制选中输出")}
              onClick={() => void copySelection()}
            >
              <Copy size={14} />
            </IconButton>
            {onAddToConversation && threadId && session && (
              <IconButton
                size="sm"
                label={t("添加到对话")}
                onClick={() => onAddToConversation(selectedText, session)}
              >
                <ArrowDownToLine size={14} />
              </IconButton>
            )}
          </div>
        )}
        <div className="terminal-actions">
          {view === "terminal" && !narrow && sessions.length > 0 && (
            <IconButton
              size="sm"
              label={t("新建终端")}
              disabled={!connected || !cwd}
              onClick={create}
            >
              <Plus size={16} />
            </IconButton>
          )}

          <IconButton
            size="sm"
            label={maximized ? t("还原终端高度") : t("最大化终端")}
            onClick={() => setMaximized((value) => !value)}
          >
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </IconButton>
          <IconButton
            size="sm"
            label={t("收起终端（进程继续运行）")}
            onClick={() => store.hide()}
          >
            <ChevronDown size={16} />
          </IconButton>
        </div>
      </div>
      {view === "tasks" && taskContent ? (
        <div className="terminal-task-content">{taskContent}</div>
      ) : (
        <>
          {notice && (
            <ErrorNotice
              className="terminal-notice"
              onDismiss={() => setNotice("")}
            >
              {notice}
            </ErrorNotice>
          )}
          {sessionWarning && (
            <p
              className="terminal-warning"
              role="status"
              title={session?.error}
            >
              {sessionWarning}
            </p>
          )}
          {pending && (
            <div className="terminal-pending-command">
              <input
                id={`terminal-command-${environmentId}`}
                aria-label={t("待填入的命令（按 Enter 才执行）")}
                title={t("待填入的命令（按 Enter 才执行）")}
                value={command}
                readOnly={!connected || narrow}
                onChange={(event) =>
                  setCommand(singleLineCommand(event.target.value))
                }
              />
              <IconButton
                size="sm"
                label={t("填入终端")}
                disabled={!writable || !surfaceReady || !command.trim()}
                onClick={() => void fillCommand()}
              >
                <ArrowDownToLine size={15} />
              </IconButton>
              <IconButton
                size="sm"
                label={t("取消")}
                onClick={() => store.consumeCommand(pending.revision)}
              >
                <X size={15} />
              </IconButton>
            </div>
          )}
          {session ? (
            <TerminalSurface
              key={session.id}
              session={session}
              store={store}
              writable={writable}
              onSelectionChange={updateSelection}
              onReadyChange={updateReadiness}
            />
          ) : (
            <div className="terminal-empty">
              <p>
                {narrow
                  ? t("手机仅支持查看输出")
                  : cwd
                    ? t("在当前项目中查看文件、分支、日志与差异。")
                    : t("选择项目后即可新建终端。")}
              </p>
              {!narrow && (
                <Button
                  size="sm"
                  disabled={!connected || !cwd}
                  onClick={create}
                >
                  <Plus size={14} />
                  {t("新建终端")}
                </Button>
              )}
            </div>
          )}
        </>
      )}
      <Modal
        open={
          !!closeTarget &&
          closeTarget.store === store &&
          closeTarget.cwd === cwd &&
          closeTarget.scope === connectionState.scope &&
          closeTarget.epoch === connectionState.epoch
        }
        onOpenChange={(open) => {
          if (!open) setCloseTarget(undefined);
        }}
        title={
          closeTarget?.kind === "record"
            ? t("移除状态未知的终端记录？")
            : closeTarget?.kind === "busy"
              ? t("关闭运行中的终端？")
              : t("关闭状态未确认的终端？")
        }
        description={
          closeTarget?.kind === "record"
            ? t(
                "无法确认原进程状态。此操作仅移除工作台记录，不会终止原进程；请在执行环境中核实。",
              )
            : closeTarget?.kind === "busy"
              ? t(
                  "该终端中仍有任务运行。关闭将终止终端，并可能中断正在运行的任务。",
                )
              : t("无法确认终端是否空闲。关闭可能中断仍在运行的任务。")
        }
        returnFocusElement={closeTarget?.trigger}
      >
        {closeTarget && (
          <p className="terminal-close-context">
            <strong>{closeTarget.name}</strong>
            <code>{closeTarget.cwd}</code>
          </p>
        )}
        <div className="terminal-close-actions">
          <Button onClick={() => setCloseTarget(undefined)}>{t("取消")}</Button>
          <Button
            variant="danger"
            disabled={closeTarget?.kind !== "record" && narrow}
            onClick={confirmClose}
          >
            {closeTarget?.kind === "record"
              ? t("仅移除记录")
              : t("关闭并终止任务")}
          </Button>
        </div>
      </Modal>
    </section>
  );
}

export default TerminalPanel;
