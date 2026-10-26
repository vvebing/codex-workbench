import { t } from "../../lib/i18n";
import { Store, errorMessage } from "../../lib/store";
import { RpcError } from "../../lib/rpc";
import type { ConnectionStore } from "../connection/store";
import { SessionsStore, TurnBusyError } from "../sessions/store";
import type { RequestsStore } from "../requests/store";
import type { UserInput } from "../../generated/v2/UserInput";
import { emptyDraft, type Draft } from "./drafts";
import {
  asyncAnswerText,
  asyncAnswerClientId,
  pendingAsyncQuestions,
  type QuestionMessage,
} from "../conversation/async-questions";
import type { SendOptions } from "./submission";
import { QueueStorage } from "./queue-storage";
import { conversationExecuting } from "../conversation/activity";

export interface QueuedTask {
  id: string;
  draft: Draft;
  input: UserInput[];
  options: SendOptions;
  status: "queued" | "sending" | "uncertain";
  question?: { itemId: string; answers: string[]; expired?: boolean };
}
export interface TaskQueue {
  items: QueuedTask[];
  paused: string | null;
  editingId?: string;
  /** Confirmed answers remain visible until their user message arrives. */
  sentAnswers?: Record<string, string[]>;
  sentAnswerTasks?: Record<string, QueuedTask>;
}
interface QueueState {
  threads: Record<string, TaskQueue>;
  ready: boolean;
  error: string | null;
}
const emptyQueue = (): TaskQueue => ({ items: [], paused: null });
type Queues = QueueState["threads"];

