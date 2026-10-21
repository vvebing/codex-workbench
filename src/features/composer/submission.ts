import { LocalMessagesStore } from "./local-messages";
import { documentApps } from "./editor-document";
import type { TurnStartParams } from "../../generated/v2/TurnStartParams";
import type { UserInput } from "../../generated/v2/UserInput";
import { Store } from "../../lib/store";
import type { ConnectionStore } from "../connection/store";
import type { RequestsStore } from "../requests/store";
import type { SessionsStore } from "../sessions/store";
import type { Draft, DraftsStore } from "./drafts";
import type { MessageQueueStore } from "./queue";
import { TurnBusyError } from "../sessions/store";
import { conversationExecuting } from "../conversation/activity";
import { RpcError } from "../../lib/rpc";

export type SendOptions = Omit<Partial<TurnStartParams>, "threadId" | "input">;

export function draftInput(draft: Draft): UserInput[] {
  return [
    ...(draft.text.trim()
      ? [{ type: "text" as const, text: draft.text, text_elements: [] }]
      : []),
    ...(draft.skills ?? []).map((skill) => ({
      type: "skill" as const,
      name: skill.name,
      path: skill.path,
    })),
    ...documentApps(draft.document).map((app) => ({
      type: "mention" as const,
      name: app.name,
      path: app.path,
    })),
    ...draft.images.map((image) => ({
      type: "image" as const,
      url: image.url,
    })),
  ];
}

/** The delivery record owns submitted content while the editor starts a new draft. */
export class DraftSubmissionStore extends Store<Record<string, boolean>> {
  readonly messages: LocalMessagesStore;
  private pending = new Map<string, Promise<void>>();

  constructor(
    private connection: ConnectionStore,
    private sessions: SessionsStore,
    private drafts: DraftsStore,
    private requests: RequestsStore,
    private queue: MessageQueueStore,
  ) {
    super({});
    this.messages = new LocalMessagesStore(sessions);
    let epoch = connection.getSnapshot().epoch;
    let scope = connection.getSnapshot().scope;
    connection.subscribe(() => {
      const state = connection.getSnapshot();
      if (state.scope !== scope) {
        scope = state.scope;
        this.messages.clear();
      }
      if (state.epoch === epoch) return;
      epoch = state.epoch;
      this.messages.uncertain();
      this.pending.clear();
      this.update({});
    });
  }

  isSending(id: string): boolean {
    return !!this.state[this.sessions.resolveId(id)];
  }

  restoreMessage(id: string): void {
    const message = this.messages.getSnapshot().find((item) => item.id === id);
    if (
      !message ||
      (message.status !== "failed" && message.status !== "uncertain")
    )
      return;
    const threadId = this.sessions.resolveId(message.threadId);
    if (message.draft) this.drafts.restoreDraft(threadId, message.draft);
    else this.drafts.restoreMessage(threadId, message.input);
    this.messages.remove(id);
  }

  send = (
    id: string,
    options: SendOptions = {},
    mode: "queue" | "steer" = "queue",
  ): Promise<void> => {
    id = this.sessions.resolveId(id);
    const existing = this.pending.get(id);
    if (existing) return existing;
    const draft = this.drafts.get(id);
    const input = draftInput(draft);
    if (!input.length) return Promise.resolve();
    const targetId =
      this.sessions.getSnapshot().localDrafts[id]?.serverId ?? id;
    if (this.requests.forThread(targetId).length)
      return Promise.reject(new Error("请先处理当前会话的确认请求。"));

    const epoch = this.connection.getSnapshot().epoch;
    const ids = new Set([id]);
    const active = this.sessions.activeTurn(id);
    const thread = this.sessions.getSnapshot().threads[id];
    let localId: string | undefined;
    const track = () => {
      localId ??= this.messages.add(id, input, draft);
      this.drafts.clearIfRevision(id, draft.revision);
    };
    const enqueue = () =>
      this.queue.add(id, draft, input, options).then(() => {
        if (this.connection.getSnapshot().epoch !== epoch) return;
        if (localId) this.messages.remove(localId);
        localId = undefined;
        this.drafts.clearIfRevision(id, draft.revision);
      });
    const submit = () => {
      if (mode === "steer" && active) {
        track();
        return this.sessions
          .steer(id, input, active.id, localId)
          .catch((error: unknown) => {
            if (
              error instanceof TurnBusyError ||
              (error instanceof RpcError &&
                this.sessions.activeTurn(id)?.id !== active.id)
            )
              return enqueue();
            throw error;
          });
      }
      if (
        this.queue.forThread(id).items.length ||
        conversationExecuting(thread)
      )
        return enqueue();
      track();
      return this.sessions
        .send(
          id,
          input,
          { ...options, clientUserMessageId: localId },
          (serverId) => {
            // Register the new ID before notifying draft listeners during migration.
            ids.add(serverId);
            this.pending.set(serverId, pending);
            this.update({ ...this.state, [serverId]: true });
            this.drafts.move(id, serverId);
          },
          "start",
        )
        .then(() => {})
        .catch((error: unknown) => {
          if (error instanceof TurnBusyError) return enqueue();
          throw error;
        });
    };
    // Register the submission before clearing the editor notifies subscribers.
    let start!: () => void;
    const operation = new Promise<void>((resolve, reject) => {
      start = () => {
        try {
          Promise.resolve(submit()).then(resolve, reject);
        } catch (error) {
          reject(error);
        }
      };
    });
    const pending = operation
      .then(() => {
        if (localId && this.connection.getSnapshot().epoch === epoch)
          this.messages.set(localId, "accepted");
      })
      .catch((error: unknown) => {
        if (localId && this.connection.getSnapshot().epoch === epoch)
          this.messages.set(
            localId,
            error instanceof RpcError ? "failed" : "uncertain",
            error instanceof Error ? error.message : String(error),
          );
        throw error;
      })
      .finally(() => {
        if (this.connection.getSnapshot().epoch !== epoch) return;
        const state = { ...this.state };
        for (const key of ids) {
          if (this.pending.get(key) !== pending) continue;
          this.pending.delete(key);
          delete state[key];
        }
        this.update(state);
      });
    this.pending.set(id, pending);
    this.update({ ...this.state, [id]: true });
    start();
    return pending;
  };
}
