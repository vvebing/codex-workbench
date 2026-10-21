import type { LocalMessage } from "../composer/local-messages";
import { useRuntime } from "../../lib/runtime-context";
import { conversationReadingCache } from "./reading-state";
import { PromptDirectory } from "./PromptDirectory";
import { AsyncQuestionPanel } from "./AsyncQuestions";
import { LocalMessageImage } from "./MessageImage";
import { ConversationImage } from "../../components/ImagePreview";
import { FileLinkProvider } from "../files/FileLinkContext";
import { useAutoCollapseProcess } from "../settings/conversation-preferences";
import { Button, ErrorNotice, Modal, ScrollArea } from "../../components/ui";
import {
  Fragment,
  useSyncExternalStore,
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  memo,
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
  cacheScope?: string;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  thread?: Thread;
  loading?: boolean;
  turnDiffs?: Record<string, string>;
  fileOutputs?: Record<string, string>;
  finishedTurns?: Record<string, true>;
  completedItems?: Record<string, boolean>;
  startedItems?: Record<string, boolean>;
  onInspectAgent?: (id: string) => void;
  toolProgress?: Record<string, string[]>;
  waitingItems?: string[];
  onRollback?: (turnId: string, messageId?: string) => Promise<unknown>;
}
const ReadingChoices = createContext<Map<string, unknown> | undefined>(
  undefined,
);
function useReadingChoice<T>(key: string, initial: T) {
  const cache = useContext(ReadingChoices);
  const [value, setValue] = useState<T>(() =>
    cache?.has(key) ? (cache.get(key) as T) : initial,
  );
  const update = useCallback(
    (next: T | ((old: T) => T)) => {
      setValue((old) => {
        const value =
          typeof next === "function" ? (next as (old: T) => T)(old) : next;
        cache?.set(key, value);
        if (cache && cache.size > 2000)
          cache.delete(cache.keys().next().value!);
        return value;
      });
    },
    [cache, key],
  );
  return [value, update] as const;
}
const ToolItem = memo(function ToolItem({
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
        data-reading-id={item.id}
        data-status={status}
        data-item-type={item.type}
        data-expandable="false"
        title={
          active ? "摘要到达后可展开查看" : "该操作记录没有可展示的思考摘要"
        }
        className={`my-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-caption ${active ? "text-muted" : "text-subtle"}`}
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
        className="flex cursor-pointer list-none items-center gap-2 py-1.5 max-[550px]:min-h-10 text-caption text-muted [&::-webkit-details-marker]:hidden"
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
          <small className="shrink-0 whitespace-nowrap text-meta text-muted">
            {(item.durationMs / 1000).toFixed(1)} 秒
          </small>
        )}
        {status && !["completed", "inProgress", "failed"].includes(status) && (
          <small className="shrink-0 whitespace-nowrap text-meta">
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
});
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
  const choiceKey = `operations:${context.turnId}:${items[0]?.id}`;
  const [showEarlier, setShowEarlier] = useReadingChoice(
    `${choiceKey}:earlier`,
    false,
  );
  const [manualItems, setManualItems] = useReadingChoice<
    Record<string, boolean>
  >(`${choiceKey}:items`, {});
  const [summaryChoices, setSummaryChoices] = useReadingChoice<
    Record<string, OperationExpansion>
  >(`${choiceKey}:summaries`, {});
  const lastStatus = useRef(context.turnStatus);
  useEffect(() => {
    if (lastStatus.current === context.turnStatus) return;
    lastStatus.current = context.turnStatus;
    setShowEarlier(false);
    setManualItems({});
    setSummaryChoices({});
  }, [context.turnStatus, setShowEarlier, setManualItems, setSummaryChoices]);
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
  }, [items, resolve, setManualItems]);
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
  const changeManualItem = useCallback(
    (id: string, open: boolean) => {
      setManualItems((old) => ({ ...old, [id]: open }));
    },
    [setManualItems],
  );
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
      onManualChange={changeManualItem}
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
  const [collapsed, setCollapsed] = useReadingChoice(
    `process:${items[0]?.id}`,
    autoCollapse && finished,
  );
  const wasFinished = useRef(finished);
  useEffect(() => {
    if (autoCollapse && finished && !wasFinished.current) setCollapsed(true);
    wasFinished.current = finished;
  }, [autoCollapse, finished, setCollapsed]);
  const id = useId();
  const groups = useMemo(() => groupTimelineItems(items), [items]);
  const progress = useMemo(
    () => groups.map((group) => isTimelineProgress(group[0], items)),
    [groups, items],
  );
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
            {!(collapsed && progress[index]) &&
              children(group, hasProgress && index === summaryIndex)}
          </div>
        </Fragment>
      ))}
      {summaryIndex < 0 && divider}
    </>
  );
}
export const Item = memo(function Item({
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
      <article data-reading-id={item.id} className="mb-6">
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
        data-prompt-id={item.id}
        data-reading-id={item.id}
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
              className="text-control text-muted [overflow-wrap:anywhere]"
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
});
export function Timeline(props: TimelineProps) {
  return (
    <FileLinkProvider cwd={props.thread?.cwd} threadId={props.thread?.id}>
      <ReadingChoices.Provider
        value={
          props.cacheScope && props.thread
            ? conversationReadingCache.entry(props.cacheScope, props.thread.id)
                .choices
            : undefined
        }
      >
        <TimelineContent {...props} />
      </ReadingChoices.Provider>
    </FileLinkProvider>
  );
}

function TimelineContent({
  cacheScope,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  thread,
  loading = false,
  turnDiffs,
  fileOutputs,
  finishedTurns,
  completedItems,
  startedItems,
  onInspectAgent,
  toolProgress,
  waitingItems,
  onRollback,
}: TimelineProps) {
  const { submissions } = useRuntime();
  useSyncExternalStore(
    submissions.messages.subscribe,
    submissions.messages.getSnapshot,
  );
  const localMessages = thread ? submissions.messages.forThread(thread.id) : [];
  const viewport = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const lastScrollTop = useRef(0);
  const synchronizedScroll = useRef<number | null>(null);
  const synchronizedHeight = useRef(0);
  const readingIntentUntil = useRef(0);
  const anchor = useRef<{ element: Element; offset: number }[]>([]);
  const [away, setAway] = useState(false);
  const rollbackLock = useRef(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  useEffect(() => {
    setRollbackError(null);
  }, [thread?.id]);
  const running = conversationExecuting(thread);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [copying, setCopying] = useState(false);
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
  useLayoutEffect(() => {
    const el = viewport.current;
    const entry =
      cacheScope && thread?.id
        ? conversationReadingCache.entry(cacheScope, thread.id)
        : undefined;
    const saved = entry?.reading;
    following.current = saved?.following ?? true;
    anchor.current = [];
    setAway(!following.current);
    if (el) {
      if (following.current) el.scrollTop = el.scrollHeight;
      else {
        const turn = Array.from(
          el.querySelectorAll<HTMLElement>("[data-turn-id]"),
        ).find((node) => node.dataset.turnId === saved?.turnId);
        el.scrollTop = saved?.scrollTop ?? 0;
        const target =
          saved?.anchorId && turn
            ? (Array.from(
                turn.querySelectorAll<HTMLElement>("[data-reading-id]"),
              ).find((node) => node.dataset.readingId === saved.anchorId) ??
              turn)
            : turn;
        if (target)
          el.scrollTop +=
            target.getBoundingClientRect().top -
            el.getBoundingClientRect().top -
            (saved?.offset ?? 0);
        captureAnchor(el);
      }
      lastScrollTop.current = el.scrollTop;
    }
    return () => {
      if (!el || !entry) return;
      const savedAnchor = anchor.current.find(
        ({ element }) => element.isConnected,
      );
      entry.reading = {
        following: following.current,
        turnId: (
          savedAnchor?.element.closest("[data-turn-id]") as
            HTMLElement | undefined
        )?.dataset.turnId,
        anchorId: (savedAnchor?.element as HTMLElement | undefined)?.dataset
          .readingId,
        offset: savedAnchor?.element.hasAttribute("data-reading-id")
          ? savedAnchor.offset
          : (savedAnchor?.element
              .closest("[data-turn-id]")
              ?.getBoundingClientRect().top ?? el.getBoundingClientRect().top) -
            el.getBoundingClientRect().top,
        scrollTop: el.scrollTop,
      };
    };
  }, [cacheScope, thread?.id]);
  function captureAnchor(el: HTMLDivElement) {
    const turns = el.querySelectorAll<HTMLElement>("[data-turn-id]");
    const top = el.getBoundingClientRect().top;
    let low = 0,
      high = turns.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (turns[mid].getBoundingClientRect().bottom <= top) low = mid + 1;
      else high = mid;
    }
    const nearby = Array.from(
      { length: Math.min(2, turns.length - low) },
      (_, index) => turns[low + index],
    );
    const candidates = nearby.flatMap((turn) =>
      Array.from(
        turn.querySelectorAll<HTMLElement>(
          "article, [data-slot=conversation-tool], [data-slot=turn-process-divider]",
        ),
      ),
    );
    low = 0;
    high = candidates.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (candidates[mid].getBoundingClientRect().bottom <= top) low = mid + 1;
      else high = mid;
    }
    anchor.current = candidates.slice(low, low + 3).map((element) => ({
      element,
      offset: element.getBoundingClientRect().top - top,
    }));
  }
  const scrollFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const synchronize = () => {
      if (!el.getClientRects().length || !el.clientWidth || !el.clientHeight)
        return;
      synchronizedHeight.current = el.scrollHeight;
      if (scrollFrame.current) {
        cancelAnimationFrame(scrollFrame.current);
        scrollFrame.current = 0;
        if (!following.current) captureAnchor(el);
      }
      if (following.current) {
        el.scrollTop = el.scrollHeight;
        synchronizedScroll.current = el.scrollTop;
        lastScrollTop.current = el.scrollTop;
      } else {
        // A folded task may disappear; fall back to the next surviving content.
        const saved = anchor.current.find(
          ({ element }) =>
            element.isConnected && element.getClientRects().length > 0,
        );
        if (saved) {
          const offset =
            saved.element.getBoundingClientRect().top -
            el.getBoundingClientRect().top;
          el.scrollTop += offset - saved.offset;
          synchronizedScroll.current = el.scrollTop;
          lastScrollTop.current = el.scrollTop;
        }
      }
    };
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(synchronize);
    };
    const observer = new ResizeObserver(schedule);
    const mutations = new MutationObserver(schedule);
    const body = el.firstElementChild;
    if (body) {
      observer.observe(body);
      mutations.observe(body, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
    observer.observe(el);
    if (following.current) {
      el.scrollTop = el.scrollHeight;
      lastScrollTop.current = el.scrollTop;
    }
    schedule();
    return () => {
      observer.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [thread?.id]);
  return (
    <div
      data-slot="conversation-timeline-shell"
      className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col text-foreground"
    >
      {thread && !loading && (
        <PromptDirectory
          key={thread.id}
          turns={thread.turns}
          viewport={viewport}
          onNavigate={() => {
            following.current = false;
            anchor.current = [];
            setAway(true);
          }}
        />
      )}
      {rollbackError && (
        <ErrorNotice className="mx-5 mt-2">{rollbackError}</ErrorNotice>
      )}
      <ScrollArea
        className="min-h-0 flex-1"
        viewportRef={viewport}
        onPointerDownCapture={(event) => {
          if ((event.target as Element).closest("[data-orientation=vertical]"))
            readingIntentUntil.current = Date.now() + 2000;
        }}
        viewportProps={{
          // Reading anchors and bottom following are managed here. Native
          // anchoring can otherwise turn a content collapse into an upward
          // scroll that is mistaken for navigation away from the bottom.
          style: { overflowAnchor: "none" },
          onWheelCapture: () => {
            readingIntentUntil.current = Date.now() + 1500;
          },
          onTouchMove: () => {
            readingIntentUntil.current = Date.now() + 1500;
          },
          onKeyDown: (event) => {
            if (
              [
                "ArrowUp",
                "ArrowDown",
                "PageUp",
                "PageDown",
                "Home",
                "End",
                " ",
              ].includes(event.key) &&
              !(event.target as Element).closest(
                "input, textarea, [contenteditable=true]",
              )
            )
              readingIntentUntil.current = Date.now() + 1500;
          },
          onScroll: (event) => {
            const el = event.currentTarget;
            const atBottom =
              el.scrollHeight - el.scrollTop - el.clientHeight < 5;
            const movedUp = el.scrollTop < lastScrollTop.current - 1;
            // Content growth alone keeps following. External upward scrolling,
            // including programmatic reading navigation, pauses it.
            if (atBottom) following.current = true;
            else if (
              movedUp &&
              (Date.now() < readingIntentUntil.current ||
                el.scrollHeight === synchronizedHeight.current) &&
              (synchronizedScroll.current === null ||
                Math.abs(el.scrollTop - synchronizedScroll.current) > 1)
            )
              following.current = false;
            synchronizedScroll.current = null;
            lastScrollTop.current = el.scrollTop;
            if (!following.current) {
              if (!scrollFrame.current)
                scrollFrame.current = requestAnimationFrame(() => {
                  scrollFrame.current = 0;
                  captureAnchor(el);
                });
            } else anchor.current = [];
            setAway(!following.current);
          },
        }}
        data-slot="conversation-timeline"
      >
        <div className="overscroll-contain">
          <div
            data-slot="conversation-content"
            className="conversation-content pt-4 pb-12"
          >
            {hasOlder && (
              <div className="mb-4 flex justify-center">
                <Button disabled={loadingOlder} onClick={onLoadOlder}>
                  {loadingOlder ? "正在加载更早对话…" : "加载更早对话"}
                </Button>
              </div>
            )}
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
                className="py-3 text-control leading-copy text-muted"
              >
                选择一个会话，或开始新的对话。
              </div>
            ) : !thread.turns.length && !localMessages.length ? (
              <div
                data-slot="conversation-empty"
                className="py-3 text-control leading-copy text-muted"
              >
                写下你的任务，开始这个会话。
              </div>
            ) : (
              thread.turns.map((turn, index) => (
                <section
                  data-slot="conversation-turn"
                  data-turn-id={turn.id}
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
                  />
                  <TurnFooter
                    thread={thread}
                    turn={turn}
                    confirmed={finishedTurns?.[turn.id]}
                  />
                </section>
              ))
            )}
            {localMessages.map((message) => (
              <LocalDeliveryMessage
                key={message.id}
                message={message}
                onRestore={() => submissions.restoreMessage(message.id)}
                onDismiss={() => submissions.messages.remove(message.id)}
              />
            ))}
          </div>
        </div>
      </ScrollArea>
      {!loading && thread && <AsyncQuestionPanel thread={thread} />}
      {away && (
        <Button
          className="absolute bottom-4 left-1/2 -translate-x-1/2 shadow-md"
          onClick={() => {
            following.current = true;
            anchor.current = [];
            setAway(false);
            const el = viewport.current;
            if (el) {
              el.scrollTop = el.scrollHeight;
              lastScrollTop.current = el.scrollTop;
            }
          }}
        >
          <ArrowDown size={14} />
          回到底部
        </Button>
      )}
    </div>
  );
}

