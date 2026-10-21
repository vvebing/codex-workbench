import type { Thread } from "../../generated/v2/Thread";

/** Preserve explicit names. Only clean procedural prefixes from the preview fallback. */
export function navigationTitle(
  thread: Pick<Thread, "name" | "preview">,
): string {
  if (thread.name?.trim()) return thread.name.trim();
  const first = (
    thread.preview.split(/\r?\n/).find((line) => line.trim()) || ""
  )
    .replace(/\s+/g, " ")
    .trim();
  if (!first) return "新会话";
  const title = first
    .replace(/^(?:#{1,6}\s+|[-*]\s+|\d+[.、）)]\s*)/, "")
    .replace(
      /^(?:请你|请帮我|帮我|请)(?=检查|查看|分析|使用|实现|修复|调整|修改|更新|优化|重构|整理|解释|帮)/,
      "",
    )
    .replace(/^使用\s+\$[\w-]+\s+/, "")
    .replace(/`([^`]+)`/g, "$1");
  return title || first;
}
export function navigationSubtitle(thread: Pick<Thread, "name" | "preview">) {
  return thread.name?.trim() && thread.preview.trim() !== thread.name.trim()
    ? thread.preview.replace(/\s+/g, " ").trim()
    : "";
}
