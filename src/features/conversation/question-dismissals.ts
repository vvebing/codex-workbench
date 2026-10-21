import { Store } from "../../lib/store";

/** Ignoring an optional prompt is local UI state, never an answer to the agent. */
export class QuestionDismissalsStore extends Store<Record<string, true>> {
  private scope = "";
  constructor(scope?: string) {
    super({});
    if (scope) this.activateScope(scope);
  }
  activateScope(scope: string): void {
    if (scope === this.scope) return;
    this.scope = scope;
    let state: Record<string, true> = {};
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(this.key()) ?? "{}",
      );
      if (saved && typeof saved === "object" && !Array.isArray(saved))
        state = Object.fromEntries(
          Object.entries(saved).filter(([, value]) => value === true),
        );
    } catch {
      /* Storage is optional. */
    }
    this.update(state);
  }
  private key(): string {
    return `codex-workbench.ignored-questions:${this.scope}`;
  }
  isIgnored(threadId: string, itemId: string): boolean {
    return !!this.state[JSON.stringify([threadId, itemId])];
  }
  restore(threadId: string, itemId: string): void {
    const state = { ...this.state };
    delete state[JSON.stringify([threadId, itemId])];
    try {
      localStorage.setItem(this.key(), JSON.stringify(state));
    } catch {
      /* Keep in memory. */
    }
    this.update(state);
  }
  ignore(threadId: string, itemId: string): void {
    const state = {
      ...this.state,
      [JSON.stringify([threadId, itemId])]: true as const,
    };
    try {
      localStorage.setItem(this.key(), JSON.stringify(state));
    } catch {
      /* Keep in memory. */
    }
    this.update(state);
  }
}
