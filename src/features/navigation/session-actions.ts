import type { createRuntime } from "../../lib/runtime";
import { Store, errorMessage } from "../../lib/store";
import type { Draft } from "../composer/drafts";

type Runtime = ReturnType<typeof createRuntime>;
export interface ArchiveNotice {
  id: number;
  title: string;
  runtime: Runtime;
  threadId: string;
  connectionScope: number;
  connectionUrl: string;
  wasSelected: boolean;
  busy: boolean;
  restored: boolean;
  error: string;
}
export function draftHasContent(draft: Draft): boolean {
  return !!(draft.text.trim() || draft.images.length || draft.skills?.length);
}

/** Kept outside rows so archive feedback and Undo survive list changes. */
export class SessionActionsStore extends Store<{ notices: ArchiveNotice[] }> {
  private sequence = 0;
  constructor() {
    super({ notices: [] });
  }
  async archive(
    runtime: Runtime,
    threadId: string,
    title: string,
  ): Promise<void> {
    const connection = runtime.connection.getSnapshot();
    const wasSelected = runtime.sessions.getSnapshot().selectedId === threadId;
    await runtime.sessions.archive(threadId);
    const current = runtime.connection.getSnapshot();
    if (current.scope !== connection.scope || current.url !== connection.url)
      return;
    this.update({
      notices: [
        ...this.state.notices,
        {
          id: ++this.sequence,
          title,
          runtime,
          threadId,
          connectionScope: connection.scope,
          connectionUrl: connection.url,
          wasSelected,
          busy: false,
          restored: false,
          error: "",
        },
      ].slice(-5),
    });
  }
  private patch(id: number, values: Partial<ArchiveNotice>): void {
    this.update({
      notices: this.state.notices.map((notice) =>
        notice.id === id ? { ...notice, ...values } : notice,
      ),
    });
  }
  dismiss(id: number): void {
    this.update({
      notices: this.state.notices.filter((notice) => notice.id !== id),
    });
  }
  async undo(id: number): Promise<void> {
    const notice = this.state.notices.find((notice) => notice.id === id);
    if (!notice || notice.busy || notice.restored) return;
    const { runtime } = notice;
    const connection = runtime.connection.getSnapshot();
    if (
      connection.scope !== notice.connectionScope ||
      connection.url !== notice.connectionUrl
    ) {
      this.patch(id, {
        error: "来源环境地址已更改，请连接原环境后从归档会话中恢复。",
      });
      return;
    }
    if (connection.status !== "connected") {
      this.patch(id, { error: "来源环境未连接，重新连接后可再次撤销。" });
      return;
    }
    this.patch(id, { busy: true, error: "" });
    try {
      await runtime.sessions.unarchive(notice.threadId);
      // Remember the successful mutation even if the subsequent refresh fails.
      this.patch(id, { restored: true });
      const current = runtime.connection.getSnapshot();
      if (
        current.scope !== notice.connectionScope ||
        current.url !== notice.connectionUrl
      )
        throw new Error("来源环境地址已更改，请在原环境查看恢复结果。");
      await runtime.sessions.refresh();
      const refreshedConnection = runtime.connection.getSnapshot();
      if (
        refreshedConnection.scope !== notice.connectionScope ||
        refreshedConnection.url !== notice.connectionUrl
      )
        throw new Error("来源环境地址已更改，请在原环境查看恢复结果。");
      const selectedId = runtime.sessions.getSnapshot().selectedId;
      if (notice.wasSelected && (!selectedId || selectedId === notice.threadId))
        await runtime.sessions.open(notice.threadId);
      this.dismiss(id);
    } catch (error) {
      this.patch(id, { error: errorMessage(error) });
    } finally {
      this.patch(id, { busy: false });
    }
  }
}
export const sessionActions = new SessionActionsStore();
