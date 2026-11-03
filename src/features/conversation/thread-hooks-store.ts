import type { HooksListResponse } from "../../generated/v2/HooksListResponse";
import type { HookRunSummary } from "../../generated/v2/HookRunSummary";
import type { HookEventName } from "../../generated/v2/HookEventName";
import type { ConnectionStore } from "../connection/store";
import { t } from "../../lib/i18n";
import { Store, errorMessage } from "../../lib/store";

export function hookEventLabel(event: HookEventName): string {
  const labels: Record<HookEventName, string> = {
    preModelRequest: t("模型请求前"),
    postModelRequest: t("模型请求后"),
    preToolUse: t("工具调用前"),
    permissionRequest: t("权限申请"),
    postToolUse: t("工具调用后"),
    preCompact: t("上下文压缩前"),
    postCompact: t("上下文压缩后"),
    sessionStart: t("会话开始"),
    sessionEnd: t("会话结束"),
    userPromptSubmit: t("用户提交消息"),
    subagentStart: t("子代理开始"),
    subagentStop: t("子代理停止"),
    stop: t("执行停止"),
    interrupt: t("执行中断"),
  };
  return labels[event] ?? event;
}

interface State {
  data: HooksListResponse | null;
  loading: boolean;
  error: string | null;
  runs: HookRunSummary[];
}

export class ThreadHooksStore extends Store<State> {
  private active = false;
  private generation = 0;

  constructor(
    readonly threadId: string,
    private epoch: number,
    private connection: ConnectionStore,
  ) {
    super({ data: null, loading: false, error: null, runs: [] });
  }

  private current(generation = this.generation): boolean {
    const state = this.connection.getSnapshot();
    return (
      this.active &&
      generation === this.generation &&
      state.epoch === this.epoch &&
      state.status === "connected"
    );
  }

  start(): () => void {
    this.active = true;
    const off = this.connection.client.onNotification((event) => {
      if (
        !this.current() ||
        !["hook/started", "hook/completed"].includes(event.method) ||
        !("threadId" in event.params) ||
        event.params.threadId !== this.threadId ||
        !("run" in event.params)
      )
        return;
      const run = event.params.run as HookRunSummary;
      const previous = this.state.runs.find((entry) => entry.id === run.id);
      if (previous && previous.status !== "running" && run.status === "running")
        return;
      this.update({
        ...this.state,
        runs: [
          run,
          ...this.state.runs.filter((entry) => entry.id !== run.id),
        ].slice(0, 20),
      });
    });
    return () => {
      this.active = false;
      this.generation++;
      off();
      this.update({ ...this.state, loading: false });
    };
  }

  async load(): Promise<void> {
    if (!this.current() || this.state.loading) return;
    const generation = this.generation;
    this.update({ ...this.state, loading: true, error: null });
    try {
      const data = await this.connection.client.request<HooksListResponse>(
        "hooks/list",
        { threadId: this.threadId },
      );
      if (this.current(generation))
        this.update({ ...this.state, data, loading: false });
    } catch (error) {
      if (this.current(generation))
        this.update({
          ...this.state,
          loading: false,
          error:
            (error as { code?: number })?.code === -32601
              ? t("当前服务端不支持查看会话 Hooks。")
              : errorMessage(error),
        });
    }
  }
}
