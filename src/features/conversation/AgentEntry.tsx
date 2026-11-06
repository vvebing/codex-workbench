import { useTranslation } from "react-i18next";
import { t } from "../../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { Bot, ChevronRight } from "lucide-react";
import type { Thread } from "../../generated/v2/Thread";
import { useRuntime } from "../../lib/runtime-context";
import { useStore } from "../../components/hooks";
import { ScrollArea } from "../../components/ui";
import {
  directAgentTasks,
  resolveAgentStatus,
  agentStatusCounts,
  groupAgentTasks,
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
  useTranslation();
  const status = resolveAgentStatus(agent.status, thread, waiting);
  const activity = thread
    ? latestAgentActivity(thread)
    : (agent.message ?? agent.prompt ?? t("暂无活动记录"));
  const name =
    thread?.agentNickname ??
    agent.nickname ??
    thread?.agentRole ??
    agent.role ??
    t("子代理 {{value0}}", { value0: agent.id.slice(0, 8) });
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
            className={`shrink-0 text-meta ${waiting ? "text-accent" : "text-muted"}`}
          >
            {status === "waiting"
              ? t("等待确认")
              : status === "running"
                ? t("执行中")
                : status === "pendingInit"
                  ? t("准备中")
                  : status === "errored"
                    ? t("失败")
                    : executionStatusLabel(status)}
          </span>
        </div>
        <p
          className="mt-1 truncate text-meta text-muted"
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
  useTranslation();
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
  const grouped = groupAgentTasks(agents, known, waitingIds);
  const groupLabels = {
    waiting: t("待处理"),
    running: t("运行中"),
    preparing: t("准备中"),
    failed: t("失败"),
    interrupted: t("已中断"),
    completed: t("已完成"),
    unknown: t("状态待确认"),
  };
  const groups = (Object.keys(grouped) as (keyof typeof grouped)[])
    .filter((key) => grouped[key].length > 0)
    .map((key) => ({ key, label: groupLabels[key], agents: grouped[key] }));
  const summaryLabel = t(
    "查看子代理，共 {{value0}} 个{{value1}}{{value2}}{{value3}}{{value4}}{{value5}}{{value6}}{{value7}}",
    {
      value0: agents.length,
      value1: counts.running
        ? t("，{{value0}} 运行中", { value0: counts.running })
        : "",
      value2: counts.completed
        ? t("，{{value0}} 已完成", { value0: counts.completed })
        : "",
      value3: counts.waiting
        ? t("，{{value0}} 等待确认", { value0: counts.waiting })
        : "",
      value4: counts.failed
        ? t("，{{value0}} 失败", { value0: counts.failed })
        : "",
      value5: counts.preparing
        ? t("，{{value0}} 准备中", { value0: counts.preparing })
        : "",
      value6: counts.interrupted
        ? t("，{{value0}} 已中断", { value0: counts.interrupted })
        : "",
      value7: counts.unknown
        ? t("，{{value0}} 状态待确认", { value0: counts.unknown })
        : "",
    },
  );
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
      className="inline-flex min-w-0 max-w-full items-center"
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
            className="flex max-w-full flex-wrap max-[550px]:min-h-10 items-center gap-x-2 gap-y-1 rounded px-2 py-1 text-xs text-muted hover:bg-hover hover:text-foreground"
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
            {groups.map((group) => (
              <span
                key={group.key}
                data-agent-status={group.key}
                className={`inline-flex items-center gap-1 whitespace-nowrap text-fine ${group.key === "failed" ? "text-danger" : group.key === "waiting" ? "text-accent" : "text-muted"}`}
              >
                <span className="tabular-nums">{group.agents.length}</span>{" "}
                <span>{group.label}</span>
              </span>
            ))}
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
            className="z-50 w-80 max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-border bg-elevated text-foreground shadow-xl"
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
            <p className="px-4 pt-3 pb-2 text-meta text-muted">
              {t("子代理 ·")}
              {agents.length}
              {pendingCount
                ? t(" · {{value0}} 待处理", { value0: pendingCount })
                : ""}
            </p>
            <ScrollArea
              className="max-h-72"
              viewportProps={{ className: "pl-1 pr-3 pb-1" }}
            >
              {groups.map((group) => (
                <section
                  key={group.key}
                  data-slot="agent-status-group"
                  data-agent-status={group.key}
                  aria-label={group.label}
                  className="py-1 [&+section]:mt-2 [&+section]:border-t [&+section]:border-border [&+section]:pt-3"
                >
                  <h3
                    className={`flex items-center justify-between px-3 pb-1 text-meta font-medium ${group.key === "failed" ? "text-danger" : group.key === "waiting" ? "text-accent" : "text-muted"}`}
                  >
                    {group.label}
                    <span className="tabular-nums">{group.agents.length}</span>
                  </h3>
                  {group.agents.map((agent) => (
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
                </section>
              ))}
            </ScrollArea>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
