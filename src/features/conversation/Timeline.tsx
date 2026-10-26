import { asyncAnswerItemId } from "./async-questions";
import {
  ToolAnswerRecord,
  QuestionAnswerDelivery,
  withToolAnswers,
  toolAnswerId,
} from "./AnswerRecords";
import { CollapsiblePrompt } from "./CollapsiblePrompt";
import { LocalDeliveryStatus } from "./LocalDeliveryStatus";
import { AnimatedDisclosure } from "./AnimatedDisclosure";
import {
  AnimatedExecution,
  BEFORE_EXECUTION_LAYOUT,
} from "./AnimatedExecution";
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
  Check,
} from "lucide-react";
import type { Thread } from "../../generated/v2/Thread";
import type { Turn } from "../../generated/v2/Turn";
import type { ThreadItem } from "../../generated/v2/ThreadItem";
import { TurnResults } from "./TurnResults";
import { Markdown } from "./Markdown";
import {
  automaticallyExpandOperation,
  executionSegments,
  type ExecutionSegment,
} from "./execution-presentation";
import { OperationDetails } from "./OperationDetails";
import {
  operationStatus,
  hasOperationContent,
  commandTitle,
  isInstantOperation,
  type OperationGroupContext,
} from "./operation";
import { operationKey } from "../../lib/state";
import {
  executionStatusLabel,
  groupTimelineItems,
  isTimelineProgress,
} from "./model";
import { CopyAnswer } from "./CopyAnswer";
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
const PinProcess = createContext<(() => void) | undefined>(undefined);
function useOperationStatus(context: OperationGroupContext) {
  return useCallback(
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
  keepOpenUntilPhaseEnds = false,
  onInspectAgent,
  onManualChange,
}: {
  item: ThreadItem;
  output?: string;
  lifecycle?: string;
  progress?: string[];
  manualOpen?: boolean;
  keepOpenUntilPhaseEnds?: boolean;
  onInspectAgent?: (id: string) => void;
  onManualChange?: (id: string, open: boolean) => void;
}) {
  const [manual, setManual] = useState<boolean | null>(null);
  const pinProcess = useContext(PinProcess);
  const active = lifecycle === "inProgress" || lifecycle === "waiting";
  const automatic = automaticallyExpandOperation(item, lifecycle ?? "recorded");
  const [wasAutomaticallyOpen, setWasAutomaticallyOpen] = useState(automatic);
  useLayoutEffect(() => {
    if (automatic) setWasAutomaticallyOpen(true);
  }, [automatic]);
  const open =
    manualOpen ??
    manual ??
    (automatic ||
      (keepOpenUntilPhaseEnds &&
        wasAutomaticallyOpen &&
        !isInstantOperation(item)));
  const instant = isInstantOperation(item);
  const animate = manualOpen !== undefined || manual !== null || !instant;
  let title: string;
  let content = "";
  let status = lifecycle ?? ("status" in item ? String(item.status) : "");
  switch (item.type) {
    case "commandExecution":
      title = commandTitle(item);
      content = `${item.cwd}\n$ ${item.command}\n\n${item.aggregatedOutput ?? (active ? "等待命令输出" : "命令未产生输出")}${item.exitCode !== null ? `\n退出码：${item.exitCode}` : ""}`;
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
      break;
    case "dynamicToolCall":
      title = item.tool;
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
      content = typeof item.output === "string" ? item.output : "";
      break;
    case "hookPrompt":
      title = "工作流提示";
      content = item.fragments.map((fragment) => fragment.text).join("\n");
      break;
    case "webSearch":
      title = "网页搜索";
      content = [
        item.query,
        item.action?.type === "search"
          ? [item.action.query, ...(item.action.queries ?? [])]
              .filter((query) => query && query !== item.query)
              .join("\n")
          : item.action?.type === "openPage"
            ? item.action.url
            : item.action?.type === "findInPage"
              ? [item.action.url, item.action.pattern]
                  .filter(Boolean)
                  .join("\n")
              : null,
      ]
        .filter(Boolean)
        .join("\n");
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
  if (item.type === "reasoning" && !content.trim() && !active) return null;
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
        className={`my-1 flex w-fit min-w-0 max-w-full items-center gap-2 rounded-md px-2 py-1.5 text-caption ${active ? "text-muted" : "text-subtle"}`}
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
  const hasAgentLinks =
    !!onInspectAgent &&
    ((item.type === "collabAgentToolCall" &&
      item.receiverThreadIds.length > 0) ||
      item.type === "subAgentActivity");
  if (!hasOperationContent(item, content, progress, output) && !hasAgentLinks) {
    return (
      <div
        data-slot="conversation-tool"
        data-reading-id={item.id}
        data-status={status}
        data-item-type={item.type}
        data-expandable="false"
        className={`my-1 flex w-fit min-w-0 max-w-full items-center gap-2 rounded-md px-2 py-1.5 text-caption ${status === "failed" ? "text-danger" : "text-muted"}`}
      >
        {active ? (
          <LoaderCircle
            size={14}
            className="shrink-0 animate-spin"
            aria-label="执行中"
          />
        ) : status === "failed" ? (
          <CircleAlert size={14} className="shrink-0" aria-label="失败" />
        ) : (
          <Icon size={14} className="shrink-0" />
        )}
        <span className="min-w-0 truncate" title={title}>
          {title}
        </span>
      </div>
    );
  }
  return (
    <AnimatedDisclosure
      open={open}
      animate={animate}
      data-slot="conversation-tool"
      data-reading-id={item.id}
      data-status={status}
      data-item-type={item.type}
      className={`group/tool my-1 w-full min-w-0 max-w-full rounded-md px-2 ${active || status === "failed" ? "border border-border bg-surface/30" : "border border-transparent"} ${status === "failed" ? "text-danger" : ""}`}
      summary={
        <summary
          aria-expanded={open}
          onClick={(event) => {
            event.preventDefault();
            setManual(!open);
            if (!open) pinProcess?.();
            onManualChange?.(item.id, !open);
          }}
          className={`flex ${active || status === "failed" || item.type === "webSearch" ? "w-full" : "w-fit"} max-w-full cursor-pointer list-none items-center gap-2 py-1.5 max-[550px]:min-h-10 text-caption text-muted [&::-webkit-details-marker]:hidden`}
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
          {status &&
            !["completed", "inProgress", "failed"].includes(status) && (
              <small className="shrink-0 whitespace-nowrap text-meta">
                {status === "waiting"
                  ? "等待确认"
                  : executionStatusLabel(status)}
              </small>
            )}
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={`shrink-0 motion-reduce:transition-none ${animate ? "transition-transform duration-200" : ""} ${open ? "rotate-90" : ""}`}
          />
        </summary>
      }
    >
      <div
        className="w-full min-w-0 max-w-full"
        onPointerDownCapture={() => {
          setManual(true);
          pinProcess?.();
          onManualChange?.(item.id, true);
        }}
        onFocusCapture={() => {
          setManual(true);
          pinProcess?.();
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
            status={status}
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
    </AnimatedDisclosure>
  );
});
function ExecutionSummary({
  segment,
  render,
  manualOpen,
  running,
  current,
  initiallyPresent,
  onOpenChange,
}: {
  segment: Extract<ExecutionSegment, { kind: "summary" }>;
  render: (item: ThreadItem, keepOpenUntilPhaseEnds: boolean) => ReactNode;
  manualOpen?: boolean;
  running: boolean;
  current: boolean;
  initiallyPresent: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const instant = segment.items.every(isInstantOperation);
  const animate = manualOpen !== undefined || !instant;
  const membership = JSON.stringify(segment.items.map((item) => item.id));
  const [initialMembership] = useState<string | null>(() =>
    initiallyPresent && !segment.running ? membership : null,
  );
  const phaseActive =
    running &&
    (segment.category === "run" || segment.category === "tool") &&
    (segment.running || (current && initialMembership !== membership));
  const [wasAutomaticallyOpen, setWasAutomaticallyOpen] = useState(false);
  const automatic =
    (segment.waiting && segment.category !== "file") ||
    (phaseActive && (!instant || wasAutomaticallyOpen));
  useLayoutEffect(() => {
    if (automatic) setWasAutomaticallyOpen(true);
  }, [automatic]);
  // Keep the same wrapper and item nodes when a second activity joins. A single
  // visible item has its own disclosure, so the batch adds no extra control.
  const single = segment.items.length === 1;
  const open = single || (manualOpen ?? automatic);
  return (
    <AnimatedDisclosure
      data-slot="execution-summary"
      data-batch-id={segment.id}
      data-batch-size={segment.items.length}
      data-category={segment.category}
      data-status={
        segment.attention
          ? "attention"
          : segment.running
            ? "inProgress"
            : "completed"
      }
      open={open}
      animate={!single && animate}
      className={
        single ? "min-w-0" : "my-1 w-full min-w-0 max-w-full text-muted"
      }
      summary={
        <summary
          data-reading-id={`batch:${segment.id}`}
          hidden={single}
          aria-expanded={open}
          className={
            single
              ? "hidden"
              : "flex w-full max-w-full cursor-pointer list-none items-center gap-2 rounded px-2 py-1.5 max-[550px]:min-h-10 text-xs hover:bg-hover [&::-webkit-details-marker]:hidden"
          }
          onClick={(event) => {
            event.preventDefault();
            onOpenChange(!open);
          }}
        >
          {segment.attention ? (
            <CircleAlert size={13} className="shrink-0 text-danger" />
          ) : segment.running ? (
            <LoaderCircle
              size={13}
              className="shrink-0 animate-spin"
              aria-label="执行中"
            />
          ) : (
            <Check size={13} className="shrink-0" />
          )}
          <span className="min-w-0 flex-initial truncate" title={segment.label}>
            {segment.label}
          </span>
          {segment.attention > 0 && (
            <span className="shrink-0 text-danger">
              {segment.attention} 项需关注
            </span>
          )}
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={`shrink-0 motion-reduce:transition-none ${animate ? "transition-transform duration-200" : ""} ${open ? "rotate-90" : ""}`}
          />
        </summary>
      }
    >
      <div className="min-w-0">
        {segment.items.map((item) => render(item, phaseActive))}
      </div>
    </AnimatedDisclosure>
  );
}
export function OperationGroup({
  items,
  context,
  attentionOnly = false,
  manualFiltering = false,
  enter = false,
  initiallyPresent = false,
  hasFollowingContent = false,
  toolProgress,
  fileOutputs,
  onInspectAgent,
}: {
  items: ThreadItem[];
  context: OperationGroupContext;
  attentionOnly?: boolean;
  manualFiltering?: boolean;
  enter?: boolean;
  initiallyPresent?: boolean;
  hasFollowingContent?: boolean;
  toolProgress?: Record<string, string[]>;
  fileOutputs?: Record<string, string>;
  onInspectAgent?: (id: string) => void;
}) {
  const choiceKey = `operations:${context.turnId}:${items[0]?.id}`;
  const pinProcess = useContext(PinProcess);
  const [manualItems, setManualItems] = useReadingChoice<
    Record<string, boolean>
  >(`${choiceKey}:items`, {});
  const [summaryChoices, setSummaryChoices] = useReadingChoice<
    Record<string, boolean>
  >(`${choiceKey}:batches`, {});
  const resolve = useOperationStatus(context);
  const segments = executionSegments(items, resolve, attentionOnly);
  useEffect(() => {
    const reveal = (event: Event) => {
      const itemId = (event as CustomEvent<{ itemId: string }>).detail?.itemId;
      if (!items.some((item) => item.id === itemId)) return;
      setManualItems((old) => ({ ...old, [itemId]: true }));
      const batch = executionSegments(items, resolve).find(
        (segment) =>
          segment.kind === "summary" &&
          segment.items.some((item) => item.id === itemId),
      );
      if (batch?.kind === "summary")
        setSummaryChoices((old) => ({ ...old, [batch.id]: true }));
    };
    window.addEventListener("conversation-reveal-item", reveal);
    return () => window.removeEventListener("conversation-reveal-item", reveal);
  }, [items, resolve, setManualItems, setSummaryChoices]);
  const render = (
    item: ThreadItem,
    batchId?: string,
    keepOpenUntilPhaseEnds = false,
  ) => (
    <ToolItem
      key={operationKey(context.threadId, context.turnId, item.id)}
      item={item}
      lifecycle={resolve(item)}
      progress={
        toolProgress?.[operationKey(context.threadId, context.turnId, item.id)]
      }
      output={fileOutputs?.[item.id]}
      manualOpen={manualItems[item.id]}
      keepOpenUntilPhaseEnds={keepOpenUntilPhaseEnds}
      onInspectAgent={onInspectAgent}
      onManualChange={(id, open) => {
        setManualItems((old) => ({ ...old, [id]: open }));
        if (open && batchId)
          setSummaryChoices((old) => ({ ...old, [batchId]: true }));
      }}
    />
  );
  return (
    <AnimatedExecution
      data-slot="conversation-execution"
      className="min-w-0"
      contentClassName={segments.length ? undefined : "flow-root min-w-0"}
      running={context.turnStatus === "inProgress"}
      transitionKey={manualFiltering ? attentionOnly : undefined}
      enter={enter}
      motionItems={segments.flatMap((segment) => {
        const members =
          segment.kind === "item" ? [segment.item] : segment.items;
        return members.map((item) => ({
          id: item.id,
          instant: isInstantOperation(item),
          state: [
            item,
            resolve(item),
            context.turnStatus,
            hasFollowingContent,
            attentionOnly,
            toolProgress?.[
              operationKey(context.threadId, context.turnId, item.id)
            ],
            fileOutputs?.[item.id],
            manualItems[item.id],
            segment.kind === "summary" ? summaryChoices[segment.id] : null,
          ],
        }));
      })}
    >
      {segments.map((segment) =>
        segment.kind === "item" ? (
          render(segment.item)
        ) : (
          <ExecutionSummary
            key={segment.id}
            segment={segment}
            render={(item, keepOpen) => render(item, segment.id, keepOpen)}
            manualOpen={summaryChoices[segment.id]}
            running={context.turnStatus === "inProgress" && !attentionOnly}
            current={!hasFollowingContent && !segment.hasFollowingItem}
            initiallyPresent={initiallyPresent || context.historical}
            onOpenChange={(open) => {
              setSummaryChoices((old) => ({ ...old, [segment.id]: open }));
              if (open) pinProcess?.();
            }}
          />
        ),
      )}
    </AnimatedExecution>
  );
}

function TurnContent({
  items,
  context,
  initiallyPresent,
  children,
}: {
  items: ThreadItem[];
  context: OperationGroupContext;
  initiallyPresent: boolean;
  children: (
    group: ThreadItem[],
    hideDivider: boolean,
    attentionOnly: boolean,
    enter: boolean,
    manualFiltering: boolean,
  ) => ReactNode;
}) {
  const status = context.turnStatus;
  const resolve = useOperationStatus(context);
  const [previousStatus, setPreviousStatus] = useState(status);
  const liveMotion = status === "inProgress" || previousStatus === "inProgress";
  useLayoutEffect(() => {
    // The completion update can finish live content motion. Disclosure
    // interactions are independent of this execution lifecycle.
    setPreviousStatus(status);
  }, [status]);
  const autoCollapse = useAutoCollapseProcess();
  const [manualCollapsed, setCollapsed] = useReadingChoice<boolean | null>(
    `process:${items[0]?.type === "userMessage" ? (items[0].clientId ?? items[0].id) : items[0]?.id}`,
    null,
  );
  const collapsed = manualCollapsed ?? (autoCollapse && status === "completed");
  const id = useId();
  const groups = useMemo(() => groupTimelineItems(items), [items]);
  const [seenGroups, setSeenGroups] = useState(
    () => new Set(initiallyPresent ? groups.map((group) => group[0].id) : []),
  );
  useLayoutEffect(() => {
    if (groups.some((group) => !seenGroups.has(group[0].id)))
      setSeenGroups(
        new Set([...seenGroups, ...groups.map((group) => group[0].id)]),
      );
  }, [groups, seenGroups]);
  const progress = useMemo(
    () =>
      groups.map((group) =>
        group.some((item) => {
          if (!isTimelineProgress(item, items)) return false;
          if (item.type === "reasoning")
            return [...item.summary, ...item.content].some((text) =>
              text.trim(),
            );
          if (item.type === "agentMessage") return !!item.text.trim();
          return true;
        }),
      ),
    [groups, items],
  );
  const hasProgress = progress.some(Boolean);
  const [seenProgress, setSeenProgress] = useState(
    initiallyPresent && hasProgress,
  );
  useLayoutEffect(() => {
    if (hasProgress) setSeenProgress(true);
  }, [hasProgress]);
  const animatedProgress = groups.some(
    (group, index) => progress[index] && !group.every(isInstantOperation),
  );
  const exceptional = groups.map((group, index) =>
    progress[index] && group[0].type !== "agentMessage"
      ? executionSegments(group, resolve, true).reduce(
          (count, segment) =>
            count + (segment.kind === "summary" ? segment.items.length : 1),
          0,
        )
      : 0,
  );
  const exceptionCount = exceptional.reduce((count, value) => count + value, 0);
  const firstProgressIndex = progress.findIndex(Boolean);
  useEffect(() => {
    const reveal = (event: Event) => {
      const itemId = (event as CustomEvent<{ itemId: string }>).detail?.itemId;
      if (items.some((item) => item.id === itemId)) setCollapsed(false);
    };
    window.addEventListener("conversation-reveal-item", reveal);
    return () => window.removeEventListener("conversation-reveal-item", reveal);
  }, [items, setCollapsed]);
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
        onClick={(event) => {
          event.currentTarget.dispatchEvent(
            new Event(BEFORE_EXECUTION_LAYOUT, { bubbles: true }),
          );
          setCollapsed(!collapsed);
        }}
      >
        <ChevronRight
          size={14}
          className={`motion-reduce:transition-none ${manualCollapsed !== null || animatedProgress ? "transition-transform duration-200" : ""} ${collapsed ? "" : "rotate-90"}`}
        />
        {collapsed ? "展开执行过程" : "收起执行过程"}
      </Button>
      <hr className="min-w-0 flex-1 border-0 border-t border-border" />
    </div>
  );
  return (
    <PinProcess.Provider
      value={collapsed ? undefined : () => setCollapsed(false)}
    >
      <>
        {groups.map((group, index) => {
          const enter = !seenGroups.has(group[0].id);
          const content = children(
            group,
            hasProgress && index === summaryIndex,
            progress[index] && collapsed,
            enter,
            manualCollapsed !== null,
          );
          return (
            <Fragment
              key={
                group[0].type === "userMessage"
                  ? (group[0].clientId ?? group[0].id)
                  : group[0].id
              }
            >
              {index === firstProgressIndex && (
                <>
                  <AnimatedExecution
                    data-slot="conversation-process-motion"
                    contentClassName="flow-root min-w-0"
                    running={liveMotion}
                    enter={!seenProgress}
                    motionItems={group.map((item) => ({
                      id: item.id,
                      instant: isInstantOperation(item),
                      state: [item],
                    }))}
                  >
                    {divider}
                  </AnimatedExecution>
                  {collapsed && exceptionCount > 0 && (
                    <p role="status" className="mb-3 text-xs text-muted">
                      有 {exceptionCount}{" "}
                      项执行记录需要关注，当前仅显示这些记录。展开执行过程可查看全部。
                    </p>
                  )}
                </>
              )}
              <AnimatedDisclosure
                id={progress[index] ? `${id}-${index}` : undefined}
                open={!progress[index] || !collapsed || exceptional[index] > 0}
                animate={
                  progress[index] &&
                  (manualCollapsed !== null || !group.every(isInstantOperation))
                }
              >
                {group[0].type === "agentMessage" ? (
                  <AnimatedExecution
                    data-slot="conversation-message-motion"
                    contentClassName="flow-root min-w-0"
                    running={liveMotion}
                    enter={enter}
                    motionItems={group.map((item) => ({
                      id: item.id,
                      instant: false,
                      state: [item],
                    }))}
                  >
                    {content}
                  </AnimatedExecution>
                ) : (
                  content
                )}
              </AnimatedDisclosure>
            </Fragment>
          );
        })}
      </>
    </PinProcess.Provider>
  );
}
export const Item = memo(function Item({
  item,
  action,
  delivery,
  streaming = false,
  hideDivider = false,
}: {
  item: ThreadItem;
  action?: ReactNode;
  delivery?: ReactNode;
  streaming?: boolean;
  hideDivider?: boolean;
}) {
  if (item.type === "agentMessage") {
    if (!item.text.trim()) return null;
    return (
      <article
        data-reading-id={item.id}
        data-slot={
          item.phase === "final_answer"
            ? "assistant-final-answer"
            : "assistant-answer"
        }
        className="mb-6"
      >
        {!hideDivider && (item.phase === "final_answer" || action) && (
          <hr className="mb-5 border-0 border-t border-border" />
        )}
        <Markdown text={item.text} streaming={streaming} />
        {action}
      </article>
    );
  }
  if (item.type === "userMessage")
    return (
      <article
        tabIndex={-1}
        data-answer-record={item.clientId ?? item.id}
        data-question-answer-for={asyncAnswerItemId(item.clientId)}
        data-prompt-id={item.id}
        data-reading-id={item.id}
        className="relative mb-6 ml-auto w-fit min-w-0 max-w-full rounded-xl border border-border bg-surface p-3 pr-12 sm:px-5 sm:py-4 sm:pr-12"
      >
        {action}
        <CollapsiblePrompt
          preview={item.content
            .map((part) => (part.type === "text" ? part.text : "附件"))
            .join("\n")}
        >
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
        </CollapsiblePrompt>
        {delivery}
      </article>
    );
  return <ToolItem item={item} />;
});
export function Timeline(props: TimelineProps) {
  const { submissions } = useRuntime();
  const identity = props.thread
    ? submissions.messages.threadIdentity(props.thread.id)
    : undefined;
  return (
    <FileLinkProvider cwd={props.thread?.cwd} threadId={props.thread?.id}>
      <ReadingChoices.Provider
        value={
          props.cacheScope && props.thread
            ? conversationReadingCache.entry(props.cacheScope, identity!)
                .choices
            : undefined
        }
      >
        <TimelineContent key={`${props.cacheScope}:${identity}`} {...props} />
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
  const { submissions, requests } = useRuntime();
  const requestState = useSyncExternalStore(
    requests.subscribe,
    requests.getSnapshot,
  );
  const toolAnswers = requestState.submittedAnswers.filter(
    (answer) => answer.threadId === thread?.id,
  );

  useSyncExternalStore(
    submissions.messages.subscribe,
    submissions.messages.getSnapshot,
  );
  const localMessages = thread ? submissions.messages.forThread(thread.id) : [];
  const threadIdentity = thread
    ? submissions.messages.threadIdentity(thread.id)
    : undefined;
  const viewport = useRef<HTMLDivElement>(null);
  const initialPresentation = useRef(true);
  useLayoutEffect(() => {
    if (!loading && thread?.id) initialPresentation.current = false;
  }, [loading, thread?.id]);
  const following = useRef(true);
  const lastScrollTop = useRef(0);
  const synchronizedScroll = useRef<number | null>(null);
  const readingIntentUntil = useRef(0);
  const touchY = useRef<number | null>(null);
  const draggingScrollbar = useRef(false);
  const anchor = useRef<{ element: Element; offset: number }[]>([]);
  const [away, setAway] = useState(false);
  const rollbackLock = useRef(false);
  const [rollbackTarget, setRollbackTarget] = useState<{
    turnId: string;
    messageId: string;
    index: number;
  } | null>(null);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  useEffect(() => {
    setRollbackError(null);
    setRollbackTarget(null);
  }, [thread?.id]);
  const running = conversationExecuting(thread);
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
      cacheScope && threadIdentity
        ? conversationReadingCache.entry(cacheScope, threadIdentity)
        : undefined;
    const saved = entry?.reading;
    following.current = saved?.following ?? true;
    readingIntentUntil.current = 0;
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
  }, [cacheScope, threadIdentity]);
  function pauseFollowing() {
    const el = viewport.current;
    // An input that cannot scroll produces no scroll event to restore following.
    if (!el || el.scrollHeight - el.clientHeight <= 5) return;
    following.current = false;
    anchor.current = [];
    setAway(true);
  }
  function nestedConsumesUp(target: EventTarget, outer: Element) {
    let nested = (target as Element).closest<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    while (nested && nested !== outer) {
      if (nested.scrollTop > 0) return true;
      // Some details (such as tool progress) contain scrolling at their edges.
      // Their input must not arm conversation navigation during layout changes.
      if (
        nested.scrollHeight > nested.clientHeight &&
        getComputedStyle(nested).overscrollBehaviorY !== "auto"
      )
        return true;
      nested =
        nested.parentElement?.closest<HTMLElement>(
          "[data-radix-scroll-area-viewport]",
        ) ?? null;
    }
    return false;
  }
  function hasReadingScroll(el: HTMLDivElement) {
    return (
      Date.now() < readingIntentUntil.current &&
      el.scrollTop < lastScrollTop.current - 1 &&
      el.scrollHeight - el.scrollTop - el.clientHeight > 5 &&
      (synchronizedScroll.current === null ||
        Math.abs(el.scrollTop - synchronizedScroll.current) > 1)
    );
  }
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
          "article, [data-slot=execution-summary] > summary:not([hidden]), [data-slot=conversation-tool], [data-slot=turn-process-divider]",
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
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    let frame = 0;
    const capturePendingScroll = () => {
      if (following.current && hasReadingScroll(el)) pauseFollowing();
      if (
        !following.current &&
        (!anchor.current.length ||
          Math.abs(el.scrollTop - lastScrollTop.current) > 1)
      ) {
        // A native scroll event may still be pending when a disclosure changes.
        // Capture the requested reading position before React mutates the DOM.
        captureAnchor(el);
        lastScrollTop.current = el.scrollTop;
        synchronizedScroll.current = el.scrollTop;
      }
      // A grow and fold in one frame can have zero net size change, so the
      // ResizeObserver need not fire. One post-commit sync still restores the
      // reading position captured between those two changes.
      if (!frame) frame = requestAnimationFrame(synchronize);
    };
    el.addEventListener(BEFORE_EXECUTION_LAYOUT, capturePendingScroll);
    const synchronize = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (!el.getClientRects().length || !el.clientWidth || !el.clientHeight)
        return;
      // Folding content or enlarging the viewport can remove all scroll range.
      // Loading placeholders must not discard a saved reading position.
      if (!loading && el.scrollHeight - el.clientHeight <= 5) {
        following.current = true;
        readingIntentUntil.current = 0;
        anchor.current = [];
        setAway(false);
      }
      // Only input can pause following. Layout clamping can move scrollTop up too.
      if (following.current && hasReadingScroll(el)) {
        following.current = false;
        captureAnchor(el);
        setAway(true);
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
    // ResizeObserver runs before paint; pin the bottom in this frame, not the next.
    const observer = new ResizeObserver(synchronize);
    const body = el.firstElementChild;
    if (body) {
      observer.observe(body);
    }
    observer.observe(el);
    if (following.current) {
      el.scrollTop = el.scrollHeight;
      lastScrollTop.current = el.scrollTop;
    }
    synchronize();
    return () => {
      el.removeEventListener(BEFORE_EXECUTION_LAYOUT, capturePendingScroll);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [thread?.id, loading]);
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
            pauseFollowing();
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
          const scrollbar = (event.target as Element).closest(
            "[data-orientation=vertical]",
          );
          if (scrollbar?.parentElement === event.currentTarget) {
            draggingScrollbar.current = true;
            readingIntentUntil.current = Date.now() + 2000;
          }
        }}
        onPointerMoveCapture={() => {
          if (draggingScrollbar.current)
            readingIntentUntil.current = Date.now() + 2000;
        }}
        onPointerUpCapture={() => {
          draggingScrollbar.current = false;
        }}
        viewportProps={{
          // Reading anchors and bottom following are managed here. Native
          // anchoring can otherwise turn a content collapse into an upward
          // scroll that is mistaken for navigation away from the bottom.
          style: { overflowAnchor: "none" },
          onWheel: (event) => {
            if (
              event.defaultPrevented ||
              nestedConsumesUp(event.target, event.currentTarget)
            )
              return;
            // Record intent before the native scroll, but only pause following
            // once this viewport actually moves. Inner details may consume it.
            if (event.deltaY < 0) {
              readingIntentUntil.current = Date.now() + 1500;
            }
          },
          onTouchStart: (event) => {
            touchY.current = event.touches[0]?.clientY ?? null;
          },
          onTouchMove: (event) => {
            const next = event.touches[0]?.clientY ?? null;
            if (
              !event.defaultPrevented &&
              next !== null &&
              touchY.current !== null &&
              next > touchY.current &&
              !nestedConsumesUp(event.target, event.currentTarget)
            ) {
              readingIntentUntil.current = Date.now() + 1500;
            }
            touchY.current = next;
          },
          onTouchEnd: () => {
            touchY.current = null;
          },
          onKeyDown: (event) => {
            if (
              !event.defaultPrevented &&
              (["ArrowUp", "PageUp", "Home"].includes(event.key) ||
                (event.key === " " && event.shiftKey)) &&
              !nestedConsumesUp(event.target, event.currentTarget) &&
              !(event.target as Element).closest(
                "input, textarea, [contenteditable=true]",
              )
            ) {
              readingIntentUntil.current = Date.now() + 1500;
            }
          },
          onScroll: (event) => {
            const el = event.currentTarget;
            const synchronized =
              synchronizedScroll.current !== null &&
              Math.abs(el.scrollTop - synchronizedScroll.current) <= 1;
            const atBottom =
              el.scrollHeight - el.scrollTop - el.clientHeight < 5;
            // Browser layout adjustments never count as reading intent.
            // Intentional in-app navigation pauses following explicitly.
            if (atBottom) {
              following.current = true;
              if (!draggingScrollbar.current) readingIntentUntil.current = 0;
            } else if (hasReadingScroll(el)) following.current = false;
            synchronizedScroll.current = null;
            lastScrollTop.current = el.scrollTop;
            // Our own per-frame corrections must keep the original reading offset.
            if (!following.current && !synchronized) {
              // Capture before an immediate disclosure change can alter the layout.
              captureAnchor(el);
            } else if (following.current) anchor.current = [];
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
              submissions.messages
                .presentationTurns(thread)
                .map((turn, index) => {
                  const local = localMessages.find(
                    (message) => message.id === turn.id,
                  );
                  const displayItems = withToolAnswers(
                    turn.items.map((item) =>
                      submissions.messages.presentationItem(item),
                    ),
                    toolAnswers.filter((answer) => answer.turnId === turn.id),
                  );
                  const operationContext: OperationGroupContext = {
                    historical: index < thread.turns.length - 1,
                    threadId: thread.id,
                    turnId: turn.id,
                    turnStatus: turn.status,
                    completedItems,
                    startedItems,
                    waitingItems,
                  };
                  return (
                    <section
                      data-slot={local ? "local-message" : "conversation-turn"}
                      data-delivery-status={local?.status}
                      data-turn-id={turn.id}
                      className={`relative pt-3 pb-6 ${index > 0 ? "border-t border-border" : ""}`}
                      key={submissions.messages.identity(turn.id)}
                      aria-label={`第 ${index + 1} 轮对话`}
                    >
                      <TurnContent
                        items={displayItems}
                        context={operationContext}
                        initiallyPresent={
                          initialPresentation.current ||
                          operationContext.historical
                        }
                      >
                        {(
                          group,
                          hideDivider,
                          attentionOnly,
                          enter,
                          manualFiltering,
                        ) =>
                          toolAnswers.some(
                            (answer) => toolAnswerId(answer) === group[0].id,
                          ) ? (
                            <ToolAnswerRecord
                              answer={toolAnswers.find(
                                (answer) =>
                                  toolAnswerId(answer) === group[0].id,
                              )!}
                            />
                          ) : group[0].type === "userMessage" ||
                            group[0].type === "agentMessage" ? (
                            <Item
                              hideDivider={hideDivider}
                              item={group[0]}
                              streaming={turn.status === "inProgress"}
                              action={
                                group[0].type === "userMessage" &&
                                onRollback &&
                                !localMessages.some(
                                  (message) => message.id === group[0].id,
                                ) ? (
                                  <button
                                    type="button"
                                    data-rollback
                                    className="absolute top-4 right-2.5 inline-flex size-7 items-center justify-center rounded-md border-0 bg-transparent text-muted hover:enabled:bg-selected hover:enabled:text-accent disabled:cursor-not-allowed disabled:opacity-40"
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
                                      setRollbackTarget({
                                        turnId: turn.id,
                                        messageId: group[0].id,
                                        index,
                                      })
                                    }
                                  >
                                    {rollingBack === turn.id ? (
                                      <LoaderCircle size={15} />
                                    ) : (
                                      <Undo2 size={15} />
                                    )}
                                  </button>
                                ) : undefined
                              }
                              delivery={
                                group[0].type === "userMessage" &&
                                localMessages.find(
                                  (message) => message.id === group[0].id,
                                ) ? (
                                  localMessages.find(
                                    (message) => message.id === group[0].id,
                                  )?.questionTaskId ? (
                                    <QuestionAnswerDelivery
                                      message={localMessages.find(
                                        (message) => message.id === group[0].id,
                                      )!}
                                    />
                                  ) : (
                                    <LocalDeliveryStatus
                                      message={localMessages.find(
                                        (message) => message.id === group[0].id,
                                      )!}
                                      onRestore={() =>
                                        submissions.restoreMessage(group[0].id)
                                      }
                                      onDismiss={() =>
                                        submissions.messages.remove(group[0].id)
                                      }
                                    />
                                  )
                                ) : undefined
                              }
                            />
                          ) : (
                            <OperationGroup
                              key={operationKey(
                                thread.id,
                                turn.id,
                                group[0].id,
                              )}
                              items={group}
                              attentionOnly={attentionOnly}
                              manualFiltering={manualFiltering}
                              enter={enter}
                              initiallyPresent={initialPresentation.current}
                              hasFollowingContent={
                                group.at(-1)?.id !== displayItems.at(-1)?.id
                              }
                              context={operationContext}
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
                      {!local && (
                        <TurnResults
                          turn={turn}
                          cwd={thread.cwd}
                          diff={turnDiffs?.[turn.id]}
                        />
                      )}
                      {!local && (
                        <TurnFooter
                          thread={thread}
                          turn={turn}
                          confirmed={finishedTurns?.[turn.id]}
                        />
                      )}
                    </section>
                  );
                })
            )}
            {!loading &&
              thread &&
              toolAnswers
                .filter(
                  (answer) =>
                    !thread.turns.some((turn) => turn.id === answer.turnId),
                )
                .map((answer) => (
                  <ToolAnswerRecord
                    key={`${answer.epoch}:${answer.id}`}
                    answer={answer}
                  />
                ))}
          </div>
        </div>
      </ScrollArea>
      <Modal
        open={rollbackTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRollbackTarget(null);
        }}
        title="确认回滚对话？"
      >
        <p className="text-sm text-muted">
          将移除第 {(rollbackTarget?.index ?? 0) + 1}{" "}
          轮及其后全部对话，并在此位置继续。共{" "}
          {(thread?.turns.length ?? 0) - (rollbackTarget?.index ?? 0)}{" "}
          轮。已修改的文件会保留，不会撤销；原问题将恢复到输入框，可修改后重发。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="quiet" onClick={() => setRollbackTarget(null)}>
            取消
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (rollbackTarget) {
                void rollback(rollbackTarget.turnId, rollbackTarget.messageId);
                setRollbackTarget(null);
              }
            }}
          >
            确认回滚
          </Button>
        </div>
      </Modal>
      {!loading && thread && <AsyncQuestionPanel thread={thread} />}
      {away && (
        <Button
          className="absolute bottom-4 left-1/2 -translate-x-1/2 shadow-md"
          onClick={() => {
            following.current = true;
            readingIntentUntil.current = 0;
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
  return (
    <section
      data-slot="local-message"
      data-delivery-status={message.status}
      className="pt-3 pb-6"
    >
      <Item
        item={{
          type: "userMessage",
          id: message.id,
          clientId: message.id,
          content: message.input,
        }}
        delivery={
          <LocalDeliveryStatus
            message={message}
            onDismiss={onDismiss}
            onRestore={onRestore}
          />
        }
      />
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
      className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted"
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
      {turn.status !== "inProgress" &&
        (() => {
          const answer = [...turn.items]
            .reverse()
            .find(
              (item) =>
                item.type === "agentMessage" &&
                !isTimelineProgress(item, turn.items),
            );
          return answer?.type === "agentMessage" ? (
            <CopyAnswer text={answer.text} />
          ) : null;
        })()}
    </footer>
  );
}
