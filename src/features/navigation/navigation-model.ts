import type { Thread } from "../../generated/v2/Thread";
import type { Environment } from "../connection/environments";
import type { SessionsState } from "../sessions/state";
import type { TaskEntry } from "../task-center/model";
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
}
export interface NavigationThread {
  key: string;
  thread: Thread;
  source: NavigationEnvironment;
  projectKey: string;
  waiting: "待审批" | "待回答" | "队列已暂停" | null;
  failed: boolean;
  running: boolean;
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
export function navigationThreads(
  sources: NavigationEnvironment[],
  visits: Record<string, number>,
): NavigationThread[] {
  return sources.flatMap((source) => {
    const byId = new Map<string, TaskEntry[]>();
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
        running: conversationExecuting(thread),
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
      ...project.threads.map((item) => item.thread.updatedAt),
    );
  }
  return [...projects.values()].sort(
    (a, b) =>
      b.latestActivityAt - a.latestActivityAt ||
      a.source.environment.name.localeCompare(
        b.source.environment.name,
        "zh-CN",
      ) ||
      a.name.localeCompare(b.name, "zh-CN") ||
      a.key.localeCompare(b.key),
  );
}
export function threadStatus(item: NavigationThread) {
  if (!item.source.connected && item.running) return "状态待同步";
  if (
    !item.waiting &&
    item.source.tasks.some(
      (task) =>
        task.threadId === item.thread.id &&
        task.category === "失败或待核实" &&
        task.title.includes("待核实"),
    )
  )
    return "待核实";
  return (
    item.waiting || (item.failed ? "执行失败" : item.running ? "运行中" : "")
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
  return day === today ? "今天" : day === yesterday ? "昨天" : "更早";
}
export { navigationEnvironmentKey };
