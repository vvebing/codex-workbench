import type { SessionsState } from "../sessions/state";
import { conversationExecuting } from "../conversation/activity";
import { pinnedOf } from "../sessions/management";
import { threadTitle } from "../sessions/thread-title";

export function visibleSidebarThreads(sessions: SessionsState) {
  return [...Object.keys(sessions.localDrafts), ...sessions.listIds]
    .map((id) => sessions.threads[id])
    .filter(Boolean)
    .filter(
      (thread) =>
        sessions.sectionFilter === "all" ||
        (sessions.sectionFilter === "unsectioned"
          ? !thread.section
          : thread.section?.id === sessions.sectionFilter),
    );
}
/** Keep real Thread objects for menu actions; compare only navigation-visible fields. */
export function sameSidebarSessions(a: SessionsState, b: SessionsState) {
  if (a === b) return true;
  if (
    a.selectedId !== b.selectedId ||
    a.openingId !== b.openingId ||
    a.loading !== b.loading ||
    a.nextCursor !== b.nextCursor ||
    a.historyLoading !== b.historyLoading ||
    a.historyError !== b.historyError ||
    a.historyComplete !== b.historyComplete ||
    a.error !== b.error ||
    a.sectionFilter !== b.sectionFilter ||
    a.localDrafts !== b.localDrafts ||
    a.threadAccess !== b.threadAccess ||
    a.subagentThreadIds !== b.subagentThreadIds ||
    a.unreadCompleted !== b.unreadCompleted
  )
    return false;
  const previous = visibleSidebarThreads(a),
    next = visibleSidebarThreads(b);
  return (
    previous.length === next.length &&
    previous.every((thread, index) => {
      const other = next[index];
      return (
        thread === other ||
        (thread.id === other.id &&
          thread.sessionId === other.sessionId &&
          thread.cwd === other.cwd &&
          thread.projectId === other.projectId &&
          thread.name === other.name &&
          thread.preview === other.preview &&
          threadTitle(thread) === threadTitle(other) &&
          thread.createdAt === other.createdAt &&
          thread.updatedAt === other.updatedAt &&
          thread.recencyAt === other.recencyAt &&
          thread.section === other.section &&
          pinnedOf(thread) === pinnedOf(other) &&
          thread.status.type === other.status.type &&
          conversationExecuting(thread) === conversationExecuting(other) &&
          (thread.turns.at(-1)?.status === "failed") ===
            (other.turns.at(-1)?.status === "failed"))
      );
    })
  );
}
export const sidebarSessions = (state: SessionsState) => state;
