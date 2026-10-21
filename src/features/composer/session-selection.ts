import type { SessionsState } from "../sessions/state";
import type { Turn } from "../../generated/v2/Turn";
import { activeTurn } from "../conversation/activity";

const turnControls = new WeakMap<Turn, unknown[]>();
function controls(turn: Turn) {
  let value = turnControls.get(turn);
  if (!value) {
    value = turn.items.flatMap((item): unknown[] =>
      item.type === "collabAgentToolCall" || item.type === "subAgentActivity"
        ? [item]
        : item.type === "agentMessage" && item.questions?.length
          ? [item.id, item.questions]
          : item.type === "userMessage"
            ? [item]
            : [],
    );
    turnControls.set(turn, value);
  }
  return value;
}
export function selectComposerSession(
  sessions: SessionsState,
  requestedId: string,
) {
  const id =
    Object.keys(sessions.draftOrigins).find(
      (id) => sessions.draftOrigins[id] === requestedId,
    ) ?? requestedId;
  const thread = sessions.threads[id];
  const running = activeTurn(thread);
  return {
    sessions,
    values: [
      id,
      sessions.historySyncError,
      sessions.draftPersistenceWarning,
      sessions.threadAccess[id],
      sessions.localDrafts[id],
      sessions.threadSettings[id],
      sessions.tokenUsage[id],
      sessions.tokenUsage[requestedId],
      thread?.id,
      thread?.cwd,
      thread?.model,
      thread?.reasoningEffort,
      thread?.status.type,
      running?.id,
      running?.status,
      thread?.turns.at(-1)?.status,
      ...(thread?.turns.flatMap(controls) ?? []),
    ],
  };
}
export function sameComposerSession(
  a: ReturnType<typeof selectComposerSession>,
  b: ReturnType<typeof selectComposerSession>,
) {
  return (
    a.values.length === b.values.length &&
    a.values.every((value, index) => Object.is(value, b.values[index]))
  );
}
