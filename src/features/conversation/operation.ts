import type { ThreadItem } from "../../generated/v2/ThreadItem";
import type { TurnStatus } from "../../generated/v2/TurnStatus";

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
  if (item.commandActions.length !== 1) return item.command;
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
      return item.command;
  }
}

export interface OperationGroupContext {
  historical: boolean;
  completedItems?: Readonly<Record<string, boolean>>;
  startedItems?: Readonly<Record<string, boolean>>;
  waitingItems?: readonly string[];
  expandedItems?: readonly string[];
  threadId: string;
  turnId: string;
  turnStatus: TurnStatus;
}

export interface OperationExpansion {
  open: boolean;
  version: number;
  summaryId?: string;
}

/** A batch may gain members or a new first item; preserve its latest user choice. */
export function operationSummaryExpansion(
  items: readonly ThreadItem[],
  choices: Readonly<Record<string, OperationExpansion>>,
): OperationExpansion | undefined {
  let latest: OperationExpansion | undefined;
  for (const item of items) {
    const choice = choices[item.id];
    if (choice && (!latest || choice.version > latest.version)) latest = choice;
  }
  return latest;
}

/** Compact only successful operations, keeping chronological order in both lists. */
export function partitionOperationGroup(
  items: readonly ThreadItem[],
  context: OperationGroupContext,
  limit = 6,
): { visible: ThreadItem[]; hidden: ThreadItem[] } {
  if (!context.historical || context.turnStatus === "inProgress")
    return { visible: [...items], hidden: [] };
  const successful = items.filter((item) => {
    if (
      item.type === "userMessage" ||
      item.type === "agentMessage" ||
      item.type === "reasoning" ||
      item.type === "plan" ||
      item.type === "subAgentActivity" ||
      item.type === "collabAgentToolCall" ||
      context.expandedItems?.includes(item.id) ||
      context.waitingItems?.includes(item.id)
    )
      return false;
    const completed =
      !!context.completedItems?.[
        JSON.stringify([context.threadId, context.turnId, item.id])
      ];
    // Preserve a known live operation even if a historical turn is stale.
    if (
      "status" in item &&
      (item.status === "inProgress" || item.status === "in_progress") &&
      !completed
    )
      return false;
    return (
      operationStatus(item, context.turnStatus, completed, false) ===
      "completed"
    );
  });
  const hiddenIds = new Set(
    successful
      .slice(0, Math.max(0, successful.length - Math.max(0, Math.floor(limit))))
      .map((item) => item.id),
  );
  return {
    visible: items.filter((item) => !hiddenIds.has(item.id)),
    hidden: items.filter((item) => hiddenIds.has(item.id)),
  };
}
