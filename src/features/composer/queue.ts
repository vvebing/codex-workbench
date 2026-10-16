import { Store, errorMessage } from "../../lib/store";
import { RpcError } from "../../lib/rpc";
import type { ConnectionStore } from "../connection/store";
import { SessionsStore, TurnBusyError } from "../sessions/store";
import type { RequestsStore } from "../requests/store";
import type { UserInput } from "../../generated/v2/UserInput";
import type { Draft } from "./drafts";
import type { SendOptions } from "./submission";
import { QueueStorage } from "./queue-storage";
import { conversationExecuting } from "../conversation/activity";

export interface QueuedTask {
  id: string;
  draft: Draft;
  input: UserInput[];
  options: SendOptions;
  status: "queued" | "sending" | "uncertain";
}
export interface TaskQueue {
  items: QueuedTask[];
  paused: string | null;
  editingId?: string;
}
interface QueueState {
  threads: Record<string, TaskQueue>;
  ready: boolean;
  error: string | null;
}
const emptyQueue = (): TaskQueue => ({ items: [], paused: null });
type Queues = QueueState["threads"];

/** A local outbox: never steer implicitly, and never replay an uncertain write. */
export class MessageQueueStore extends Store<QueueState> {
  private storage = new QueueStorage();
  private scope = "";
  private generation = 0;
  private operations: Promise<unknown> = Promise.resolve();
  private scheduled = false;
  private channel?: BroadcastChannel;
  private stopping = new Set<string>();

  constructor(
    private connection: ConnectionStore,
    private sessions: SessionsStore,
    private requests: RequestsStore,
    environmentId?: string,
  ) {
    super({ threads: {}, ready: true, error: null });
    let epoch = connection.getSnapshot().epoch;
    connection.subscribe(() => {
      const state = connection.getSnapshot();
      const scope = `${environmentId ?? state.url}|${state.url}`;
      if (scope !== this.scope) {
        this.scope = scope;
        this.generation++;
        this.stopping.clear();
        this.update({ threads: {}, ready: false, error: null });
        this.channel?.close();
        if (
          typeof window !== "undefined" &&
          typeof BroadcastChannel !== "undefined"
        ) {
          this.channel = new BroadcastChannel(`codex-queue:${scope}`);
          this.channel.onmessage = () => {
            void this.exclusive(async () => {}, false).catch(() => {});
          };
        }
        void this.exclusive(async (queues) => {
          for (const queue of Object.values(queues)) {
            delete queue.editingId;
            if (queue.items.length)
              queue.paused = "已恢复待发送任务，请检查后继续队列。";
            for (const item of queue.items)
              if (item.status === "sending") item.status = "uncertain";
          }
        }).catch(() => {});
      } else if (epoch !== state.epoch) {
        void this.exclusive(async (queues) => {
          for (const queue of Object.values(queues)) {
            if (queue.items.length)
              queue.paused = "连接已改变，请检查后继续队列。";
            for (const item of queue.items)
              if (item.status === "sending") item.status = "uncertain";
          }
        }).catch(() => {});
      }
      epoch = state.epoch;
      this.schedule();
    });
    sessions.subscribe(() => this.schedule());
    requests.subscribe(() => this.schedule());
    connection.client.onNotification((event) => {
      if (
        event.method === "turn/completed" &&
        event.params.turn.status !== "completed"
      )
        void this.pause(
          event.params.threadId,
          "当前任务已停止或失败，队列已暂停。",
        ).catch(() => {});
      if (
        event.method === "thread/deleted" ||
        event.method === "thread/archived"
      )
        void this.pause(
          event.params.threadId,
          "会话已归档或删除，队列已暂停。",
        ).catch(() => {});
    });
  }

  forThread(id: string): TaskQueue {
    return this.state.threads[this.sessions.resolveId(id)] ?? emptyQueue();
  }

