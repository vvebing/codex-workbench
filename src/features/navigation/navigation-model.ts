import { getLocale, t } from "../../lib/i18n";
import type { Thread } from "../../generated/v2/Thread";
import type { Environment } from "../connection/environments";
import type { SessionsState } from "../sessions/state";
import type { TaskEntry } from "../task-center/model";
import type { LocalMessage } from "../composer/local-messages";
import { folderOf } from "../../components/hooks";
import { conversationExecuting } from "../conversation/activity";
import {
  navigationEnvironmentKey,
  navigationVisitKey,
  type NavigationStatus,
} from "./navigation-state";
import { visibleSidebarThreads } from "./sidebar-state";
import { isSubagentThread } from "../sessions/state";

export interface NavigationEnvironment {
  environment: Environment;
  sessions: SessionsState;
  tasks: TaskEntry[];
  connected: boolean;
  environmentKey: string;
  messages?: Pick<LocalMessage, "threadId" | "status">[];
}
export interface NavigationThread {
  key: string;
  thread: Thread;
  source: NavigationEnvironment;
  projectKey: string;
  waiting: "待审批" | "待回答" | "队列已暂停" | null;
  failed: boolean;
  running: boolean;
  initializing: string | null;
  unread: boolean;
  visited: number;
}
export interface NavigationProject {
  key: string;
  id: string;
  name: string;
  cwd: string;
  source: NavigationEnvironment;
  threads: NavigationThread[];
  attention: number;
  latestActivityAt: number;
}
export function navigationActivityAt(
  thread: Pick<Thread, "createdAt" | "updatedAt" | "recencyAt">,
) {
  return Math.max(thread.createdAt, thread.updatedAt, thread.recencyAt ?? 0);
}
export function navigationThreads(
  sources: NavigationEnvironment[],
  visits: Record<string, number>,
): NavigationThread[] {
  return sources.flatMap((source) => {
    const byId = new Map<string, TaskEntry[]>();
    const pending = new Map<string, "creating" | "sending">();
    for (const message of source.messages ?? [])
      if (message.status === "creating" || message.status === "sending")
        pending.set(message.threadId, message.status);
    for (const task of source.tasks)
      if (task.threadId)
        byId.set(task.threadId, [...(byId.get(task.threadId) || []), task]);
    return [
      ...new Map(
        visibleSidebarThreads(source.sessions)
          .filter(
            (thread) =>
              !isSubagentThread(thread) &&
              !source.sessions.subagentThreadIds[thread.id],
          )
          .map((thread) => [thread.id, thread]),
      ).values(),
    ].map((thread) => {
      const tasks = byId.get(thread.id) || [];
      const running = conversationExecuting(thread);
      const delivery = [
        thread.id,
        source.sessions.localDrafts[thread.id]?.serverId,
        source.sessions.draftOrigins[thread.id],
      ]
        .map((id) => (id ? pending.get(id) : undefined))
        .find(Boolean);
      return {
        key: navigationVisitKey(source.environmentKey, thread.id),
        thread,
        source,
        projectKey: JSON.stringify([
          source.environmentKey,
          thread.projectId
            ? `project:${thread.projectId}`
            : `cwd:${thread.cwd}`,
        ]),
        waiting: tasks.some((task) => task.category === "待审批")
          ? ("待审批" as const)
          : tasks.some((task) => task.category === "待回答")
            ? ("待回答" as const)
            : tasks.some((task) => task.category === "暂停队列")
              ? ("队列已暂停" as const)
              : null,
        failed:
          tasks.some((task) => task.category === "失败或待核实") ||
          thread.status.type === "systemError" ||
          thread.turns.at(-1)?.status === "failed",
        running,
        initializing:
          source.sessions.openingId === thread.id
            ? t("正在打开")
            : !source.connected
              ? null
              : !running && delivery === "creating"
                ? t("正在创建会话")
                : source.sessions.threadAccess[thread.id] === "activating"
                  ? t("正在初始化")
                  : !running && delivery === "sending"
                    ? t("正在发送")
                    : null,
        unread: !!source.sessions.unreadCompleted[thread.id],
        visited:
          visits[navigationVisitKey(source.environmentKey, thread.id)] || 0,
      };
    });
  });
}
export function matchesNavigationStatus(
  item: NavigationThread,
  status: NavigationStatus,
) {
  if (status === "attention") return !!item.waiting || item.failed;
  if (status === "running") return item.running && item.source.connected;
  if (status === "unread") return item.unread;
  return true;
}
export function navigationProjects(
  items: NavigationThread[],
): NavigationProject[] {
  const projects = new Map<string, NavigationProject>();
  for (const item of items) {
    const existing = projects.get(item.projectKey);
    if (existing) existing.threads.push(item);
    else
      projects.set(item.projectKey, {
        key: item.projectKey,
        id: item.thread.projectId
          ? `project:${item.thread.projectId}`
          : `cwd:${item.thread.cwd}`,
        name: folderOf(item.thread.cwd),
        cwd: item.thread.cwd,
        source: item.source,
        threads: [item],
        attention: 0,
        latestActivityAt: 0,
      });
  }
  for (const project of projects.values()) {
    // A canonical project can span worktrees. Its fallback label must not depend
    // on which thread happens to arrive first during history discovery.
    project.cwd = project.threads.map((item) => item.thread.cwd).sort()[0];
    project.name = folderOf(project.cwd);
    project.attention = project.threads.filter(
      (item) => item.waiting || item.failed,
    ).length;
    project.latestActivityAt = Math.max(
      ...project.threads.map((item) => navigationActivityAt(item.thread)),
    );
  }
  return [...projects.values()].sort(
    (a, b) =>
      b.latestActivityAt - a.latestActivityAt ||
      a.source.environment.name.localeCompare(
        b.source.environment.name,
        getLocale(),
      ) ||
      a.name.localeCompare(b.name, getLocale()) ||
      a.key.localeCompare(b.key),
  );
}
export function threadStatus(item: NavigationThread) {
  if (!item.source.connected && item.running) return t("状态待同步");
  if (
    !item.waiting &&
    item.source.tasks.some(
      (task) =>
        task.threadId === item.thread.id &&
        task.category === "失败或待核实" &&
        task.uncertain,
    )
  )
    return t("待核实");
  return (
    (item.waiting ? t(item.waiting) : "") ||
    (item.failed ? t("执行失败") : item.running ? t("运行中") : "")
  );
}
export function recentDateLabel(timestamp: number, now = new Date()) {
  const date = new Date(timestamp);
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const day = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
  ).getTime();
  return day === today ? t("今天") : day === yesterday ? t("昨天") : t("更早");
}
export { navigationEnvironmentKey };
