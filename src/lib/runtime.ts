import { QuestionDismissalsStore } from "../features/conversation/question-dismissals";
import { ConnectionStore, sameEndpoint } from "../features/connection/store";
import { SessionsStore } from "../features/sessions/store";
import { RequestsStore, requestThreadId } from "../features/requests/store";
import { DraftsStore } from "../features/composer/drafts";
import type { CodexClientOptions } from "./rpc";
import { DraftSubmissionStore } from "../features/composer/submission";
import { MessageQueueStore } from "../features/composer/queue";
import { FileWorkspaceStore } from "../features/files/store";
export function createRuntime(
  options: CodexClientOptions = {},
  draftScope?: string,
  initialEndpoint?: string,
) {
  const connection = new ConnectionStore(options);
  const files = new FileWorkspaceStore(connection, draftScope, initialEndpoint);
  const requests = new RequestsStore(connection);
  const drafts = new DraftsStore();
  const sessions = new SessionsStore(
    connection,
    () =>
      requests.getSnapshot().pending.flatMap((request) => {
        const id = requestThreadId(request);
        return id ? [id] : [];
      }),
    (ids) => ids.forEach((id) => drafts.remove(id)),
  );
  const questionDismissals = new QuestionDismissalsStore(draftScope);
  const activateDraftScope = (endpoint: string) => {
    if (!endpoint) return;
    let normalized = endpoint;
    try {
      normalized = new URL(endpoint).href;
    } catch {
      /* Preserve custom endpoints. */
    }
    const scope = JSON.stringify([draftScope ?? "", normalized]);
    questionDismissals.activateScope(scope);
    drafts.activateScope(scope);
    sessions.activateDraftScope(scope);
  };
  if (initialEndpoint) activateDraftScope(initialEndpoint);
  connection.subscribe(() => activateDraftScope(connection.getSnapshot().url));
  let reconnectToken: string | undefined;
  let connecting:
    | { url: string; token?: string; epoch: number; promise: Promise<void> }
    | undefined;
  const connect = async (
    url: string,
    token?: string,
    force = false,
  ): Promise<void> => {
    if (!force) {
      if (
        connecting &&
        connecting.epoch === connection.getSnapshot().epoch &&
        sameEndpoint(url, connecting.url) &&
        (!token || token === connecting.token)
      )
        return connecting.promise;
      const state = connection.getSnapshot();
      if (
        state.status === "connected" &&
        sameEndpoint(url, state.url) &&
        (!token || token === reconnectToken)
      )
        return;
    }
    reconnectToken = token;
    const pending = (async () => {
      const opening = connection.connect(url, token);
      const epoch = connection.getSnapshot().epoch;
      await opening;
      if (
        connection.getSnapshot().epoch === epoch &&
        connection.getSnapshot().status === "connected"
      ) {
        await sessions.refresh();
        if (connection.getSnapshot().epoch === epoch)
          await sessions.restoreSelected();
      }
    })();
    connecting = {
      url,
      token,
      epoch: connection.getSnapshot().epoch,
      promise: pending,
    };
    try {
      await pending;
    } finally {
      if (connecting?.promise === pending) connecting = undefined;
    }
  };
  const queue = new MessageQueueStore(
    connection,
    sessions,
    requests,
    draftScope,
  );
  const submissions = new DraftSubmissionStore(
    connection,
    sessions,
    drafts,
    requests,
    queue,
  );
  const discardDraft = (id: string): void => {
    if (!sessions.getSnapshot().localDrafts[id]) return;
    sessions.discardDraft(id);
    drafts.remove(id);
  };
  const revert = (
    id: string,
    beforeTurnId: string,
    messageId?: string,
  ): Promise<void> => {
    if (submissions.isSending(id))
      return Promise.reject(
        new Error("消息正在发送，请等待发送结束后再回滚。"),
      );
    return sessions.revert(id, beforeTurnId, (turn) => {
      const message = turn.items.find(
        (item) =>
          item.type === "userMessage" && (!messageId || item.id === messageId),
      );
      if (message?.type === "userMessage")
        drafts.restoreMessage(id, message.content);
    });
  };
  return {
    connection,
    files,
    sessions,
    requests,
    drafts,
    questionDismissals,
    connect,
    reconnect: () =>
      connect(connection.getSnapshot().url, reconnectToken, true),
    submissions,
    queue,
    sendDraft: submissions.send,
    revert,
    discardDraft,
  };
}
export const runtime = createRuntime();
