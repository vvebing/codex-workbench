import type { TaskQueue } from "./queue";
import { asyncAnswerClientId } from "../conversation/async-questions";
import type { Thread } from "../../generated/v2/Thread";
import type { Turn } from "../../generated/v2/Turn";
import type { ThreadItem } from "../../generated/v2/ThreadItem";
import type { Draft } from "./drafts";
import { Store } from "../../lib/store";
import type { UserInput } from "../../generated/v2/UserInput";
import type { SessionsStore } from "../sessions/store";

export interface LocalMessage {
  id: string;
  threadId: string;
  turnId?: string;
  startsTurn?: boolean;
  baselineTurns?: Set<string>;
  input: UserInput[];
  draft?: Draft;
  status:
    "creating" | "queued" | "sending" | "accepted" | "failed" | "uncertain";
  error?: string;
  questionTaskId?: string;
  questionItemId?: string;
  baseline: Set<string>;
}
function signature(input: UserInput[]): string {
  return JSON.stringify(
    input.map((part) => {
      if (part.type === "text") return { type: part.type, text: part.text };
      if (part.type === "image")
        return {
          type: part.type,
          ...("url" in part ? { url: part.url } : { fileId: part.fileId }),
        };
      return part;
    }),
  );
}
/** Local delivery records never participate in automatic queue delivery. */
export class LocalMessagesStore extends Store<LocalMessage[]> {
  private matched = new Set<string>();
  private identities = new Map<string, string>();
  private identityThreads = new Map<string, Set<string>>();
  /** Draft promotion changes routing IDs, while the conversation remains the same. */
  threadIdentity(id: string): string {
    const state = this.sessions.getSnapshot();
    return (
      state.draftOrigins?.[id] ??
      Object.entries(state.localDrafts).find(
        ([, draft]) => draft.serverId === id,
      )?.[0] ??
      id
    );
  }
  private remember(threadId: string, id: string, identity: string) {
    const ids = this.identityThreads.get(threadId) ?? new Set<string>();
    this.identityThreads.delete(threadId);
    ids.add(id);
    this.identityThreads.set(threadId, ids);
    this.identities.set(id, identity);
    while (this.identityThreads.size > 100) {
      const oldest = this.identityThreads.keys().next().value!;
      for (const itemId of this.identityThreads.get(oldest)!) {
        this.identities.delete(itemId);
        this.matched.delete(`${oldest}:${itemId}`);
      }
      this.identityThreads.delete(oldest);
    }
  }
  private presentationItems = new WeakMap<
    object,
    import("../../generated/v2/ThreadItem").ThreadItem
  >();
  presentationItem(item: import("../../generated/v2/ThreadItem").ThreadItem) {
    if (item.type !== "userMessage") return item;
    const clientId = this.identity(item.id);
    if (clientId === item.clientId) return item;
    const cached = this.presentationItems.get(item);
    if (cached?.type === "userMessage" && cached.clientId === clientId)
      return cached;
    const next = { ...item, clientId };
    this.presentationItems.set(item, next);
    return next;
  }
  identity(id: string): string {
    return this.identities.get(id) ?? id;
  }
  constructor(private sessions: SessionsStore) {
    super([]);
    sessions.subscribe(() => this.reconcile());
  }
  private target(id: string): string {
    return (
      this.sessions.getSnapshot().localDrafts[id]?.serverId ??
      this.sessions.resolveId(id)
    );
  }
  add(
    threadId: string,
    input: UserInput[],
    draft?: Draft,
    id: string = crypto.randomUUID(),
    question?: { taskId: string; itemId: string },
  ): string {
    const thread = this.sessions.getSnapshot().threads[this.target(threadId)];
    const activeTurn = thread?.turns.findLast(
      (turn) => turn.status === "inProgress",
    );
    this.update([
      ...this.state,
      {
        id,
        threadId,
        turnId: activeTurn?.id,
        startsTurn: !activeTurn,
        baselineTurns: new Set(thread?.turns.map((turn) => turn.id) ?? []),
        input,
        draft: draft ? structuredClone(draft) : undefined,
        questionTaskId: question?.taskId,
        questionItemId: question?.itemId,
        status: question
          ? "queued"
          : this.sessions.getSnapshot().localDrafts[threadId] &&
              !this.sessions.getSnapshot().localDrafts[threadId].serverId
            ? "creating"
            : "sending",
        baseline: new Set(
          thread?.turns.flatMap((turn) => turn.items.map((item) => item.id)) ??
            [],
        ),
      },
    ]);
    return id;
  }
  /** Project the durable answer outbox into the same identity used by its server echo. */
  syncQuestionQueue(threads: Record<string, TaskQueue>): void {
    for (const [threadId, queue] of Object.entries(threads)) {
      for (const task of [
        ...queue.items,
        ...Object.values(queue.sentAnswerTasks ?? {}),
      ]) {
        if (!task.question) continue;
        const id = asyncAnswerClientId(task.question.itemId, task.id);
        const echoed = this.sessions
          .getSnapshot()
          .threads[threadId]?.turns.some((turn) =>
            turn.items.some(
              (item) => item.type === "userMessage" && item.clientId === id,
            ),
          );
        if (
          echoed ||
          Array.from(this.identities.values()).includes(id) ||
          this.state.some((message) => message.id === id)
        )
          continue;
        this.add(threadId, task.input, task.draft, id, {
          taskId: task.id,
          itemId: task.question.itemId,
        });
      }
    }
    this.update(
      this.state
        .filter((message) => {
          if (!message.questionTaskId) return true;
          const queue = threads[message.threadId];
          return (
            queue?.items.some((task) => task.id === message.questionTaskId) ||
            !!queue?.sentAnswers?.[message.questionItemId!]
          );
        })
        .map((message) => {
          if (!message.questionTaskId) return message;
          const queue = threads[message.threadId];
          const task = queue?.items.find(
            (task) => task.id === message.questionTaskId,
          );
          const status = task?.status ?? "accepted";
          return message.status === status ? message : { ...message, status };
        }),
    );
    this.reconcile();
  }
  set(id: string, status: LocalMessage["status"], error?: string): void {
    this.update(
      this.state.map((item) =>
        item.id === id ? { ...item, status, error } : item,
      ),
    );
    this.reconcile();
  }
  remove(id: string): void {
    this.update(this.state.filter((item) => item.id !== id));
  }
  clear(): void {
    this.matched.clear();
    this.identities.clear();
    this.identityThreads.clear();
    this.update([]);
  }
  uncertain(): void {
    this.update(
      this.state.map((item) =>
        item.status === "sending" || item.status === "creating"
          ? {
              ...item,
              status: "uncertain",
              error: "连接已改变，请先核实消息是否已发送；不会自动重发。",
            }
          : item,
      ),
    );
  }
  forThread(id: string): LocalMessage[] {
    return this.state.filter(
      (item) => this.target(item.threadId) === this.target(id),
    );
  }
  /** Keep the initiating prompt ahead of execution, including before its echo. */
  presentationTurns(thread: Thread): Turn[] {
    const local = this.forThread(thread.id);
    const item = (message: LocalMessage): ThreadItem => ({
      type: "userMessage",
      id: message.id,
      clientId: message.id,
      content: message.input,
    });
    return [
      ...thread.turns.map((turn) => {
        const pending = local.filter((message) => message.turnId === turn.id);
        const items = [
          ...pending.filter((message) => message.startsTurn).map(item),
          ...turn.items,
          ...pending.filter((message) => !message.startsTurn).map(item),
        ];
        const initiating = items.findIndex(
          (entry) =>
            entry.type === "userMessage" &&
            this.identity(entry.id) === this.identity(turn.id),
        );
        if (initiating > 0) items.unshift(...items.splice(initiating, 1));
        return { ...turn, items };
      }),
      ...local
        .filter(
          (message) =>
            !message.turnId ||
            !thread.turns.some((turn) => turn.id === message.turnId),
        )
        .map((message): Turn => ({
          id: message.id,
          rootTurnId: null,
          items: [item(message)],
          itemsView: "full",
          status: "inProgress",
          error: null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
        })),
    ];
  }
  private reconcile(): void {
    const used = this.matched;
    let changed = false;
    const next = this.state
      .map((local) => {
        const target = this.target(local.threadId);
        let next = local;
        if (local.status === "creating" && target !== local.threadId) {
          next = { ...next, status: "sending" };
        }
        if (
          next.startsTurn &&
          !next.turnId &&
          ["creating", "sending", "accepted"].includes(next.status)
        ) {
          const turn = this.sessions
            .getSnapshot()
            .threads[target]?.turns.find(
              (turn) =>
                turn.status === "inProgress" &&
                !next.baselineTurns?.has(turn.id) &&
                !this.identities.has(turn.id) &&
                !turn.items.some(
                  (entry) =>
                    entry.type === "userMessage" &&
                    entry.clientId !== next.id &&
                    (entry.clientId != null ||
                      signature(entry.content) !== signature(next.input)),
                ),
            );
          if (turn) {
            this.remember(target, turn.id, next.id);
            next = { ...next, turnId: turn.id };
          }
        }
        if (next !== local) changed = true;
        return next;
      })
      .filter((local) => {
        const target = this.target(local.threadId);
        const thread = this.sessions.getSnapshot().threads[target];
        const match = thread?.turns
          .flatMap((turn) => turn.items)
          .find(
            (item) =>
              item.type === "userMessage" &&
              !local.baseline.has(item.id) &&
              !used.has(`${target}:${item.id}`) &&
              (item.clientId === local.id ||
                (item.clientId == null &&
                  signature(item.content) === signature(local.input))),
          );
        if (!match) return true;
        used.add(`${target}:${match.id}`);
        this.remember(target, match.id, local.id);
        const turn = thread?.turns.find((turn) =>
          turn.items.some((item) => item.id === match.id),
        );
        if (turn && !local.turnId) this.remember(target, turn.id, local.id);
        return false;
      });
    if (changed || next.length !== this.state.length) this.update(next);
  }
}
