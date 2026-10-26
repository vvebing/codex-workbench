import { t } from "../../lib/i18n";
import type { ThreadItem } from "../../generated/v2/ThreadItem";
/** Keep explicit final answers and the last legacy reply outside progress controls. */
export function isTimelineProgress(
  item: ThreadItem,
  items: readonly ThreadItem[],
): boolean {
  if (item.type === "userMessage") return false;
  if (item.type !== "agentMessage") return true;
  if (item.questions?.length || item.phase === "final_answer") return false;
  if (item.phase === "commentary") return true;
  return (
    item !==
    items.findLast(
      (candidate) =>
        candidate.type === "agentMessage" && candidate.phase !== "commentary",
    )
  );
}
export function groupTimelineItems(items: ThreadItem[]): ThreadItem[][] {
  const groups: ThreadItem[][] = [];
  for (const item of items) {
    const message = item.type === "agentMessage" || item.type === "userMessage";
    const last = groups.at(-1);
    const previous = last?.[0];
    if (
      !message &&
      previous &&
      previous.type !== "agentMessage" &&
      previous.type !== "userMessage"
    )
      last!.push(item);
    else groups.push([item]);
  }
  return groups;
}
export function splitFileDiffs(diff: string): Map<string, string> {
  const files = new Map<string, string>();
  let path: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (path) files.set(path, lines.join("\n"));
  };
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      const match = / b\/(.+)$/.exec(line);
      path = match?.[1]?.replace(/^"|"$/g, "") ?? null;
      lines = [line];
    } else if (
      line.startsWith("--- ") &&
      !lines.some((value) => value.startsWith("diff --git "))
    ) {
      flush();
      path = line.slice(4).replace(/^a\//, "").split("\t")[0];
      lines = [line];
    } else {
      lines.push(line);
      if (line.startsWith("+++ ") && (!path || path === "/dev/null"))
        path = line.slice(4).replace(/^b\//, "").split("\t")[0];
    }
  }
  flush();
  return files;
}

export interface DisplayFileChange {
  path: string;
  originalPath: string;
  diff: string;
}
export function mergeFileChanges(
  changes: { path: string; diff: string }[],
  diff: string,
  cwd?: string,
): Map<string, DisplayFileChange> {
  const files = new Map<string, DisplayFileChange>();
  const normalize = (path: string) => {
    const clean = path.replace(/\\/g, "/").replace(/^\.\//, "");
    const root = cwd?.replace(/\\/g, "/").replace(/\/$/, "");
    return root && clean.startsWith(`${root}/`)
      ? clean.slice(root.length + 1)
      : clean;
  };
  for (const file of changes) {
    const path = normalize(file.path);
    files.set(path, { path, originalPath: file.path, diff: file.diff });
  }
  for (const [rawPath, fileDiff] of splitFileDiffs(diff)) {
    const path = normalize(rawPath);
    files.set(path, {
      path,
      originalPath: files.get(path)?.originalPath ?? rawPath,
      diff: fileDiff,
    });
  }
  return files;
}
export function executionStatusLabel(status: string): string {
  return (
    (
      {
        completed: t("已完成"),
        recorded: t("已记录"),
        inProgress: t("执行中"),
        failed: t("失败"),
        declined: t("已拒绝"),
        interrupted: t("已中断"),
        pending: t("待执行"),
        pendingInit: t("正在启动"),
        running: t("执行中"),
        errored: t("失败"),
        shutdown: t("已关闭"),
        notFound: t("代理不可用"),
        unknown: t("状态待确认"),
        waiting: t("等待确认"),
        cancelled: t("已取消"),
      } as Record<string, string>
    )[status] ?? status
  );
}
