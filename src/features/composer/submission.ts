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

/** One submission owns its snapshot until acknowledgement, across view changes. */
export class DraftSubmissionStore extends Store<Record<string, boolean>> {
  private pending = new Map<string, Promise<void>>();

  constructor(
    private connection: ConnectionStore,
    private sessions: SessionsStore,
    private drafts: DraftsStore,
    private requests: RequestsStore,
    private queue: MessageQueueStore,
  ) {
    super({});
    let epoch = connection.getSnapshot().epoch;
    connection.subscribe(() => {
      const next = connection.getSnapshot().epoch;
      if (next === epoch) return;
      epoch = next;
      this.pending.clear();
      this.update({});
    });
  }

  isSending(id: string): boolean {
    return !!this.state[this.sessions.resolveId(id)];
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
    const enqueue = () => this.queue.add(id, draft, input, options);
    const submit = () => {
      if (mode === "steer" && active)
        return this.sessions
          .steer(id, input, active.id)
          .catch((error: unknown) => {
            if (
              error instanceof TurnBusyError ||
              (error instanceof RpcError &&
                this.sessions.activeTurn(id)?.id !== active.id)
            )
              return enqueue();
            throw error;
          });
      if (
        this.queue.forThread(id).items.length ||
        conversationExecuting(thread)
      )
        return enqueue();
      return this.sessions
        .send(
          id,
          input,
          options,
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
    const pending = submit()
      .then(() => {
        if (this.connection.getSnapshot().epoch === epoch)
          this.drafts.clearIfRevision(id, draft.revision);
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
    return pending;
  };
}
