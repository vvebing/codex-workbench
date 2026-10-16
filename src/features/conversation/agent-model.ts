import type { ThreadItem } from "../../generated/v2/ThreadItem";
import type { Thread } from "../../generated/v2/Thread";
import type { CollabAgentStatus } from "../../generated/v2/CollabAgentStatus";
import { commandTitle } from "./operation";

export interface AgentTaskModel {
  id: string;
  prompt: string | null;
  status: CollabAgentStatus | "unknown";
  message: string | null;
  model?: string;
  role?: string;
  nickname?: string;
}

export function directAgentTasks(
  thread: Thread,
  knownThreads: Readonly<Record<string, Thread>> = {},
): AgentTaskModel[] {
  const tasks = new Map<string, AgentTaskModel>();
  const ensure = (id: string) => {
    if (id === thread.id) return undefined;
    const known = knownThreads[id];
    if (known?.parentThreadId && known.parentThreadId !== thread.id)
      return undefined;
    let task = tasks.get(id);
    if (!task) {
      task = { id, prompt: null, status: "unknown", message: null };
      tasks.set(id, task);
    }
    if (known?.model) task.model = known.model;
    if (known?.agentRole) task.role = known.agentRole;
    if (known?.agentNickname) task.nickname = known.agentNickname;
    return task;
  };
  // Later copies of an item are authoritative after history merges.
  const items = new Map<string, ThreadItem>();
  for (const item of thread.turns.flatMap((turn) => turn.items)) {
    items.delete(item.id);
    items.set(item.id, item);
  }
  for (const item of items.values()) {
    if (item.type === "collabAgentToolCall") {
      if (item.senderThreadId !== thread.id) continue;
      for (const id of new Set([
        ...item.receiverThreadIds,
        ...Object.keys(item.agentsStates),
      ])) {
        const task = ensure(id);
        if (!task) continue;
        if (
          item.prompt &&
          ["spawnAgent", "followupTask", "sendInput"].includes(item.tool)
        )
          task.prompt = item.prompt;
        if (item.model) task.model = item.model;
        const state = item.agentsStates[id];
        if (state) {
          task.status = state.status;
          task.message = state.message;
        }
      }
    } else if (item.type === "subAgentActivity") {
      const task = ensure(item.agentThreadId);
      if (!task) continue;
      if (item.model) task.model = item.model;
      if (item.kind === "started") task.status = "running";
      if (item.kind === "completed") task.status = "completed";
      if (item.kind === "interrupted") task.status = "interrupted";
    }
  }
  for (const known of Object.values(knownThreads)) {
    if (known.parentThreadId === thread.id) {
      const task = ensure(known.id);
      if (task && !task.prompt) task.prompt = known.preview || null;
    }
  }
  for (const task of tasks.values()) {
    task.status = resolveAgentStatus(
      task.status,
      knownThreads[task.id],
    ) as AgentTaskModel["status"];
  }
  return [...tasks.values()];
}

export type AgentDisplayStatus = AgentTaskModel["status"] | "waiting";

/** One resolver for entry counts and rows; absent thread data is not completion. */
export function resolveAgentStatus(
  fallback: AgentTaskModel["status"],
  thread?: Thread,
  waiting = false,
): AgentDisplayStatus {
  if (waiting) return "waiting";
  if (thread?.status.type === "systemError") return "errored";
  const turn = thread?.turns.at(-1);
  if (thread?.status.type === "active" || turn?.status === "inProgress")
    return "running";
  if (turn?.status === "failed") return "errored";
  if (turn?.status === "completed") return "completed";
  if (turn?.status === "interrupted") return "interrupted";
  return fallback;
}

export function agentStatusCounts(
  agents: AgentTaskModel[],
  knownThreads: Readonly<Record<string, Thread>>,
  waitingIds: ReadonlySet<string>,
) {
  const counts = {
    running: 0,
    completed: 0,
    waiting: 0,
    failed: 0,
    interrupted: 0,
    preparing: 0,
    unknown: 0,
  };
  for (const agent of agents) {
    const status = resolveAgentStatus(
      agent.status,
      knownThreads[agent.id],
      waitingIds.has(agent.id),
    );
    if (status === "running") counts.running++;
    else if (status === "completed") counts.completed++;
    else if (status === "waiting") counts.waiting++;
    else if (status === "errored" || status === "notFound") counts.failed++;
    else if (status === "interrupted" || status === "shutdown")
      counts.interrupted++;
    else if (status === "pendingInit") counts.preparing++;
    else counts.unknown++;
  }
  return counts;
}

export function latestAgentActivity(thread: Thread): string {
  const items = thread.turns.flatMap((turn) => turn.items);
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    switch (item.type) {
      case "commandExecution":
        return commandTitle(item);
      case "fileChange":
        return `修改 ${item.changes.map((change) => change.path).join("、") || "文件"}`;
      case "mcpToolCall":
        return `调用 ${item.server}.${item.tool}`;
      case "dynamicToolCall":
        return `调用 ${item.namespace ? `${item.namespace}.` : ""}${item.tool}`;
      case "webSearch":
        return `搜索 ${item.query}`;
      case "agentMessage":
        if (item.text.trim()) return item.text;
        break;
      case "plan":
        if (item.text.trim()) return item.text;
        break;
    }
  }
  return "暂无活动记录";
}
