import type { ThreadItem } from "../../generated/v2/ThreadItem";
import type { TurnStatus } from "../../generated/v2/TurnStatus";

/** Include rich results and input arguments, not only the plain-text preview. */
export function hasOperationContent(
  item: ThreadItem,
  content: string,
  progress?: string[],
  output?: string,
): boolean {
  return (
    !!content.trim() ||
    !!output?.trim() ||
    !!progress?.some((entry) => entry.trim()) ||
    item.type === "mcpToolCall" ||
    item.type === "dynamicToolCall" ||
    (item.type === "fileChange" && item.changes.length > 0) ||
    (item.type === "imageGeneration" &&
      !!(item.result || item.savedPath || item.failure)) ||
    (item.type === "webSearch" && !!item.results?.length) ||
    (item.type === "functionCallOutput" &&
      Array.isArray(item.output) &&
      item.output.length > 0)
  );
}

/** File changes and durations shown as 0.0 seconds do not need automatic motion. */
export function isInstantOperation(item: ThreadItem): boolean {
  if (item.type === "fileChange") return true;
  return (
    "durationMs" in item &&
    item.durationMs !== null &&
    (item.durationMs / 1000).toFixed(1) === "0.0"
  );
}

/** Resolve an operation independently of its siblings or the enclosing turn. */
export function operationStatus(
  item: ThreadItem,
  turnStatus: TurnStatus | undefined,
  completed: boolean,
  waiting: boolean,
  started = false,
): string {
  if (item.type === "dynamicToolCall" && item.success === false)
    return "failed";
  if (item.type === "imageGeneration" && item.failure) return "failed";
  const status = "status" in item ? item.status : undefined;
  // A terminal item result remains authoritative if the turn later fails.
  if (status && status !== "inProgress" && status !== "in_progress")
    return status;
  if (completed) return "completed";
  if (turnStatus === "failed" || turnStatus === "interrupted")
    return turnStatus;
  // Historical statusless items have no live lifecycle marker.
  if (turnStatus === "completed") return "completed";
  if (waiting) return "waiting";
  return status || started ? "inProgress" : "recorded";
}

export function commandTitle(
  item: Extract<ThreadItem, { type: "commandExecution" }>,
): string {
  if (item.commandActions.length !== 1)
    return fallbackCommandTitle(item.command);
  const action = item.commandActions[0];
  switch (action.type) {
    case "read":
      return `读取 ${action.name || action.path}`;
    case "listFiles":
      return action.path ? `浏览 ${action.path}` : "浏览文件";
    case "search":
      return action.query
        ? `搜索 ${action.query}${action.path ? ` · ${action.path}` : ""}`
        : action.path
          ? `搜索 ${action.path}`
          : "搜索文件";
    default:
      return fallbackCommandTitle(item.command);
  }
}

/** Display a bounded command preview without attempting to interpret shell code. */
function fallbackCommandTitle(command: string): string {
  const compact = command.replace(/\s+/g, " ").trim();
  const shell =
    /^(?:\/[^\s]+\/)?(?:bash|zsh|sh)\s+-[a-z]*c\s+(["'])([\s\S]*)\1$/.exec(
      compact,
    );
  const preview = shell?.[2] ?? compact;
  return `执行命令 · ${preview.length > 100 ? `${preview.slice(0, 100)}…` : preview}`;
}

export interface OperationGroupContext {
  historical: boolean;
  completedItems?: Readonly<Record<string, boolean>>;
  startedItems?: Readonly<Record<string, boolean>>;
  waitingItems?: readonly string[];
  threadId: string;
  turnId: string;
  turnStatus: TurnStatus;
}