/** A local outbox: only explicit question answers can steer automatically. Never replay an uncertain write. */
export class MessageQueueStore extends Store<QueueState> {
  private storage = new QueueStorage();
  private scope = "";
  private generation = 0;
  private operations: Promise<unknown> = Promise.resolve();
  private scheduled = false;
  private channel?: BroadcastChannel;
  private stopping = new Set<string>();
  private answerRetry?: ReturnType<typeof setTimeout>;
  private activatingAnswers = new Set<string>();
  private nextActivation = new Map<string, number>();

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
              queue.paused = t("已恢复待发送任务，请检查后继续队列。");
            for (const item of queue.items)
              if (item.status === "sending") item.status = "uncertain";
          }
        }).catch(() => {});
      } else if (epoch !== state.epoch) {
        void this.exclusive(async (queues) => {
          for (const queue of Object.values(queues)) {
            if (queue.items.length)
              queue.paused = t("连接已改变，请检查后继续队列。");
            for (const item of queue.items)
              if (item.status === "sending") item.status = "uncertain";
          }
        }).catch(() => {});
      }
      epoch = state.epoch;
      this.schedule();
    });
    sessions.subscribe(() => {
      this.schedule();
      const delivered = (id: string, task: QueuedTask) =>
        task.question &&
        sessions
          .getSnapshot()
          .threads[id]?.turns.some((turn) =>
            turn.items.some(
              (item) =>
                item.type === "userMessage" &&
                item.clientId ===
                  asyncAnswerClientId(task.question!.itemId, task.id),
            ),
          );
      if (
        Object.entries(this.state.threads).some(([id, queue]) =>
          queue.items.some((task) => delivered(id, task)),
        )
      )
        void this.exclusive(async (queues) => {
          for (const [id, queue] of Object.entries(queues)) {
            const remaining = queue.items.filter(
              (task) => !delivered(id, task),
            );
            if (remaining.length === queue.items.length) continue;
            queue.items = remaining;
            if (!queue.items.length) {
              queue.paused = null;
              this.stopping.delete(id);
            }
          }
        })
          .then(() => this.schedule())
          .catch(() => {});
    });
    requests.subscribe(() => this.schedule());
    connection.client.onNotification((event) => {
      if (
        event.method === "turn/completed" &&
        event.params.turn.status !== "completed"
      )
        void this.pause(
          event.params.threadId,
          t("当前任务已停止或失败，队列已暂停。"),
        ).catch(() => {});
      if (
        event.method === "thread/deleted" ||
        event.method === "thread/archived"
      )
        void this.pause(
          event.params.threadId,
          t("会话已归档或删除，队列已暂停。"),
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
        throw new Error(t("工作环境已改变，操作未执行。"));
      for (const [id, queue] of Object.entries(queues)) {
        const thread = this.sessions.getSnapshot().threads[id];
        if (!thread || !queue.sentAnswers) continue;
        const pending = new Set(
          pendingAsyncQuestions(thread).map((item) => item.id),
        );
        for (const itemId of Object.keys(queue.sentAnswers))
          if (
            !pending.has(itemId) &&
            thread.turns.some((turn) =>
              turn.items.some((item) => item.id === itemId),
            )
          ) {
            delete queue.sentAnswers[itemId];
            if (queue.sentAnswerTasks) delete queue.sentAnswerTasks[itemId];
          }
      }
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
      throw new Error(t("此会话由其他客户端控制，消息未发送，草稿已保留。"));
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
        throw new Error(t("最多排队 100 条任务，请先处理已有任务。"));
      queue.items.push(snapshot);
    });
    this.schedule();
  }

  async addAnswer(
    id: string,
    item: QuestionMessage,
    answers: string[],
  ): Promise<void> {
    id = this.sessions.resolveId(id);
    const assertAnswerable = () => {
      if (this.sessions.getSnapshot().archivedIds[id])
        throw new Error(t("此会话已归档，请先恢复会话再回答问题。"));
    };
    assertAnswerable();
    if (
      !item.questions?.length ||
      item.questions.length !== answers.length ||
      answers.some((answer) => !answer.trim())
    )
      throw new Error(t("请填写所有问题的回答。"));
    const thread = this.sessions.getSnapshot().threads[id];
    if (
      !thread ||
      !pendingAsyncQuestions(thread).some((question) => question.id === item.id)
    )
      throw new Error(t("此问题已有后续回复，请在会话中继续补充。"));
    const text = asyncAnswerText(item, answers);
    await this.exclusive(async (queues) => {
      // The page can archive the thread while this operation waits for storage or another tab.
      assertAnswerable();
      const queue = (queues[id] ??= emptyQueue());
      if (
        queue.sentAnswers?.[item.id] ||
        queue.items.some((task) => task.question?.itemId === item.id)
      )
        return;
      if (queue.items.length >= 100)
        throw new Error(t("最多排队 100 条任务，请先处理已有任务。"));
      const task: QueuedTask = {
        id: crypto.randomUUID(),
        draft: { ...emptyDraft(), text },
        input: [{ type: "text", text, text_elements: [] }],
        options: {},
        status: "queued",
        question: { itemId: item.id, answers: [...answers] },
      };
      const firstTask = queue.items.findIndex((queued) => !queued.question);
      if (
        firstTask >= 0 &&
        !queue.editingId &&
        queue.items.every((queued) => queued.status === "queued")
      )
        queue.items.splice(firstTask, 0, task);
      else queue.items.push(task);
    });
    this.schedule();
  }

  pause(id: string, reason = t("队列已暂停。")): Promise<void> {
    // Prevent dispatch before the storage transaction can take the lock.
    this.stopping.add(id);
    return this.exclusive(async (queues) => {
      if (queues[id]?.items.length) queues[id].paused = reason;
      else this.stopping.delete(id);
    });
  }

  async resume(id: string): Promise<void> {
    if (this.connection.getSnapshot().status !== "connected")
      throw new Error(t("请先连接工作环境。"));
    await this.sessions.activate(id);
    if (this.sessions.getSnapshot().threadAccess[id] !== "editable")
      throw new Error(t("此会话由其他客户端控制，无法继续队列。"));
    await this.exclusive(async (queues) => {
      const queue = queues[id];
      if (!queue) return;
      if (queue.items.some((item) => item.status === "uncertain"))
        throw new Error(
          t("请先核实待确认消息；已发送则删除，确认未发送再选择重试。"),
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
        throw new Error(t("任务正在发送，暂时不能删除。"));
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
        throw new Error(t("请等待发送完成或先核实待确认消息。"));
      queue.items = [task, ...queue.items.filter((item) => item.id !== taskId)];
    });
    this.schedule();
  }

  beginEdit(id: string, taskId: string): Promise<void> {
    return this.exclusive(async (queues) => {
      const queue = queues[id];
      const task = queue?.items.find((item) => item.id === taskId);
      if (!task || task.status !== "queued")
        throw new Error(t("任务已开始发送，不能编辑。"));
      if (task.question) throw new Error(t("请先取消待发送回答，再重新填写。"));
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
        if (!input.length) throw new Error(t("任务内容不能为空。"));
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

  private available(id: string, answer = false): boolean {
    const thread = this.sessions.getSnapshot().threads[id];
    const last = thread?.turns.at(-1);
    return (
      this.connection.getSnapshot().status === "connected" &&
      this.sessions.getSnapshot().threadAccess[id] === "editable" &&
      (answer ||
        (!this.sessions.activeTurn(id) &&
          (!conversationExecuting(thread) || last?.status === "completed"))) &&
      !this.requests.forThread(id).length &&
      !this.stopping.has(id)
    );
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      let retry = false;
      for (const [id, queue] of Object.entries(this.state.threads)) {
        const task = queue.items[0];
        if (task?.status !== "queued" || queue.paused || queue.editingId)
          continue;
        const answer = !!task.question;
        if (this.available(id, answer)) {
          void this.deliver(
            id,
            task.id,
            answer ? this.sessions.activeTurn(id)?.id : undefined,
          ).catch(() => {});
        } else if (
          answer &&
          this.connection.getSnapshot().status === "connected" &&
          this.sessions.getSnapshot().threads[id] &&
          this.sessions.getSnapshot().threadAccess[id] !== "editable" &&
          !this.requests.forThread(id).length
        ) {
          retry = true;
          if (
            !this.activatingAnswers.has(id) &&
            Date.now() >= (this.nextActivation.get(id) ?? 0)
          ) {
            this.activatingAnswers.add(id);
            this.nextActivation.set(id, Date.now() + 3000);
            void this.sessions
              .activate(id)
              .catch(() => {})
              .finally(() => {
                this.activatingAnswers.delete(id);
                this.schedule();
              });
          }
        }
      }
      if (retry && !this.answerRetry) {
        this.answerRetry = setTimeout(() => {
          this.answerRetry = undefined;
          this.schedule();
        }, 3000);
        this.answerRetry.unref?.();
      }
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
      if (task.question) {
        const thread = this.sessions.getSnapshot().threads[id];
        if (!thread) return;
        if (
          !pendingAsyncQuestions(thread).some(
            (item) => item.id === task.question!.itemId,
          )
        ) {
          task.question.expired = true;
          queue.paused = t(
            "问题已结束，本次回答未发送。内容已保留，可复制后继续补充。",
          );
          return;
        }
        if (!this.available(id, true)) return;
      }
      if (expectedTurnId) {
        if (this.requests.forThread(id).length)
          throw new Error(t("请先处理当前确认请求。"));
        // Never redirect a different turn if the original one completed while waiting.
        if (this.sessions.activeTurn(id)?.id !== expectedTurnId) return;
      } else if (
        queue.paused ||
        queue.items[0] !== task ||
        !this.available(id, !!task.question)
      )
        return;
      const epoch = this.connection.getSnapshot().epoch;
      task.status = "sending";
      await publish();
      try {
        if (this.connection.getSnapshot().epoch !== epoch)
          throw new Error(t("连接已改变，消息未发送；请核实队列状态。"));
        if (this.requests.forThread(id).length) {
          task.status = "queued";
          return;
        }
        const clientUserMessageId = task.question
          ? asyncAnswerClientId(task.question.itemId, task.id)
          : undefined;
        if (expectedTurnId)
          await this.sessions.steer(
            id,
            task.input,
            expectedTurnId,
            clientUserMessageId,
          );
        else
          await this.sessions.send(
            id,
            task.input,
            {
              ...task.options,
              ...(clientUserMessageId ? { clientUserMessageId } : {}),
            },
            undefined,
            "start",
          );
        if (this.connection.getSnapshot().epoch !== epoch)
          throw new Error(t("连接已改变，请核实消息是否已发送。"));
        if (task.question) {
          (queue.sentAnswerTasks ??= {})[task.question.itemId] =
            structuredClone(task);
          (queue.sentAnswers ??= {})[task.question.itemId] = [
            ...task.question.answers,
          ];
        }
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
        queue.paused = t("{{value0}} 队列已暂停。", {
          value0: errorMessage(error),
        });
      }
    });
    this.schedule();
  }
}
