import type { RpcRequest } from "../../lib/rpc";
import type { Environment } from "../connection/environments";
import { pendingAsyncQuestions } from "../conversation/async-questions";
import { requestThreadId } from "../requests/store";

export function requestNoticeTitle(request: RpcRequest): string {
  switch (request.method) {
    case "item/tool/requestUserInput":
      return "需要你回答问题";
    case "item/fileChange/requestApproval":
      return "文件修改待审批";
    case "item/commandExecution/requestApproval":
      return "命令执行待审批";
    case "item/permissions/requestApproval":
      return "权限申请待审批";
    case "mcpServer/elicitation/request":
      return request.params.mode === "url"
        ? "MCP 授权待处理"
        : "MCP 表单待填写";
    default:
      return "请求待处理";
  }
}
export type TaskCategory =
  "待审批" | "待回答" | "失败或待核实" | "暂停队列" | "待查看结果";
export interface TaskEntry {
  id: string;
  threadId?: string;
  category: TaskCategory;
  title: string;
  detail?: string;
}

/** Derived view only: all lifecycle decisions remain in the existing stores. */
export function environmentTasks(runtime: Environment["runtime"]): TaskEntry[] {
  const sessions = runtime.sessions.getSnapshot();
  const requests = runtime.requests.getSnapshot();
  const queues = runtime.queue.getSnapshot().threads;
  const dismissed = runtime.questionDismissals.getSnapshot();
  const entries = new Map<string, TaskEntry>();
  const add = (entry: TaskEntry) => entries.set(entry.id, entry);
  for (const request of requests.pending)
    add({
      id: `request:${JSON.stringify(request.id)}`,
      threadId: requestThreadId(request),
      category:
        request.method === "item/tool/requestUserInput" ||
        request.method === "mcpServer/elicitation/request"
          ? "待回答"
          : "待审批",
      title: requestNoticeTitle(request),
    });
  for (const thread of Object.values(sessions.threads)) {
    if (sessions.archivedIds[thread.id]) continue;
    for (const question of pendingAsyncQuestions(thread)) {
      if (
        dismissed[JSON.stringify([thread.id, question.id])] ||
        queues[thread.id]?.sentAnswers?.[question.id] ||
        queues[thread.id]?.items.some(
          (task) => task.question?.itemId === question.id,
        ) ||
        requests.pending.some(
          (request) =>
            requestThreadId(request) === thread.id &&
            "itemId" in request.params &&
            request.params.itemId === question.id,
        )
      )
        continue;
      add({
        id: `question:${JSON.stringify([thread.id, question.id])}`,
        threadId: thread.id,
        category: "待回答",
        title: "需要你回答问题",
        detail: question.questions
          ?.map((question) => question.title)
          .join(" · "),
      });
    }
    const turn = thread.turns.at(-1);
    if (thread.status.type === "systemError" || turn?.status === "failed")
      add({
        id: `failed:${thread.id}`,
        threadId: thread.id,
        category: "失败或待核实",
        title: "会话执行失败",
        detail: turn?.error?.message,
      });
  }
  for (const [threadId, turnId] of Object.entries(sessions.unreadCompleted)) {
    const turn = sessions.threads[threadId]?.turns.find(
      (turn) => turn.id === turnId,
    );
    if (turn && turn.status !== "completed") continue;
    add({
      id: `completed:${threadId}`,
      threadId,
      category: "待查看结果",
      title: "会话结果待查看",
    });
  }
  for (const message of runtime.submissions.messages.getSnapshot()) {
    if (message.status === "failed" || message.status === "uncertain")
      add({
        id: `message:${message.id}`,
        threadId: message.threadId,
        category: "失败或待核实",
        title:
          message.status === "uncertain"
            ? "消息发送结果待核实"
            : "消息发送失败",
        detail: message.error,
      });
  }
  for (const answer of requests.submittedAnswers)
    if (answer.status === "uncertain")
      add({
        id: `answer:${answer.epoch}:${JSON.stringify(answer.id)}`,
        threadId: answer.threadId,
        category: "失败或待核实",
        title: "问题回答发送结果待核实",
      });
  for (const [threadId, queue] of Object.entries(queues)) {
    const uncertain = queue.items.filter((item) => item.status === "uncertain");
    if (uncertain.length)
      add({
        id: `queue:${threadId}`,
        threadId,
        category: "失败或待核实",
        title: `${uncertain.length} 条排队消息发送结果待核实`,
        detail: queue.paused || "核对会话记录后再处理队列。",
      });
    else if (queue.items.length && queue.paused)
      add({
        id: `queue:${threadId}`,
        threadId,
        category: "暂停队列",
        title: `队列已暂停 · ${queue.items.length} 条`,
        detail: queue.paused,
      });
  }
  return [...entries.values()];
}

export interface EnvironmentTaskSummary {
  state: "offline" | "syncing" | "partial" | "ready";
  count: number;
  label: string;
  description: string;
}

/** A zero is definitive only after the connected environment finishes discovery. */
export function environmentTaskSummary(
  runtime: Environment["runtime"],
  entries = environmentTasks(runtime),
): EnvironmentTaskSummary {
  const connection = runtime.connection.getSnapshot();
  const sessions = runtime.sessions.getSnapshot();
  const count = entries.length;
  if (connection.status !== "connected")
    return {
      state: "offline",
      count,
      label: count ? `${count} 项已知待办 · 待同步` : "待办状态待同步",
      description: "环境未连接。连接后同步最新状态；已缓存的待办可先查看。",
    };
  if (sessions.historyLoading || sessions.loading)
    return {
      state: "syncing",
      count,
      label: count ? `同步中 · ${count} 项已知待办` : "正在同步待办",
      description: "正在同步会话。下方先显示当前已知待办，数量可能继续变化。",
    };
  if (!sessions.historyComplete || sessions.historyError)
    return {
      state: "partial",
      count,
      label: count ? `${count} 项已知待办` : "待办状态未完整同步",
      description: sessions.historyError
        ? `同步未完成：${sessions.historyError}`
        : "会话尚未完整同步，当前数量仅包括已加载状态。",
    };
  return {
    state: "ready",
    count,
    label: `${count} 项`,
    description: count
      ? "按需要你处理的事项分类，点击前往来源会话。"
      : "当前没有需要处理的待办。",
  };
}
export const taskCategoryDescriptions: Record<TaskCategory, string> = {
  待审批: "检查请求后允许或拒绝执行。",
  待回答: "回答问题或完成授权，让会话继续。",
  失败或待核实: "先核对来源会话记录，再决定重试或恢复。",
  暂停队列: "检查暂停原因，确认后恢复发送。",
  待查看结果: "查看已完成的会话结果。",
};
