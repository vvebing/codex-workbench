import { useTranslation } from "react-i18next";
import { t } from "../../lib/i18n";
import { ErrorNotice, IconButton, ScrollArea } from "../../components/ui";
import { useEffect, useRef, useState } from "react";
import { X, RefreshCw, ChevronLeft } from "lucide-react";
import { useRuntime } from "../../lib/runtime-context";
import { useStore } from "../../components/hooks";
import { useAgentObservation } from "./use-agent-observation";
import { directAgentTasks } from "./agent-model";
import { executionStatusLabel } from "./model";
import { ApprovalQueue } from "../approvals/ApprovalQueue";
import { Timeline } from "./Timeline";

export function AgentDrawer({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  useTranslation();
  const [path, setPath] = useState([{ id, label: id.slice(0, 8) }]);
  const selected = path.at(-1)!;
  const state = useAgentObservation(selected.id);
  const thread = state.thread;
  const runtime = useRuntime();
  const known = useStore(runtime.sessions).threads;
  const pending = useStore(runtime.requests).pending;
  const waitingItems = pending.flatMap((request) =>
    "threadId" in request.params &&
    request.params.threadId === selected.id &&
    "itemId" in request.params
      ? [String(request.params.itemId)]
      : [],
  );
  const children = thread ? directAgentTasks(thread, known) : [];
  const inspect = (childId: string) => {
    const existing = path.findIndex((entry) => entry.id === childId);
    if (existing >= 0) {
      setPath(path.slice(0, existing + 1));
      return;
    }
    const child = children.find((entry) => entry.id === childId);
    setPath([
      ...path,
      {
        id: childId,
        label: child?.nickname ?? child?.prompt ?? childId.slice(0, 8),
      },
    ]);
  };
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, [id]);
  return (
    <aside
      data-slot="agent-drawer"
      aria-label={t("子代理 · {{value0}}", {
        value0: thread?.agentNickname ?? selected.label,
      })}
      className="flex h-full min-h-0 flex-col bg-background"
    >
      <header className="flex min-h-[57px] shrink-0 items-center gap-2 border-b border-border px-4">
        {path.length > 1 && (
          <IconButton
            label={t("返回上级代理")}
            onClick={() => setPath(path.slice(0, -1))}
          >
            <ChevronLeft size={16} />
          </IconButton>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">
            {t("子代理 ·")}
            {thread?.agentNickname ?? selected.label}
          </h2>
          <p className="text-fine text-muted">
            {thread?.agentRole ?? t("只读会话")} ·{" "}
            {state.lastEventAt ? t("已接收实时更新") : t("只读同步")}
          </p>
        </div>
        <IconButton
          label={t("刷新子代理详情")}
          disabled={state.loading}
          onClick={() => {
            void state.refresh();
          }}
          className="disabled:opacity-40"
        >
          <RefreshCw size={15} />
        </IconButton>
        <button
          ref={closeRef}
          type="button"
          aria-label={t("关闭子代理详情")}
          onClick={onClose}
          className="rounded p-1.5 text-muted hover:bg-hover"
        >
          <X size={17} />
        </button>
      </header>
      {path.length > 1 && (
        <nav
          aria-label={t("子代理层级")}
          className="flex shrink-0 flex-wrap gap-2 border-b border-border px-4 py-2 text-xs"
        >
          {path.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              aria-current={index === path.length - 1 ? "page" : undefined}
              className="max-w-40 truncate text-muted hover:text-foreground"
              onClick={() => setPath(path.slice(0, index + 1))}
            >
              {index === 0 ? t("直接子代理") : entry.label}
            </button>
          ))}
        </nav>
      )}
      {state.historyUnavailable && (
        <p role="status" className="shrink-0 px-4 py-2 text-meta text-muted">
          {t("临时子会话没有持久化历史，仅显示当前连接已接收的活动。")}
        </p>
      )}
      {state.error && (
        <ErrorNotice className="mx-4 my-2 shrink-0">
          {t("详情暂不可用：")}
          {state.connected ? state.error : t(state.error)}
        </ErrorNotice>
      )}
      {children.length > 0 && (
        <details className="shrink-0 border-b border-border px-4 py-2 text-xs">
          <summary className="cursor-pointer text-muted">
            {t("下级代理 ·")}
            {children.length}
          </summary>
          <ScrollArea aria-label={t("下级代理")} className="max-h-40">
            <div className="py-2">
              {children.map((child) => (
                <button
                  type="button"
                  key={child.id}
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-hover"
                  onClick={() => inspect(child.id)}
                >
                  <span className="truncate">
                    {t("查看下级代理：")}
                    {child.nickname ?? child.prompt ?? child.id.slice(0, 8)}
                  </span>
                  <span className="shrink-0 text-muted">
                    {executionStatusLabel(child.status)}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </details>
      )}
      <div
        data-slot="agent-detail-content"
        className="flex min-h-0 flex-1 flex-col"
      >
        <Timeline
          thread={thread}
          turnDiffs={state.conversation.diffs[selected.id]}
          loading={state.loading && !thread}
          completedItems={state.conversation.completedItems}
          startedItems={state.conversation.startedItems}
          toolProgress={state.conversation.toolProgress}
          fileOutputs={state.conversation.fileOutputs[selected.id]}
          finishedTurns={state.conversation.finishedTurns[selected.id]}
          waitingItems={waitingItems}
          onInspectAgent={inspect}
        />
      </div>
      <ScrollArea className="max-h-[30vh] shrink-0">
        <ApprovalQueue threadId={selected.id} />
      </ScrollArea>
    </aside>
  );
}
