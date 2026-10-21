import type { SessionsState } from "../sessions/state";

const conversationOnly = new Set([
  "threads",
  "tokenUsage",
  "diffs",
  "fileOutputs",
  "completedItems",
  "startedItems",
  "toolProgress",
  "finishedTurns",
  "plans",
  "historyPages",
]);
/** Global consumers need navigation, notification and metadata changes, never message bodies. */
export function sameEnvironmentSessions(a: SessionsState, b: SessionsState) {
  if (a === b) return true;
  for (const key of Object.keys(b) as (keyof SessionsState)[]) {
    if (!conversationOnly.has(key) && a[key] !== b[key]) return false;
  }
  const ids = Object.keys(a.threads);
  if (ids.length !== Object.keys(b.threads).length) return false;
  return ids.every((id) => {
    const previous = a.threads[id],
      next = b.threads[id];
    if (previous === next) return true;
    if (!next || previous.turns.at(-1)?.status !== next.turns.at(-1)?.status)
      return false;
    return Object.keys(next).every(
      (key) =>
        key === "turns" ||
        (key === "status"
          ? JSON.stringify(previous.status) === JSON.stringify(next.status)
          : Object.is(
              previous[key as keyof typeof previous],
              next[key as keyof typeof next],
            )),
    );
  });
}
