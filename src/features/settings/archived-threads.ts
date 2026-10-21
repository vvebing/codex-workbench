import type { Thread } from "../../generated/v2/Thread";

// Multiple archived rollout files can describe the same conversation.
export function mergeArchivedThreads(
  current: Thread[],
  incoming: Thread[],
): Thread[] {
  const threads = new Map<string, Thread>();
  for (const thread of [...current, ...incoming]) {
    const previous = threads.get(thread.id);
    if (!previous || thread.updatedAt >= previous.updatedAt)
      threads.set(thread.id, thread);
  }
  return [...threads.values()];
}
