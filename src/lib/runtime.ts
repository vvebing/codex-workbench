import { ConnectionStore } from "../features/connection/store";
import { SessionsStore } from "../features/sessions/store";
import { RequestsStore } from "../features/requests/store";
import { DraftsStore } from "../features/composer/drafts";
import type { CodexClientOptions } from "./rpc";
import { DraftSubmissionStore } from "../features/composer/submission";
import { MessageQueueStore } from "../features/composer/queue";
import { FileWorkspaceStore } from "../features/files/store";
export function createRuntime(
  options: CodexClientOptions = {},
  draftScope?: string,
) {
  const connection = new ConnectionStore(options);
  const files = new FileWorkspaceStore(connection);
  const sessions = new SessionsStore(connection);
  const requests = new RequestsStore(connection);
  const drafts = new DraftsStore();
  if (draftScope) drafts.activateScope(draftScope);
  else
    connection.subscribe(() =>
      drafts.activateScope(connection.getSnapshot().url),
    );
  let reconnectToken: string | undefined;
  const connect = async (url: string, token?: string): Promise<void> => {
    reconnectToken = token;
    const pending = connection.connect(url, token);
    const epoch = connection.getSnapshot().epoch;
    await pending;
    if (
      connection.getSnapshot().epoch === epoch &&
      connection.getSnapshot().status === "connected"
    ) {
      await sessions.refresh();
      if (connection.getSnapshot().epoch === epoch)
        await sessions.restoreSelected();
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
    connect,
    reconnect: () => connect(connection.getSnapshot().url, reconnectToken),
    submissions,
    queue,
    sendDraft: submissions.send,
    revert,
    discardDraft,
  };
}
export const runtime = createRuntime();
