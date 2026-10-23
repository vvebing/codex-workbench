import type { Thread } from "../../generated/v2/Thread";
import type { RpcRequest } from "../../lib/rpc";
import { conversationExecuting } from "../conversation/activity";
import { requestThreadId } from "../requests/store";
import { titleOf } from "../../components/hooks";

export function browserTitle({
  thread,
  draft = false,
  connected,
  environmentName,
  pendingRequests,
}: {
  thread?: Thread;
  draft?: boolean;
  connected: boolean;
  environmentName?: string;
  pendingRequests: RpcRequest[];
}): string {
  const brand = "Codex 工作台";
  if (!thread || draft) return brand;
  // Use the same task title as the sidebar for unnamed sessions.
  const name = titleOf(thread).replace(/\s+/g, " ").trim() || "新会话";
  const waiting =
    pendingRequests.some((request) => requestThreadId(request) === thread.id) ||
    (thread.status.type === "active" && thread.status.activeFlags.length > 0);
  const status = !connected
    ? undefined
    : waiting
      ? "待确认"
      : conversationExecuting(thread)
        ? "执行中"
        : undefined;
  return [status, name, environmentName?.trim(), brand]
    .filter(Boolean)
    .join(" · ");
}
