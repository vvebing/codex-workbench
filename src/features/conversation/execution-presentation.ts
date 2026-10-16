import type { ThreadItem } from "../../generated/v2/ThreadItem";

export type ExecutionSegment =
  | { kind: "item"; item: ThreadItem }
  | { kind: "summary"; id: string; items: ThreadItem[]; label: string };

type Category = "read" | "search" | "run" | "tool" | "file";
function category(item: ThreadItem): Category | undefined {
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
    default:
      return undefined;
  }
}
function summaryLabel(kind: Category, count: number): string {
  switch (kind) {
    case "read":
      return `读取了 ${count} 项文件操作`;
    case "search":
      return `搜索了 ${count} 项`;
    case "run":
      return `执行了 ${count} 条命令`;
    case "tool":
      return `完成 ${count} 次工具调用`;
    case "file":
      return `修改了 ${count} 项文件操作`;
  }
}

/** Summarize only adjacent successes; live work and exceptions always remain visible. */
export function executionSegments(
  items: readonly ThreadItem[],
  resolveStatus: (item: ThreadItem) => string,
): ExecutionSegment[] {
  const result: ExecutionSegment[] = [];
  let batch: ThreadItem[] = [];
  let batchCategory: Category | undefined;
  const flush = () => {
    if (batch.length >= 3 && batchCategory) {
      result.push({
        kind: "summary",
        id: batch[0].id,
        items: batch,
        label: summaryLabel(batchCategory, batch.length),
      });
    } else {
      result.push(
        ...batch.map((item): ExecutionSegment => ({ kind: "item", item })),
      );
    }
    batch = [];
    batchCategory = undefined;
  };
  for (const item of items) {
    const kind =
      resolveStatus(item) === "completed" ? category(item) : undefined;
    if (!kind) {
      flush();
      result.push({ kind: "item", item });
      continue;
    }
    if (batchCategory !== kind) flush();
    batchCategory = kind;
    batch.push(item);
  }
  flush();
  return result;
}
