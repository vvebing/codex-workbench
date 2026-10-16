import { LocalMessageImage } from "./MessageImage";
import { ConversationImage } from "../../components/ImagePreview";
import { FileLinkProvider } from "../files/FileLinkContext";
import { useAutoCollapseProcess } from "../settings/conversation-preferences";
import { Button, ErrorNotice, ScrollArea } from "../../components/ui";
import {
  Fragment,
  useCallback,
  useId,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  Terminal,
  FileDiff,
  Search,
  ListChecks,
  Bot,
  Brain,
  Wrench,
  Undo2,
  LoaderCircle,
  CircleAlert,
  ChevronRight,
  Copy,
  Check,
} from "lucide-react";
import type { Thread } from "../../generated/v2/Thread";
import type { Turn } from "../../generated/v2/Turn";
import type { ThreadItem } from "../../generated/v2/ThreadItem";
import { TurnResults } from "./TurnResults";
import type { TurnPlanStep } from "../../generated/v2/TurnPlanStep";
import { Markdown } from "./Markdown";
import {
  executionSegments,
  type ExecutionSegment,
} from "./execution-presentation";
import { OperationDetails } from "./OperationDetails";
import {
  operationStatus,
  commandTitle,
  partitionOperationGroup,
  operationSummaryExpansion,
  type OperationGroupContext,
  type OperationExpansion,
} from "./operation";
import { operationKey } from "../../lib/state";
import {
  executionStatusLabel,
  groupTimelineItems,
  isTimelineProgress,
} from "./model";
import { copyFinalSummary, finalSummary } from "./export";
import {
  conversationExecuting,
  turnStatusLabel,
  turnTiming,
  formatCompletionTime,
} from "./activity";
export interface TimelineProps {
  thread?: Thread;
  loading?: boolean;
  turnDiffs?: Record<string, string>;
  turnPlans?: Record<string, TurnPlanStep[]>;
  fileOutputs?: Record<string, string>;
  finishedTurns?: Record<string, true>;
  completedItems?: Record<string, boolean>;
  startedItems?: Record<string, boolean>;
  onInspectAgent?: (id: string) => void;
  toolProgress?: Record<string, string[]>;
  waitingItems?: string[];
  onRollback?: (turnId: string, messageId?: string) => Promise<unknown>;
}
function ToolItem({
  item,
  output,
  lifecycle,
  progress,
  manualOpen,
  finished = false,
  onInspectAgent,
  onManualChange,
}: {
  item: ThreadItem;
  output?: string;
  lifecycle?: string;
  progress?: string[];
  manualOpen?: boolean;
  finished?: boolean;
  onInspectAgent?: (id: string) => void;
  onManualChange?: (id: string, open: boolean) => void;
}) {
  const [manual, setManual] = useState<boolean | null>(null);
  const [automatic, setAutomatic] = useState(false);
  const previous = useRef<string | undefined>(undefined);
  const active = lifecycle === "inProgress" || lifecycle === "waiting";
  useEffect(() => {
    const wasActive =
      previous.current === "inProgress" || previous.current === "waiting";
    previous.current = lifecycle;
    if (lifecycle === "waiting") {
      setAutomatic(true);
      return;
    }
    if (active) {
      const timer = setTimeout(() => setAutomatic(true), 200);
      return () => clearTimeout(timer);
    }
    if (wasActive) {
      setManual(null);
    }
    setAutomatic(false);
  }, [lifecycle, active]);
  useEffect(() => {
    if (finished) {
      setManual(null);
      setAutomatic(false);
    }
  }, [finished]);
  const open = manualOpen ?? manual ?? automatic;
  let title: string;
  let content = "";
  let status = lifecycle ?? ("status" in item ? String(item.status) : "");
  switch (item.type) {
    case "commandExecution":
      title = commandTitle(item);
      content = `${item.cwd}\n$ ${item.command}\n\n${item.aggregatedOutput ?? "等待命令输出"}${item.exitCode !== null ? `\n退出码：${item.exitCode}` : ""}`;
      break;
    case "fileChange":
      title = `修改 ${item.changes.length} 个文件 · ${item.changes
        .slice(0, 2)
        .map((change) => change.path.split("/").at(-1))
        .join("、")}`;
      content = item.changes
        .map((change) => `${change.path}\n${change.diff}`)
        .join("\n\n");
      break;
    case "reasoning":
      title = "思考摘要";
      content = [...item.summary, ...item.content].join("\n\n");
      break;
    case "plan":
      title = "执行计划";
      content = item.text;
      break;
    case "mcpToolCall":
      title = `${item.server} · ${item.tool}`;
      content =
        `参数\n${JSON.stringify(item.arguments, null, 2)}\n\n` +
        (item.error?.message ??
          item.result?.content
            .map((value) =>
              typeof value === "object" && value && "text" in value
                ? String(value.text)
                : JSON.stringify(value, null, 2),
            )
            .filter(Boolean)
            .join("\n") ??
          (progress?.length ? progress.join("\n") : "等待工具返回结果"));
      break;
    case "dynamicToolCall":
      title = item.tool;
      content =
        `参数\n${JSON.stringify(item.arguments, null, 2)}\n\n` +
        (item.contentItems
          ?.map((value) =>
            value.type === "inputText" ? value.text : "媒体输出",
          )
          .join("\n") ?? "等待工具返回结果");
      if (item.success === false) status = "failed";
      break;
    case "collabAgentToolCall":
      title = `协作 · ${item.tool}`;
      content = [
        item.prompt,
        ...Object.entries(item.agentsStates).map(
          ([id, state]) =>
            `${id} · ${executionStatusLabel(state?.status ?? "unknown")}\n${state?.message ?? ""}`,
        ),
      ]
        .filter(Boolean)
        .join("\n\n");
      break;
    case "enteredReviewMode":
    case "exitedReviewMode":
      title = "代码审查";
      content = item.review;
      break;
    case "imageView":
      title = "查看图片";
      content = item.path;
      break;
    case "functionCallOutput":
      title = item.name;
      content =
        typeof item.output === "string"
          ? item.output
          : item.output
              .map((part) =>
                part.type === "input_text" ? part.text : "媒体输出",
              )
              .join("\n");
      break;
    case "hookPrompt":
      title = "工作流提示";
      content = item.fragments.map((fragment) => fragment.text).join("\n");
      break;
    case "webSearch":
      title = "网页搜索";
      content = item.query;
      break;
    case "sleep":
      title = "等待";
      content = `${(item.durationMs / 1000).toFixed(1)} 秒`;
      break;
    case "imageGeneration":
      title = "生成图片";
      content = item.revisedPrompt ?? item.savedPath ?? item.status;
      break;
    case "contextCompaction":
      title = "上下文已整理";
      break;
    case "subAgentActivity":
      title = `子代理 · ${item.kind}`;
      content = item.agentPath;
      break;
    default:
      title = item.type;
      content = "此事件已记录。";
  }
  if (item.type === "fileChange" && output)
    content += `\n\n执行输出\n${output}`;
  const Icon =
    item.type === "fileChange"
      ? FileDiff
      : item.type === "reasoning"
        ? Brain
        : item.type === "plan"
          ? ListChecks
          : item.type === "webSearch"
            ? Search
            : item.type === "collabAgentToolCall" ||
                item.type === "subAgentActivity"
              ? Bot
              : item.type === "mcpToolCall" || item.type === "dynamicToolCall"
                ? Wrench
                : Terminal;
  if (item.type === "reasoning" && !content.trim()) {
    return (
      <div
        data-slot="conversation-tool"
        data-status={status}
        data-item-type={item.type}
        data-expandable="false"
        title={
          active ? "摘要到达后可展开查看" : "该操作记录没有可展示的思考摘要"
        }
        className={`my-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] ${active ? "text-muted" : "text-subtle"}`}
      >
        {active ? (
          <LoaderCircle
            size={14}
            className="shrink-0 animate-spin"
            aria-label="执行中"
          />
        ) : (
          <Brain size={14} className="shrink-0" />
        )}
        <span>正在思考</span>
      </div>
    );
  }
  return (
    <details
      open={open}
      data-slot="conversation-tool"
      data-status={status}
      data-item-type={item.type}
      className={`group/tool my-1 rounded-md px-2 ${active || status === "failed" ? "border border-border bg-surface/30" : "border border-transparent"} ${status === "failed" ? "text-danger" : ""}`}
    >
      <summary
        onClick={(event) => {
          event.preventDefault();
          setManual(!open);
          onManualChange?.(item.id, !open);
        }}
        className="flex cursor-pointer list-none items-center gap-2 py-1.5 max-[550px]:min-h-10 text-[12px] text-muted [&::-webkit-details-marker]:hidden"
      >
        {active ? (
          <LoaderCircle
            size={14}
            className="shrink-0 animate-spin"
            aria-label="执行中"
          />
        ) : status === "failed" ? (
          <CircleAlert
            size={14}
            className="shrink-0 text-danger"
            aria-label="失败"
          />
        ) : (
          <Icon size={14} className="shrink-0" />
        )}
        <span className="min-w-0 flex-initial truncate" title={title}>
          {title}
        </span>
        {item.type === "commandExecution" &&
          item.exitCode !== null &&
          item.exitCode !== 0 && (
            <small className="shrink-0 whitespace-nowrap">
              退出码 {item.exitCode}
            </small>
          )}
        {"durationMs" in item && item.durationMs !== null && (
          <small className="shrink-0 whitespace-nowrap text-[11px] text-muted">
            {(item.durationMs / 1000).toFixed(1)} 秒
          </small>
        )}
        {status && !["completed", "inProgress", "failed"].includes(status) && (
          <small className="shrink-0 whitespace-nowrap text-[11px]">
            {status === "waiting" ? "等待确认" : executionStatusLabel(status)}
          </small>
        )}
        <ChevronRight
          size={14}
          aria-hidden="true"
          className="shrink-0 transition-transform group-open/tool:rotate-90"
        />
      </summary>
      {open && (
        <div
          onPointerDownCapture={() => {
            setManual(true);
            onManualChange?.(item.id, true);
          }}
          onFocusCapture={() => {
            setManual(true);
            onManualChange?.(item.id, true);
          }}
        >
          {item.type === "reasoning" || item.type === "plan" ? (
            <div className="pt-2 pb-4">
              <Markdown text={content || "暂无内容"} />
            </div>
          ) : (
            <OperationDetails
              item={item}
              content={content}
              progress={progress}
              output={output}
            />
          )}
          <div className="flex flex-wrap gap-2 pb-2 text-xs">
            {onInspectAgent &&
              (item.type === "collabAgentToolCall"
                ? item.receiverThreadIds
                : item.type === "subAgentActivity"
                  ? [item.agentThreadId]
                  : []
              ).map((id) => (
                <button
                  type="button"
                  key={id}
                  className="underline text-accent"
                  onClick={() => onInspectAgent(id)}
                >
                  查看子代理 {id.slice(0, 8)}
                </button>
              ))}
          </div>
        </div>
      )}
    </details>
  );
}
function ExecutionSummary({
  segment,
  render,
  open,
  onOpenChange,
}: {
  segment: Extract<ExecutionSegment, { kind: "summary" }>;
  render: (item: ThreadItem) => ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <details
      data-slot="execution-summary"
      open={open}
      className="my-1 text-muted"
    >
      <summary
        className="flex cursor-pointer list-none items-center gap-2 rounded px-2 py-1.5 max-[550px]:min-h-10 text-xs hover:bg-hover [&::-webkit-details-marker]:hidden"
        onClick={(event) => {
          event.preventDefault();
          onOpenChange(!open);
        }}
      >
        <Check size={13} className="shrink-0" />
        <span className="min-w-0 flex-initial truncate" title={segment.label}>
          {segment.label}
        </span>
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </summary>
      {open && (
        <div className="ml-3 border-l border-border pl-2">
          {segment.items.map(render)}
        </div>
      )}
    </details>
  );
}
export function OperationGroup({
  items,
  context,
  toolProgress,
  fileOutputs,
  onInspectAgent,
}: {
  items: ThreadItem[];
  context: OperationGroupContext;
  toolProgress?: Record<string, string[]>;
  fileOutputs?: Record<string, string>;
  onInspectAgent?: (id: string) => void;
}) {
  const [showEarlier, setShowEarlier] = useState(false);
  const [manualItems, setManualItems] = useState<Record<string, boolean>>({});
  const [summaryChoices, setSummaryChoices] = useState<
    Record<string, OperationExpansion>
  >({});
  useEffect(() => {
    setShowEarlier(false);
    setManualItems({});
    setSummaryChoices({});
  }, [context.turnStatus]);
  const resolve = useCallback(
    (item: ThreadItem) =>
      operationStatus(
        item,
        context.turnStatus,
        !!context.completedItems?.[
          operationKey(context.threadId, context.turnId, item.id)
        ],
        !!context.waitingItems?.includes(item.id),
        !!context.startedItems?.[
          operationKey(context.threadId, context.turnId, item.id)
        ],
      ),
    [context],
  );
  const previousStatuses = useRef<Record<string, string>>({});
  useEffect(() => {
    const statuses = Object.fromEntries(
      items.map((item) => [item.id, resolve(item)]),
    );
    const ended = items.filter(
      (item) =>
        ["inProgress", "waiting"].includes(previousStatuses.current[item.id]) &&
        !["inProgress", "waiting"].includes(statuses[item.id]),
    );
    previousStatuses.current = statuses;
    if (ended.length)
      setManualItems((old) => {
        const next = { ...old };
        for (const item of ended) delete next[item.id];
        return next;
      });
  }, [items, resolve]);
  const signature = items
    .map((item) => `${item.id}:${resolve(item)}`)
    .join("|");
  const [compactReady, setCompactReady] = useState(
    context.historical || context.turnStatus !== "inProgress",
  );
  useEffect(() => {
    if (context.historical || context.turnStatus !== "inProgress") {
      setCompactReady(true);
      return;
    }
    setCompactReady(false);
    const timer = setTimeout(() => setCompactReady(true), 1000);
    return () => clearTimeout(timer);
  }, [signature, context.historical, context.turnStatus]);
  const expandedItems = [
    ...Object.keys(manualItems).filter((id) => manualItems[id]),
    ...executionSegments(items, resolve).flatMap((segment) =>
      segment.kind === "summary" &&
      operationSummaryExpansion(segment.items, summaryChoices)?.open
        ? segment.items.map((item) => item.id)
        : [],
    ),
  ];
  const { visible, hidden } = partitionOperationGroup(items, {
    ...context,
    expandedItems,
  });
  const displayed = showEarlier ? items : visible;
  const render = (item: ThreadItem) => (
    <ToolItem
      key={operationKey(context.threadId, context.turnId, item.id)}
      item={item}
      lifecycle={resolve(item)}
      progress={
        toolProgress?.[operationKey(context.threadId, context.turnId, item.id)]
      }
      output={fileOutputs?.[item.id]}
      manualOpen={manualItems[item.id]}
      finished={context.turnStatus !== "inProgress"}
      onInspectAgent={onInspectAgent}
      onManualChange={(id, open) =>
        setManualItems((old) => ({ ...old, [id]: open }))
      }
    />
  );
  const segments = executionSegments(displayed, resolve).flatMap(
    (segment): ExecutionSegment[] => {
      if (segment.kind === "item") return [segment];
      const choice = operationSummaryExpansion(segment.items, summaryChoices);
      if (
        !showEarlier &&
        (compactReady || choice) &&
        (choice || !segment.items.some((item) => manualItems[item.id]))
      )
        return [segment];
      return segment.items.map((item) => ({ kind: "item", item }));
    },
  );
  return (
    <div data-slot="conversation-execution" className="my-2">
      {hidden.length > 0 && (
        <button
          type="button"
          data-slot="earlier-operations"
          aria-expanded={showEarlier}
          className="mb-2 px-2 text-xs text-muted underline"
          onClick={() => setShowEarlier((value) => !value)}
        >
          {showEarlier
            ? "收起较早操作"
            : `查看此前 ${hidden.length} 项已完成操作`}
        </button>
      )}
      {segments.map((segment) => {
        if (segment.kind === "item") return render(segment.item);
        const choice = operationSummaryExpansion(segment.items, summaryChoices);
        const summaryId =
          choice?.summaryId &&
          segment.items.some((item) => item.id === choice.summaryId)
            ? choice.summaryId
            : segment.id;
        return (
          <ExecutionSummary
            key={summaryId}
            segment={segment}
            render={render}
            open={choice?.open ?? false}
            onOpenChange={(open) => {
              setSummaryChoices((old) => {
                const version =
                  Object.values(old).reduce(
                    (latest, entry) => Math.max(latest, entry.version),
                    0,
                  ) + 1;
                const next = { ...old };
                for (const item of segment.items)
                  next[item.id] = { open, version, summaryId };
                return next;
              });
            }}
          />
        );
      })}
    </div>
  );
}
function TurnContent({
  items,
  status,
  children,
}: {
  items: ThreadItem[];
  status: Turn["status"];
  children: (group: ThreadItem[], hideDivider: boolean) => ReactNode;
}) {
  const autoCollapse = useAutoCollapseProcess();
  const finished = status !== "inProgress";
  const [collapsed, setCollapsed] = useState(autoCollapse && finished);
  useEffect(() => {
    if (autoCollapse && finished) setCollapsed(true);
  }, [autoCollapse, finished]);
  const id = useId();
  const groups = groupTimelineItems(items);
  const progress = groups.map((group) => isTimelineProgress(group[0], items));
  const hasProgress = progress.some(Boolean);
  const summaryIndex = groups.findIndex(
    (group, index) => group[0].type === "agentMessage" && !progress[index],
  );
  const divider = hasProgress && (
    <div
      data-slot="turn-process-divider"
      className="mb-5 flex items-center gap-3"
    >
      <Button
        variant="quiet"
        size="sm"
        aria-expanded={!collapsed}
        aria-controls={progress
          .flatMap((value, position) => (value ? [`${id}-${position}`] : []))
          .join(" ")}
        onClick={() => setCollapsed((value) => !value)}
      >
        <ChevronRight size={14} className={collapsed ? "" : "rotate-90"} />
        {collapsed ? "展开执行过程" : "收起执行过程"}
      </Button>
      <hr className="min-w-0 flex-1 border-0 border-t border-border" />
    </div>
  );
  return (
    <>
      {groups.map((group, index) => (
        <Fragment key={group[0].id}>
          {index === summaryIndex && divider}
          <div
            id={progress[index] ? `${id}-${index}` : undefined}
            hidden={collapsed && progress[index]}
          >
            {children(group, hasProgress && index === summaryIndex)}
          </div>
        </Fragment>
      ))}
      {summaryIndex < 0 && divider}
    </>
  );
}
export function Item({
  item,
  action,
  streaming = false,
  hideDivider = false,
}: {
  item: ThreadItem;
  action?: ReactNode;
  streaming?: boolean;
  hideDivider?: boolean;
}) {
  if (item.type === "agentMessage")
    return (
      <article className="mb-6">
        {!hideDivider && (item.phase === "final_answer" || action) && (
          <hr className="mb-5 border-0 border-t border-border" />
        )}
        <Markdown text={item.text} streaming={streaming} />
        {action}
      </article>
    );
  if (item.type === "userMessage")
    return (
      <article
        className={`relative mb-6 ml-auto w-fit min-w-0 max-w-full rounded-xl border border-border bg-surface p-3 sm:px-5 sm:py-4 ${action ? "pr-12 sm:pr-12" : ""}`}
      >
        {action}
        {item.content.map((part, index) =>
          part.type === "text" ? (
            <Markdown key={index} text={part.text} preserveLineBreaks />
          ) : part.type === "image" && "url" in part ? (
            <ConversationImage
              key={index}
              src={part.url}
              name={`对话附件 ${item.content.slice(0, index + 1).filter((input) => input.type === "image" || input.type === "localImage").length}`}
            />
          ) : part.type === "localImage" ? (
            <LocalMessageImage
              key={index}
              path={part.path}
              name={part.path.split(/[\\/]/).at(-1) || "对话附件"}
            />
          ) : (
            <div
              className="text-[13px] text-muted [overflow-wrap:anywhere]"
              key={index}
            >
              {part.type === "skill" || part.type === "mention"
                ? part.name
                : "path" in part
                  ? part.path
                  : "音频或图片附件"}
            </div>
          ),
        )}
      </article>
    );
  return <ToolItem item={item} />;
}
export function Timeline(props: TimelineProps) {
  return (
    <FileLinkProvider cwd={props.thread?.cwd} threadId={props.thread?.id}>
      <TimelineContent {...props} />
    </FileLinkProvider>
  );
}

