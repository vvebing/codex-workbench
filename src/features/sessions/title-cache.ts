import type { Thread } from "../../generated/v2/Thread";
import {
  firstTaskTitle,
  type ThreadTitleSource,
  type TitledThread,
} from "./thread-title";

type TitleStorage = Pick<Storage, "getItem" | "setItem">;
const STORAGE_PREFIX = "codex-workbench.thread-titles.v1:";
const MAX_TITLES = 1000;
const MAX_TITLE_LENGTH = 500;
function browserStorage(): TitleStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Retain the earliest known task across summary refreshes and body eviction. */
export class ThreadTitleCache {
  private scope = "";
  private titles = new Map<string, ThreadTitleSource>();
  private previous?: Record<string, Thread>;
  constructor(private readonly storage = browserStorage()) {}

  activateScope(scope: string): void {
    if (scope === this.scope) return;
    this.scope = scope;
    this.previous = undefined;
    this.titles.clear();
    try {
      const entries: unknown = JSON.parse(
        this.storage?.getItem(STORAGE_PREFIX + scope) ?? "null",
      );
      if (!Array.isArray(entries)) return;
      for (const entry of entries.slice(-MAX_TITLES)) {
        if (!Array.isArray(entry) || entry.length !== 2) continue;
        const [id, source] = entry as [unknown, Partial<ThreadTitleSource>];
        if (
          typeof id === "string" &&
          source &&
          typeof source.turnId === "string" &&
          typeof source.text === "string" &&
          source.text.trim() &&
          source.text.length <= MAX_TITLE_LENGTH
        )
          this.titles.set(id, { turnId: source.turnId, text: source.text });
      }
    } catch {
      // Unavailable storage must not prevent opening conversations.
    }
  }

  apply(threads: Record<string, Thread>): Record<string, TitledThread> {
    if (threads === this.previous) return threads;
    let next: Record<string, TitledThread> = threads;
    let changed = false;
    for (const [id, thread] of Object.entries(threads)) {
      if (thread === this.previous?.[id]) continue;
      if (thread.ephemeral) continue;
      let source = this.titles.get(id);
      const candidate = firstTaskTitle(thread);
      if (
        candidate &&
        (!source ||
          thread.turns.findIndex((turn) => turn.id === candidate.turnId) <
            thread.turns.findIndex((turn) => turn.id === source?.turnId))
      ) {
        source = {
          ...candidate,
          text: candidate.text.slice(0, MAX_TITLE_LENGTH),
        };
        this.titles.delete(id);
        this.titles.set(id, source);
        changed = true;
      }
      if ((thread as TitledThread).titleSource !== source) {
        if (next === threads) next = { ...threads };
        next[id] = { ...thread, titleSource: source };
      }
    }
    if (changed) {
      while (this.titles.size > MAX_TITLES)
        this.titles.delete(this.titles.keys().next().value!);
      try {
        if (this.scope)
          this.storage?.setItem(
            STORAGE_PREFIX + this.scope,
            JSON.stringify([...this.titles]),
          );
      } catch {
        // A title remains usable in memory if browser storage is full or blocked.
      }
    }
    this.previous = next;
    return next;
  }
}
