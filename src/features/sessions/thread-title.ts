import { t } from "../../lib/i18n";
import type { Thread } from "../../generated/v2/Thread";

export interface ThreadTitleSource {
  turnId: string;
  text: string;
}
/** Client presentation metadata; never sent to app-server as a thread name. */
export type TitledThread = Thread & { titleSource?: ThreadTitleSource };
type TitleInput = Partial<
  Pick<Thread, "name" | "preview" | "turns" | "createdAt">
> & { titleSource?: ThreadTitleSource };

/** Replies and diagnostic material do not describe the task of a conversation. */
export function taskTitle(text: string): string {
  if (/^\s*(?:回答问题\s*[:：]|问题编号\s*[:：])/u.test(text)) return "";
  let fenced = false;
  for (const line of text.split(/\r?\n/u)) {
    const value = line.trim();
    if (/^(?:```|~~~)/u.test(value)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !value) continue;
    const title = value
      .replace(/^(?:#{1,6}\s+|[-*]\s+|\d+[.、）)]\s*)/u, "")
      .replace(
        /^(?:请你|请帮我|帮我|请)(?=检查|查看|分析|排查|定位|使用|实现|修复|调整|修改|更新|优化|重构|整理|解释|帮)/u,
        "",
      )
      .replace(/^使用\s+\$[\w-]+\s+/u, "")
      .replace(/`([^`]+)`/gu, "$1")
      .replace(/\s+/gu, " ")
      .trim();
    if (
      !title ||
      /^(?:回答问题|问题编号|问题描述|需求|任务|日志|报错信息|错误信息|输出|执行结果|补充信息|说明)\s*[:：]?$/u.test(
        title,
      ) ||
      /^(?:好的|是的|可以|继续|没有携带|相同|yes|no|ok|v?\d+(?:\.\d+)*)(?:[。！.!])?$/iu.test(
        title,
      ) ||
      /^(?:\[[^\]]+\]\s*[#$>]|[$>]\s|\d{4}-\d{2}-\d{2}[T\s]|\[?(?:TRACE|DEBUG|INFO|WARN|ERROR)\b)/u.test(
        title,
      ) ||
      /^(?:[{}[\],]+$|[[{]\s*["{[\d]|"[^"\n]+"\s*:|(?:const|let|var|import|export|function|class)\s|at\s+\S+\s*\()/u.test(
        title,
      )
    )
      continue;
    return title;
  }
  return "";
}

export function firstTaskTitle(
  thread: Pick<Thread, "turns">,
): ThreadTitleSource | undefined {
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (
        item.type !== "userMessage" ||
        item.clientId?.startsWith("codex-question:")
      )
        continue;
      const text = taskTitle(
        item.content
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("\n"),
      );
      if (text) return { turnId: turn.id, text };
    }
  }
  return undefined;
}

export function threadTitle(thread?: TitleInput): string {
  if (thread?.name?.trim()) return thread.name.trim();
  const source =
    thread?.titleSource ??
    (thread?.turns && firstTaskTitle({ turns: thread.turns }));
  const title = source?.text || taskTitle(thread?.preview ?? "");
  if (title) return title;
  if (!thread?.preview?.trim() && !thread?.turns?.length) return t("新会话");
  const date = thread?.createdAt
    ? new Date(thread.createdAt * 1000)
    : undefined;
  return date && Number.isFinite(date.getTime())
    ? t("未命名会话 · {{value0}}月{{value1}}日", {
        value0: date.getMonth() + 1,
        value1: date.getDate(),
      })
    : t("未命名会话");
}
