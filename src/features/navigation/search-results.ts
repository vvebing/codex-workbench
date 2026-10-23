import {
  threadTitle,
  type TitledThread as Thread,
} from "../sessions/thread-title";

export type SearchMatchSource =
  "Session ID" | "标题" | "摘要" | "工作区" | "已加载对话" | "历史标题";

export interface ThreadSearchMatch {
  thread: Thread;
  sources: SearchMatchSource[];
  excerpt: string;
}

/** A complete identifier is a lookup, never a title search or a partial ID match. */
export function sessionIdQuery(query: string): string | null {
  const value = query
    .trim()
    .replace(
      /^(?:codex\s+)?(?:session|thread)(?:\s+id)?(?:\s*[:：]\s*|\s+)/i,
      "",
    );
  return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
    value,
  )
    ? value.toLowerCase()
    : null;
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ");
}

/** Search only message text already present in memory; never hydrate history. */
export function loadedMessageText(thread: Thread): string[] {
  return thread.turns.flatMap((turn) =>
    turn.items.flatMap((item) => {
      if (item.type === "userMessage")
        return item.content.flatMap((part) =>
          part.type === "text" ? [part.text] : [],
        );
      if (item.type === "agentMessage" || item.type === "plan")
        return [item.text];
      return [];
    }),
  );
}

function excerptOf(value: string, terms: string[]): string {
  const compact = value.replace(/\s+/g, " ").trim();
  const lower = normalized(compact);
  const index = Math.min(
    ...terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0),
  );
  const start = Number.isFinite(index) ? Math.max(0, index - 32) : 0;
  const excerpt = compact.slice(start, start + 150);
  return `${start ? "…" : ""}${excerpt}${start + 150 < compact.length ? "…" : ""}`;
}

export function matchLoadedThread(
  thread: Thread,
  query: string,
): ThreadSearchMatch | null {
  const id = sessionIdQuery(query);
  if (id) {
    return [thread.id, thread.sessionId].some(
      (value) => value?.toLowerCase() === id,
    )
      ? { thread, sources: ["Session ID"], excerpt: thread.id }
      : null;
  }
  const terms = normalized(query.trim()).split(" ").filter(Boolean);
  if (!terms.length) return null;
  const fields: { source: SearchMatchSource; text: string }[] = [
    { source: "标题", text: thread.name || thread.titleSource?.text || "" },
    { source: "摘要", text: thread.preview },
    { source: "工作区", text: thread.cwd },
    ...loadedMessageText(thread).map((text) => ({
      source: "已加载对话" as const,
      text,
    })),
  ];
  const values = fields.map((field) => normalized(field.text));
  if (!terms.every((term) => values.some((value) => value.includes(term))))
    return null;
  const matched = fields.filter((_, index) =>
    terms.some((term) => values[index].includes(term)),
  );
  const excerpt =
    matched.find((field) => field.source === "已加载对话") ||
    matched.find((field) => field.source === "摘要") ||
    matched[0];
  return {
    thread,
    sources: [...new Set(matched.map((field) => field.source))],
    excerpt: excerptOf(excerpt.text, terms),
  };
}

/** Keep loaded turns when a metadata-only server result describes the same thread. */
export function combineSearchResults(
  loaded: Thread[],
  remote: Thread[],
  query: string,
): ThreadSearchMatch[] {
  const loadedById = new Map(loaded.map((thread) => [thread.id, thread]));
  const matches = new Map<string, ThreadSearchMatch>();
  for (const thread of loaded) {
    const match = matchLoadedThread(thread, query);
    if (match) matches.set(thread.id, match);
  }
  for (const remoteThread of remote) {
    const thread = loadedById.get(remoteThread.id) || remoteThread;
    const previous = matches.get(thread.id);
    const source: SearchMatchSource = sessionIdQuery(query)
      ? "Session ID"
      : "历史标题";
    matches.set(thread.id, {
      thread,
      sources: [...new Set([...(previous?.sources || []), source])],
      excerpt: previous?.excerpt || remoteThread.preview || remoteThread.id,
    });
  }
  const needle = normalized(query.trim());
  const relevance = (match: ThreadSearchMatch) => {
    const title = normalized(threadTitle(match.thread));
    if (title === needle) return 0;
    if (title.includes(needle)) return 1;
    return match.sources.some((source) => ["标题", "历史标题"].includes(source))
      ? 2
      : 3;
  };
  return [...matches.values()].sort((a, b) => {
    const exact =
      Number(b.sources.includes("Session ID")) -
      Number(a.sources.includes("Session ID"));
    return (
      exact ||
      relevance(a) - relevance(b) ||
      b.thread.updatedAt - a.thread.updatedAt
    );
  });
}

export function recentSearchSuggestions(
  threads: Thread[],
  visits: Record<string, number>,
  environmentKey: string,
  limit = 8,
): Thread[] {
  const visited = (thread: Thread) =>
    visits[JSON.stringify([environmentKey, thread.id])] || 0;
  return [...threads]
    .sort((a, b) => visited(b) - visited(a) || b.updatedAt - a.updatedAt)
    .slice(0, limit);
}
