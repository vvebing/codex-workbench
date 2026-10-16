import type { Thread } from "../../generated/v2/Thread";
import type { Turn } from "../../generated/v2/Turn";

export function activeTurn(thread?: Thread) {
  return thread?.turns.findLast((turn) => turn.status === "inProgress");
}

/** Writer ownership is unrelated to execution in another client. */
export function conversationExecuting(thread?: Thread): boolean {
  return (
    thread?.status.type === "active" ||
    thread?.turns.at(-1)?.status === "inProgress"
  );
}

export function executionUnconfirmed(
  thread: Thread,
  confirmed = false,
): boolean {
  const last = thread.turns.at(-1);
  return (
    thread.status.type === "notLoaded" &&
    !confirmed &&
    last?.status === "interrupted" &&
    last.completedAt == null &&
    !last.error
  );
}

export function turnStatusLabel(
  thread: Thread,
  turn: Turn,
  confirmed = false,
): string {
  const latest = thread.turns.at(-1)?.id === turn.id;
  const unfinishedInterruption =
    !confirmed &&
    turn.status === "interrupted" &&
    turn.completedAt == null &&
    !turn.error;
  if (latest && thread.status.type === "active" && unfinishedInterruption)
    return "正在执行…";
  if (latest && executionUnconfirmed(thread, confirmed))
    return "执行状态待确认";
  return turn.status === "inProgress"
    ? "正在执行…"
    : turn.status === "failed"
      ? "执行失败"
      : turn.status === "interrupted"
        ? "已中断"
        : "已完成";
}

export function formatWorkDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours
    ? `${hours} 小时 ${minutes} 分 ${seconds % 60} 秒`
    : minutes
      ? `${minutes} 分 ${seconds % 60} 秒`
      : `${seconds} 秒`;
}

export function turnTiming(
  turn: Turn,
  executing: boolean,
  now: number,
): string | null {
  const duration = executing
    ? turn.startedAt == null
      ? null
      : now - turn.startedAt * 1000
    : (turn.durationMs ??
      (turn.startedAt != null && turn.completedAt != null
        ? (turn.completedAt - turn.startedAt) * 1000
        : null));
  return duration == null
    ? null
    : `${executing ? "已用时" : "耗时"} ${formatWorkDuration(duration)}`;
}

/** Use the viewer's local date and a stable 24-hour display. */
export function formatCompletionTime(
  completed: Date,
  now = Date.now(),
): string {
  const today = new Date(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  const time = `${pad(completed.getHours())}:${pad(completed.getMinutes())}`;
  const sameYear = completed.getFullYear() === today.getFullYear();
  const sameDay =
    sameYear &&
    completed.getMonth() === today.getMonth() &&
    completed.getDate() === today.getDate();
  if (sameDay) return time;
  const date = `${pad(completed.getMonth() + 1)}-${pad(completed.getDate())}`;
  return `${sameYear ? "" : `${completed.getFullYear()}-`}${date} ${time}`;
}
