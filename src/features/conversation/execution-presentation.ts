import { t } from "../../lib/i18n";
import type { ThreadItem } from "../../generated/v2/ThreadItem";
import { isInstantOperation } from "./operation";

export type ExecutionCategory =
  "read" | "search" | "run" | "tool" | "file" | "web";
export type ExecutionSegment =
  | { kind: "item"; item: ThreadItem }
  | {
      kind: "summary";
      id: string;
      category: ExecutionCategory;
      items: ThreadItem[];
      label: string;
      running: boolean;
      attention: number;
      waiting: boolean;
      hasFollowingItem: boolean;
    };

export function executionCategory(
  item: ThreadItem,
): ExecutionCategory | undefined {
  switch (item.type) {
    case "commandExecution": {
      const action =
        item.commandActions.length === 1 ? item.commandActions[0] : undefined;
      if (action?.type === "read" || action?.type === "listFiles")
        return "read";
      if (action?.type === "search") return "search";
      return "run";
    }
    case "mcpToolCall":
    case "dynamicToolCall":
      return "tool";
    case "fileChange":
      return "file";
    case "webSearch":
      return "web";
    default:
      return undefined;
  }
}

export function needsAttention(status: string): boolean {
  return ["failed", "declined", "interrupted", "waiting"].includes(status);
}

/** Logs with sustained output can open automatically; raw reads and diffs stay compact. */
export function automaticallyExpandOperation(
  item: ThreadItem,
  status: string,
): boolean {
  if (status === "waiting") return item.type !== "fileChange";
  if (status !== "inProgress" || isInstantOperation(item)) return false;
  const category = executionCategory(item);
  return (
    category === "run" ||
    category === "tool" ||
    [
      "reasoning",
      "plan",
      "imageGeneration",
      "collabAgentToolCall",
      "subAgentActivity",
    ].includes(item.type)
  );
}

function batchKey(item: ThreadItem): string | undefined {
  const category = executionCategory(item);
  // Different tools can represent different phases, even on the same transport.
  if (item.type === "mcpToolCall")
    return JSON.stringify([category, item.server, item.tool]);
  if (item.type === "dynamicToolCall")
    return JSON.stringify([category, item.namespace, item.tool]);
  return category;
}

function summaryLabel(
  kind: ExecutionCategory,
  items: ThreadItem[],
  running: boolean,
): string {
  const count = items.length;
  switch (kind) {
    case "read":
      return t("{{value0}} {{value1}} 项文件操作", {
        value0: running ? t("正在读取") : t("读取了"),
        value1: count,
      });
    case "search":
      return t("{{value0}} {{value1}} 项", {
        value0: running ? t("正在搜索") : t("搜索了"),
        value1: count,
      });
    case "run":
      return t("{{value0}} {{value1}} 条命令", {
        value0: running ? t("正在执行") : t("执行了"),
        value1: count,
      });
    case "tool":
      return t("{{value0}} {{value1}} · {{value2}} 次", {
        value0: running ? t("正在调用") : t("调用了"),
        value1:
          items[0].type === "mcpToolCall" || items[0].type === "dynamicToolCall"
            ? items[0].tool
            : t("工具"),
        value2: count,
      });
    case "web":
      return t("{{value0}} {{value1}} 次网页", {
        value0: running ? t("正在搜索") : t("搜索了"),
        value1: count,
      });
    case "file": {
      const paths = new Set(
        items.flatMap((item) =>
          item.type === "fileChange"
            ? item.changes.map((change) => change.path)
            : [],
        ),
      );
      return t("{{value0}} {{value1}} 个文件{{value2}}", {
        value0: running ? t("正在修改") : t("修改了"),
        value1: paths.size,
        value2: count > 1 ? t(" · {{value0}} 次修改", { value0: count }) : "",
      });
    }
  }
}

/** Batch identity starts with the first activity and never depends on count or status. */
export function executionSegments(
  items: readonly ThreadItem[],
  resolveStatus: (item: ThreadItem) => string,
  attentionOnly = false,
): ExecutionSegment[] {
  const result: ExecutionSegment[] = [];
  let batch: ThreadItem[] = [];
  let key: string | undefined;
  const flush = (hasFollowingItem = true) => {
    if (!batch.length) return;
    const category = executionCategory(batch[0])!;
    // Filter within the original batch so showing all records later preserves
    // its identity, boundaries and the reader's disclosure choices.
    const members = attentionOnly
      ? batch.filter((item) => needsAttention(resolveStatus(item)))
      : batch;
    const running = members.some((item) =>
      ["inProgress", "in_progress"].includes(resolveStatus(item)),
    );
    if (members.length)
      result.push({
        kind: "summary",
        id: batch[0].id,
        category,
        items: members,
        label: summaryLabel(category, members, running),
        running,
        waiting: members.some((item) => resolveStatus(item) === "waiting"),
        attention: members.filter((item) => needsAttention(resolveStatus(item)))
          .length,
        hasFollowingItem,
      });
    batch = [];
    key = undefined;
  };
  for (const item of items) {
    const nextKey = batchKey(item);
    if (!nextKey) {
      flush();
      // Empty thinking remains a semantic boundary, but leaves no terminal row.
      if (
        item.type === "reasoning" &&
        !["inProgress", "waiting"].includes(resolveStatus(item)) &&
        ![...item.summary, ...item.content].some((text) => text.trim())
      )
        continue;
      if (!attentionOnly || needsAttention(resolveStatus(item)))
        result.push({ kind: "item", item });
    } else {
      if (key !== nextKey) flush();
      key = nextKey;
      batch.push(item);
    }
  }
  flush(false);
  return result;
}
