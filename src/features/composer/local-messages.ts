import type { Draft } from "./drafts";
import { Store } from "../../lib/store";
import type { UserInput } from "../../generated/v2/UserInput";
import type { SessionsStore } from "../sessions/store";

export interface LocalMessage {
  id: string;
  threadId: string;
  input: UserInput[];
  draft?: Draft;
  status: "creating" | "sending" | "accepted" | "failed" | "uncertain";
  error?: string;
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
  add(threadId: string, input: UserInput[], draft?: Draft): string {
    const id = crypto.randomUUID();
    const thread = this.sessions.getSnapshot().threads[this.target(threadId)];
    this.update([
      ...this.state,
      {
        id,
        threadId,
        input,
        draft: draft ? structuredClone(draft) : undefined,
        status:
          this.sessions.getSnapshot().localDrafts[threadId] &&
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
  private reconcile(): void {
    const used = this.matched;
    let changed = false;
    const next = this.state
      .map((local) => {
        if (
          local.status === "creating" &&
          this.target(local.threadId) !== local.threadId
        ) {
          changed = true;
          return { ...local, status: "sending" as const };
        }
        return local;
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
        return false;
      });
    if (changed || next.length !== this.state.length) this.update(next);
  }
}
