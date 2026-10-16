import { useEffect, useRef, useState } from "react";
import { Popover } from "radix-ui";
import {
  Bot,
  ChevronRight,
  LoaderCircle,
  CheckCircle,
  CircleAlert,
} from "lucide-react";
import type { Thread } from "../../generated/v2/Thread";
import { useRuntime } from "../../lib/runtime-context";
import { useStore } from "../../components/hooks";
import {
  directAgentTasks,
  resolveAgentStatus,
  agentStatusCounts,
  latestAgentActivity,
  type AgentTaskModel,
} from "./agent-model";
import { executionStatusLabel } from "./model";

function AgentRow({
  agent,
  thread,
  waiting,
  onSelect,
}: {
  agent: AgentTaskModel;
  thread?: Thread;
  waiting: boolean;
  onSelect: () => void;
}) {
  const status = resolveAgentStatus(agent.status, thread, waiting);
  const activity = thread
    ? latestAgentActivity(thread)
    : (agent.message ?? agent.prompt ?? "暂无活动记录");
  const name =
    thread?.agentNickname ??
    agent.nickname ??
    thread?.agentRole ??
    agent.role ??
    `子代理 ${agent.id.slice(0, 8)}`;
  return (
    <button
      type="button"
      data-slot="agent-list-item"
      data-agent-id={agent.id}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium">{name}</span>
          <span
            className={`shrink-0 text-[11px] ${waiting ? "text-accent" : "text-muted"}`}
          >
            {status === "waiting"
              ? "等待确认"
              : status === "running"
                ? "执行中"
                : status === "pendingInit"
                  ? "准备中"
                  : status === "errored"
                    ? "失败"
                    : executionStatusLabel(status)}
          </span>
        </div>
        <p
          className="mt-1 truncate text-[11px] text-muted"
          title={activity.replace(/\s+/g, " ").slice(0, 240)}
        >
          {activity}
        </p>
      </div>
      <ChevronRight size={13} className="shrink-0 text-muted" />
    </button>
  );
}