  /** Serialize storage and RPC across tabs, re-reading the authoritative outbox. */
  private exclusive<T>(
    work: (queues: Queues, publish: () => Promise<void>) => Promise<T>,
    write = true,
  ): Promise<T> {
    const scope = this.scope;
    const generation = this.generation;
    const run = async () => {
      const queues = await this.storage.read(scope);
      const publish = async () => {
        await this.storage.write(scope, queues);
        if (generation === this.generation) {
          this.update({ threads: { ...queues }, ready: true, error: null });
          this.channel?.postMessage("changed");
        }
      };
      if (generation !== this.generation)
        throw new Error("工作环境已改变，操作未执行。");
      const result = await work(queues, publish);
      if (write) await publish();
      else if (generation === this.generation)
        this.update({ threads: { ...queues }, ready: true, error: null });
      return result;
    };
    const pending = this.operations
      .catch(() => {})
      .then(async (): Promise<T> => {
        if (typeof navigator !== "undefined" && navigator.locks)
          return await navigator.locks.request(`codex-queue:${scope}`, run);
        return run();
      });
    this.operations = pending;
    return pending.catch((error: unknown) => {
      if (generation === this.generation)
        this.update({ ...this.state, ready: true, error: errorMessage(error) });
      throw error;
    });
  }

  async add(
    id: string,
    draft: Draft,
    input: UserInput[],
    options: SendOptions,
  ): Promise<void> {
    id = this.sessions.resolveId(id);
    if (this.sessions.getSnapshot().threadAccess[id] !== "editable")
      await this.sessions.activate(id);
    if (this.sessions.getSnapshot().threadAccess[id] !== "editable")
      throw new Error("此会话由其他客户端控制，消息未发送，草稿已保留。");
    const snapshot = structuredClone({
      id: crypto.randomUUID(),
      draft,
      input,
      options,
      status: "queued" as const,
    });
    await this.exclusive(async (queues) => {
      const queue = (queues[id] ??= emptyQueue());
      if (queue.items.length >= 100)
        throw new Error("最多排队 100 条任务，请先处理已有任务。");
      queue.items.push(snapshot);
    });
    this.schedule();
  }

  pause(id: string, reason = "队列已暂停。"): Promise<void> {
    // Prevent dispatch before the storage transaction can take the lock.
    this.stopping.add(id);
    return this.exclusive(async (queues) => {
      if (queues[id]?.items.length) queues[id].paused = reason;
      else this.stopping.delete(id);
    });
  }

  async resume(id: string): Promise<void> {
    if (this.connection.getSnapshot().status !== "connected")
      throw new Error("请先连接工作环境。");
    await this.sessions.activate(id);
    if (this.sessions.getSnapshot().threadAccess[id] !== "editable")
      throw new Error("此会话由其他客户端控制，无法继续队列。");
    await this.exclusive(async (queues) => {
      const queue = queues[id];
      if (!queue) return;
      if (queue.items.some((item) => item.status === "uncertain"))
        throw new Error(
          "请先核实待确认消息；已发送则删除，确认未发送再选择重试。",
        );
      queue.paused = null;
    });
    this.stopping.delete(id);
    this.schedule();
  }

  async remove(id: string, taskId: string): Promise<void> {
    await this.exclusive(async (queues) => {
      const queue = queues[id];
      if (!queue) return;
      if (queue.items.find((item) => item.id === taskId)?.status === "sending")
        throw new Error("任务正在发送，暂时不能删除。");
      queue.items = queue.items.filter((item) => item.id !== taskId);
      if (queue.editingId === taskId) delete queue.editingId;
      if (!queue.items.length) {
        queue.paused = null;
        this.stopping.delete(id);
      }
    });
    this.schedule();
  }

  async moveFirst(id: string, taskId: string): Promise<void> {
    await this.exclusive(async (queues) => {
      const queue = queues[id];
      const task = queue?.items.find((item) => item.id === taskId);
      if (!queue || !task) return;
      if (queue.items.some((item) => item.status !== "queued"))
        throw new Error("请等待发送完成或先核实待确认消息。");
      queue.items = [task, ...queue.items.filter((item) => item.id !== taskId)];
    });
    this.schedule();
  }