function TimelineContent({
  thread,
  loading = false,
  turnDiffs,
  turnPlans,
  fileOutputs,
  finishedTurns,
  completedItems,
  startedItems,
  onInspectAgent,
  toolProgress,
  waitingItems,
  onRollback,
}: TimelineProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const anchor = useRef<{ element: Element; offset: number } | null>(null);
  const [away, setAway] = useState(false);
  const rollbackLock = useRef(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  useEffect(() => {
    setRollbackError(null);
  }, [thread?.id]);
  const running = conversationExecuting(thread);
  const [now, setNow] = useState(Date.now);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [copying, setCopying] = useState(false);
  useEffect(() => {
    if (!thread?.id) return;
    const refresh = () => setNow(Date.now());
    refresh();
    const timer = setInterval(refresh, running ? 1000 : 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [running, thread?.id]);
  useEffect(() => {
    setCopied(false);
    setCopyError("");
  }, [thread?.id]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 4000);
    return () => clearTimeout(timer);
  }, [copied]);
  const summary = thread ? finalSummary(thread) : null;
  const summaryTurn = thread?.turns.findLast(
    (turn) =>
      turn.status === "completed" &&
      turn.items.some(
        (item) =>
          item.type === "agentMessage" &&
          item.text === summary &&
          item.phase !== "commentary",
      ),
  );
  const summaryItem = summaryTurn?.items.findLast(
    (item) =>
      item.type === "agentMessage" &&
      item.text === summary &&
      item.phase !== "commentary",
  );
  async function copySummary() {
    if (!thread || copying) return;
    setCopying(true);
    setCopyError("");
    try {
      await copyFinalSummary(thread);
      setCopied(true);
    } catch (error) {
      setCopyError(
        error instanceof Error ? error.message : "复制失败，请重试。",
      );
    } finally {
      setCopying(false);
    }
  }
  const rollback = async (turnId: string, messageId: string) => {
    if (!onRollback || rollbackLock.current || running) return;
    rollbackLock.current = true;
    setRollingBack(turnId);
    setRollbackError(null);
    try {
      await onRollback(turnId, messageId);
    } catch (error) {
      setRollbackError(
        error instanceof Error ? error.message : "回滚失败，请重试。",
      );
    } finally {
      rollbackLock.current = false;
      setRollingBack(null);
    }
  };
  useEffect(() => {
    following.current = true;
    setAway(false);
    const el = viewport.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.id]);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (!el.getClientRects().length || !el.clientWidth || !el.clientHeight)
        return;
      if (following.current) el.scrollTop = el.scrollHeight;
      else if (anchor.current?.element.isConnected) {
        const offset =
          anchor.current.element.getBoundingClientRect().top -
          el.getBoundingClientRect().top;
        el.scrollTop += offset - anchor.current.offset;
      }
    });
    const body = el.firstElementChild;
    if (body) observer.observe(body);
    if (following.current) el.scrollTop = el.scrollHeight;
    return () => observer.disconnect();
  }, [thread?.turns]);
  return (
    <div
      data-slot="conversation-timeline-shell"
      className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col text-foreground"
    >
      {rollbackError && (
        <ErrorNotice className="mx-5 mt-2">{rollbackError}</ErrorNotice>
      )}
      <ScrollArea
        className="min-h-0 flex-1"
        viewportRef={viewport}
        viewportProps={{
          onScroll: (event) => {
            const el = event.currentTarget;
            following.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 90;
            if (!following.current) {
              const top = el.getBoundingClientRect().top;
              const element = Array.from(
                el.querySelectorAll("article, [data-slot=conversation-tool]"),
              ).find((node) => node.getBoundingClientRect().bottom > top);
              anchor.current = element
                ? { element, offset: element.getBoundingClientRect().top - top }
                : null;
            } else anchor.current = null;
            setAway(!following.current);
          },
        }}
        data-slot="conversation-timeline"
      >
        <div className="overscroll-contain">
          <div className="mx-auto max-w-[840px] px-4 pt-4 pb-12 sm:px-7">
            {loading ? (
              <div
                data-slot="conversation-loading"
                role="status"
                className="flex items-center justify-center gap-2 py-16 text-sm text-muted"
              >
                <LoaderCircle size={18} className="animate-spin" />
                正在加载会话…
              </div>
            ) : !thread ? (
              <div
                data-slot="conversation-empty"
                className="py-3 text-[13px] leading-[1.7] text-muted"
              >
                选择一个会话，或开始新的对话。
              </div>
            ) : !thread.turns.length ? (
              <div
                data-slot="conversation-empty"
                className="py-3 text-[13px] leading-[1.7] text-muted"
              >
                写下你的任务，开始这个会话。
              </div>
            ) : (
              thread.turns.map((turn, index) => (
                <section
                  data-slot="conversation-turn"
                  className={`pt-3 pb-6 ${index > 0 ? "border-t border-border" : ""}`}
                  key={JSON.stringify([thread.id, turn.id])}
                  aria-label={`第 ${index + 1} 轮对话`}
                >
                  <TurnContent items={turn.items} status={turn.status}>
                    {(group, hideDivider) =>
                      group[0].type === "userMessage" ||
                      group[0].type === "agentMessage" ? (
                        <Item
                          hideDivider={hideDivider}
                          item={group[0]}
                          streaming={turn.status === "inProgress"}
                          action={
                            group[0].type === "userMessage" && onRollback ? (
                              <button
                                type="button"
                                data-rollback
                                className="absolute top-[15px] right-2.5 inline-flex size-7 items-center justify-center rounded-md border-0 bg-transparent text-muted hover:enabled:bg-selected hover:enabled:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                                disabled={
                                  Boolean(running) || rollingBack !== null
                                }
                                title={
                                  running
                                    ? "请等待当前会话执行结束后再回滚"
                                    : "撤销这条消息所在轮及后续对话，在当前会话继续；文件修改不会撤销"
                                }
                                aria-label={`回滚到第 ${index + 1} 轮之前`}
                                aria-busy={rollingBack === turn.id}
                                onClick={() =>
                                  void rollback(turn.id, group[0].id)
                                }
                              >
                                {rollingBack === turn.id ? (
                                  <LoaderCircle size={15} />
                                ) : (
                                  <Undo2 size={15} />
                                )}
                              </button>
                            ) : group[0].id === summaryItem?.id &&
                              turn.id === summaryTurn?.id ? (
                              <div className="mt-3 flex items-center gap-2">
                                <button
                                  type="button"
                                  aria-label="复制最终总结"
                                  disabled={copying}
                                  onClick={() => void copySummary()}
                                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted hover:bg-hover disabled:opacity-50"
                                >
                                  {copied ? (
                                    <Check size={14} />
                                  ) : (
                                    <Copy size={14} />
                                  )}
                                  {copied
                                    ? "已复制最终总结"
                                    : copying
                                      ? "正在复制…"
                                      : "复制总结"}
                                </button>
                                <span
                                  role={copyError ? "alert" : "status"}
                                  className="text-xs text-danger"
                                >
                                  {copyError}
                                </span>
                              </div>
                            ) : undefined
                          }
                        />
                      ) : (
                        <OperationGroup
                          key={operationKey(thread.id, turn.id, group[0].id)}
                          items={group}
                          context={{
                            historical: index < thread.turns.length - 1,
                            threadId: thread.id,
                            turnId: turn.id,
                            turnStatus: turn.status,
                            completedItems,
                            startedItems,
                            waitingItems,
                          }}
                          toolProgress={toolProgress}
                          fileOutputs={fileOutputs}
                          onInspectAgent={onInspectAgent}
                        />
                      )
                    }
                  </TurnContent>
                  {turn.error && (
                    <ErrorNotice>{turn.error.message}</ErrorNotice>
                  )}
                  <TurnResults
                    turn={turn}
                    cwd={thread.cwd}
                    diff={turnDiffs?.[turn.id]}
                    plan={turnPlans?.[turn.id]}
                  />
                  <TurnFooter
                    thread={thread}
                    turn={turn}
                    confirmed={finishedTurns?.[turn.id]}
                    now={now}
                  />
                </section>
              ))
            )}
          </div>
        </div>
      </ScrollArea>
      {away && (
        <button
          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border bg-elevated px-[13px] py-2 text-[13px] font-medium hover:bg-hover absolute bottom-4 left-1/2 -translate-x-1/2 shadow-md"
          onClick={() => {
            following.current = true;
            setAway(false);
            const el = viewport.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          }}
        >
          <ArrowDown size={14} />
          回到底部
        </button>
      )}
    </div>
  );
}

function TurnFooter({
  thread,
  turn,
  confirmed,
  now,
}: {
  thread: Thread;
  turn: Turn;
  confirmed?: boolean;
  now: number;
}) {
  const status = turnStatusLabel(thread, turn, confirmed);
  const timing = turnTiming(turn, status === "正在执行…", now);
  const completed =
    turn.completedAt == null ? null : new Date(turn.completedAt * 1000);
  return (
    <footer
      data-slot="conversation-turn-footer"
      className="mt-4 flex items-center justify-between text-[11px] text-muted"
    >
      <span>
        {status.replace("…", "")}
        {timing && ` · ${timing}`}
        {completed && (
          <>
            {" "}
            ·{" "}
            <time
              dateTime={completed.toISOString()}
              title={completed.toLocaleString()}
            >
              {formatCompletionTime(completed, now)}
            </time>
          </>
        )}
      </span>
    </footer>
  );
}