export function AgentEntry({
  thread,
  onSelect,
}: {
  thread: Thread;
  onSelect: (id: string) => void;
}) {
  const runtime = useRuntime();
  const known = useStore(runtime.sessions).threads;
  const pending = useStore(runtime.requests).pending;
  const agents = directAgentTasks(thread, known);
  const waitingIds = new Set(
    pending.flatMap((request) =>
      "threadId" in request.params ? [request.params.threadId] : [],
    ),
  );
  const counts = agentStatusCounts(agents, known, waitingIds);
  const pendingCount = counts.waiting;
  const summaryLabel = `查看子代理，共 ${agents.length} 个${counts.running ? `，${counts.running} 运行中` : ""}${counts.completed ? `，${counts.completed} 已完成` : ""}${counts.waiting ? `，${counts.waiting} 等待确认` : ""}${counts.failed ? `，${counts.failed} 失败` : ""}${counts.preparing ? `，${counts.preparing} 准备中` : ""}${counts.interrupted ? `，${counts.interrupted} 已中断` : ""}${counts.unknown ? `，${counts.unknown} 状态待确认` : ""}`;
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasPinned = useRef(false);
  const selecting = useRef(false);
  const focusWithin = (target: EventTarget | null) =>
    target instanceof Node &&
    (contentRef.current?.contains(target) ||
      triggerRef.current?.contains(target));
  const close = () => {
    wasPinned.current = pinned;
    setOpen(false);
    setPinned(false);
  };
  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const closeLater = () => {
    cancelClose();
    if (!pinned)
      closeTimer.current = setTimeout(() => {
        closeTimer.current = null;
        if (!focusWithin(document.activeElement)) close();
      }, 250);
  };
  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );
  if (!agents.length) return null;
  return (
    <div
      data-slot="composer-agents"
      className="inline-flex min-w-0 items-center"
    >
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          if (next) setOpen(true);
          else close();
        }}
      >
        <Popover.Trigger asChild>
          <button
            ref={triggerRef}
            type="button"
            data-slot="agent-entry"
            aria-label={summaryLabel}
            title={summaryLabel}
            className="flex max-[550px]:min-h-10 items-center gap-1.5 rounded px-2 py-1 text-xs text-muted hover:bg-hover hover:text-foreground"
            onMouseEnter={() => {
              cancelClose();
              setOpen(true);
            }}
            onMouseLeave={closeLater}
            onFocus={cancelClose}
            onBlur={(event) => {
              if (!focusWithin(event.relatedTarget)) closeLater();
            }}
            onClick={(event) => {
              event.preventDefault();
              cancelClose();
              const next = !pinned;
              if (next) {
                selecting.current = false;
                setPinned(true);
                setOpen(true);
              } else close();
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setPinned(true);
                setOpen(true);
                requestAnimationFrame(() =>
                  contentRef.current
                    ?.querySelector<HTMLButtonElement>("button")
                    ?.focus(),
                );
              }
            }}
          >
            <Bot size={14} />
            {counts.running > 0 && (
              <span className="hidden text-[10px] @min-[650px]:inline">
                {counts.running} 运行中
              </span>
            )}
            {counts.completed > 0 && (
              <span className="hidden text-[10px] @min-[650px]:inline">
                {counts.completed} 已完成
              </span>
            )}
            {counts.preparing > 0 && (
              <span className="hidden text-[10px] @min-[650px]:inline">
                {counts.preparing} 准备中
              </span>
            )}
            {counts.failed > 0 && (
              <span className="hidden text-[10px] text-danger @min-[650px]:inline">
                {counts.failed} 失败
              </span>
            )}
            {counts.interrupted > 0 && (
              <span className="hidden text-[10px] @min-[650px]:inline">
                {counts.interrupted} 已中断
              </span>
            )}
            {counts.unknown > 0 && (
              <span className="hidden text-[10px] @min-[650px]:inline">
                {counts.unknown} 状态待确认
              </span>
            )}
            <span
              className="flex items-center gap-1 text-[10px] @min-[650px]:hidden"
              aria-hidden="true"
            >
              {counts.running > 0 && (
                <>
                  <LoaderCircle size={10} />
                  <span>{counts.running}</span>
                </>
              )}
              {counts.completed > 0 && (
                <>
                  <CheckCircle size={10} />
                  <span>{counts.completed}</span>
                </>
              )}
              {(counts.failed > 0 ||
                counts.unknown > 0 ||
                counts.interrupted > 0) && (
                <>
                  <CircleAlert
                    size={10}
                    className={counts.failed ? "text-danger" : ""}
                  />
                  <span>
                    {counts.failed + counts.unknown + counts.interrupted}
                  </span>
                </>
              )}
            </span>
            {pendingCount > 0 && (
              <span className="text-[10px] text-accent">
                {pendingCount} 待处理
              </span>
            )}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            ref={contentRef}
            data-slot="agent-list"
            side="top"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className="z-50 w-80 max-w-[calc(100vw-24px)] rounded-lg border border-border bg-elevated p-1 text-foreground shadow-xl"
            onMouseEnter={cancelClose}
            onMouseLeave={closeLater}
            onFocusCapture={cancelClose}
            onBlurCapture={(event) => {
              if (!focusWithin(event.relatedTarget)) closeLater();
            }}
            onOpenAutoFocus={(event) => {
              if (!pinned) event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              if (!wasPinned.current || selecting.current)
                event.preventDefault();
              wasPinned.current = false;
              selecting.current = false;
            }}
            onKeyDown={(event) => {
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
                return;
              const rows = Array.from(
                contentRef.current?.querySelectorAll<HTMLButtonElement>(
                  "button[data-agent-id]",
                ) ?? [],
              );
              if (!rows.length) return;
              event.preventDefault();
              const index = rows.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? rows.length - 1
                    : event.key === "ArrowDown"
                      ? (index + 1) % rows.length
                      : (index - 1 + rows.length) % rows.length;
              rows[next].focus();
            }}
          >
            <p className="px-3 py-2 text-[11px] text-muted">
              子代理 · {agents.length}
              {pendingCount ? ` · ${pendingCount} 待处理` : ""}
            </p>
            <div className="max-h-72 overflow-y-auto">
              {agents.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  thread={known[agent.id]}
                  waiting={waitingIds.has(agent.id)}
                  onSelect={() => {
                    cancelClose();
                    selecting.current = true;
                    close();
                    onSelect(agent.id);
                  }}
                />
              ))}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