  beginEdit(id: string, taskId: string): Promise<void> {
    return this.exclusive(async (queues) => {
      const queue = queues[id];
      const task = queue?.items.find((item) => item.id === taskId);
      if (!task || task.status !== "queued")
        throw new Error("任务已开始发送，不能编辑。");
      queue.editingId = taskId;
    });
  }

  async finishEdit(
    id: string,
    taskId: string,
    draft?: Draft,
    input?: UserInput[],
  ): Promise<void> {
    await this.exclusive(async (queues) => {
      const queue = queues[id];
      if (!queue || queue.editingId !== taskId) return;
      const task = queue.items.find((item) => item.id === taskId);
      if (task && draft && input) {
        if (!input.length) throw new Error("任务内容不能为空。");
        task.draft = structuredClone(draft);
        task.input = structuredClone(input);
      }
      delete queue.editingId;
    });
    this.schedule();
  }

  async retry(id: string, taskId: string): Promise<void> {
    await this.exclusive(async (queues) => {
      const task = queues[id]?.items.find((item) => item.id === taskId);
      if (task?.status === "uncertain") task.status = "queued";
    });
  }

  async steer(id: string, taskId: string): Promise<void> {
    const expected = this.sessions.activeTurn(id)?.id;
    if (!expected) {
      this.schedule();
      return;
    }
    await this.deliver(id, taskId, expected);
    this.schedule();
  }

  private available(id: string): boolean {
    const thread = this.sessions.getSnapshot().threads[id];
    const last = thread?.turns.at(-1);
    return (
      this.connection.getSnapshot().status === "connected" &&
      this.sessions.getSnapshot().threadAccess[id] === "editable" &&
      !this.sessions.activeTurn(id) &&
      (!conversationExecuting(thread) || last?.status === "completed") &&
      !this.requests.forThread(id).length &&
      !this.stopping.has(id)
    );
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      for (const [id, queue] of Object.entries(this.state.threads))
        if (
          queue.items[0]?.status === "queued" &&
          !queue.paused &&
          !queue.editingId &&
          this.available(id)
        )
          void this.deliver(id, queue.items[0].id).catch(() => {});
    });
  }

  private async deliver(
    id: string,
    taskId: string,
    expectedTurnId?: string,
  ): Promise<void> {
    await this.exclusive(async (queues, publish) => {
      const queue = queues[id];
      const task = queue?.items.find((item) => item.id === taskId);
      if (!queue || !task || task.status !== "queued" || queue.editingId)
        return;
      if (expectedTurnId) {
        if (this.requests.forThread(id).length)
          throw new Error("请先处理当前确认请求。");
        // Never redirect a different turn if the original one completed while waiting.
        if (this.sessions.activeTurn(id)?.id !== expectedTurnId) return;
      } else if (queue.paused || queue.items[0] !== task || !this.available(id))
        return;
      const epoch = this.connection.getSnapshot().epoch;
      task.status = "sending";
      await publish();
      try {
        if (this.connection.getSnapshot().epoch !== epoch)
          throw new Error("连接已改变，消息未发送；请核实队列状态。");
        if (this.requests.forThread(id).length) {
          task.status = "queued";
          return;
        }
        if (expectedTurnId)
          await this.sessions.steer(id, task.input, expectedTurnId);
        else
          await this.sessions.send(
            id,
            task.input,
            task.options,
            undefined,
            "start",
          );
        if (this.connection.getSnapshot().epoch !== epoch)
          throw new Error("连接已改变，请核实消息是否已发送。");
        queue.items = queue.items.filter((item) => item !== task);
      } catch (error) {
        if (
          error instanceof TurnBusyError ||
          (expectedTurnId &&
            error instanceof RpcError &&
            this.sessions.activeTurn(id)?.id !== expectedTurnId)
        ) {
          task.status = "queued";
          return;
        }
        // Only a definite server rejection is safe to retry. Timeouts/disconnects
        // can happen after acceptance and require explicit user reconciliation.
        task.status = error instanceof RpcError ? "queued" : "uncertain";
        queue.paused = `${errorMessage(error)} 队列已暂停。`;
      }
    });
    this.schedule();
  }
}