export function LocalDeliveryMessage({
  message,
  onDismiss,
  onRestore,
}: {
  message: LocalMessage;
  onRestore?: () => void;
  onDismiss: () => void;
}) {
  const [discarding, setDiscarding] = useState(false);
  const needsReview =
    message.status === "failed" || message.status === "uncertain";
  return (
    <section
      data-slot="local-message"
      data-delivery-status={message.status}
      className="py-3"
    >
      <Item
        item={{
          type: "userMessage",
          id: message.id,
          clientId: message.id,
          content: message.input,
        }}
      />
      <p role="status" className="text-xs text-muted">
        {message.status === "creating"
          ? "正在创建会话…"
          : message.status === "sending"
            ? "正在发送…"
            : message.status === "accepted"
              ? "服务器已接收，等待消息记录同步…"
              : message.status === "failed"
                ? `发送失败：${message.error ?? "服务器拒绝了此消息"}`
                : `发送结果待核实：${message.error ?? "连接中断"}`}
      </p>
      {needsReview && (
        <div className="mt-2 text-xs text-muted">
          <p>
            {message.status === "uncertain"
              ? "不会自动重发。请先核实会话记录，确认未送达后再恢复编辑并手动发送。"
              : "消息内容已保留，可恢复到输入框修改后发送。"}
          </p>
          {onRestore && (
            <Button
              variant="quiet"
              size="sm"
              className="mt-1 mr-2"
              onClick={onRestore}
            >
              恢复到输入框
            </Button>
          )}
          <Button
            variant="quiet"
            size="sm"
            className="mt-1"
            onClick={() => setDiscarding(true)}
          >
            丢弃消息
          </Button>
          <Modal
            open={discarding}
            onOpenChange={setDiscarding}
            title="丢弃消息？"
          >
            <p className="text-sm text-muted">
              将删除此消息在当前页面保留的内容，无法恢复。此操作不会撤回服务器可能已接收的消息。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="quiet" onClick={() => setDiscarding(false)}>
                取消
              </Button>
              <Button variant="danger" onClick={onDismiss}>
                确认丢弃
              </Button>
            </div>
          </Modal>
        </div>
      )}
    </section>
  );
}

function TurnFooter({
  thread,
  turn,
  confirmed,
}: {
  thread: Thread;
  turn: Turn;
  confirmed?: boolean;
}) {
  const status = turnStatusLabel(thread, turn, confirmed);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = setInterval(refresh, status === "正在执行…" ? 1000 : 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [status]);
  const timing = turnTiming(turn, status === "正在执行…", now);
  const completed =
    turn.completedAt == null ? null : new Date(turn.completedAt * 1000);
  return (
    <footer
      data-slot="conversation-turn-footer"
      className="mt-4 flex items-center justify-between text-meta text-muted"
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
