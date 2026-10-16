import { managementError, type ManagedThread } from "./management";
import type { ThreadSection } from "../../generated/v2/ThreadSection";
import type { ReviewTarget } from "../../generated/v2/ReviewTarget";
import type { ReviewStartResponse } from "../../generated/v2/ReviewStartResponse";
import { Store, errorMessage } from "../../lib/store";
import {
  mergeThread,
  placeholderThread,
  reduceNotification,
  type ConversationState,
} from "../../lib/state";
import type { Thread } from "../../generated/v2/Thread";
import type { Turn } from "../../generated/v2/Turn";
import type { UserInput } from "../../generated/v2/UserInput";
import type { ThreadStartParams } from "../../generated/v2/ThreadStartParams";
import type { TurnStartParams } from "../../generated/v2/TurnStartParams";
import type { ConnectionStore } from "../connection/store";
import { readHistory } from "./history";
import { conversationExecuting } from "../conversation/activity";
import { ROOT_THREAD_SOURCES } from "./list";
import { Polling } from "./polling";
import {
  initialState,
  descendantIds,
  createDraft,
  removeDraft,
  promoteDraft,
  removeThread,
  clearCompletion,
  sessionNotification,
  reconcileNotifications,
  isSubagentThread,
  type SessionsState,
  type ThreadAccess,
} from "./state";
export type { SessionsState, ThreadAccess } from "./state";
export class TurnBusyError extends Error {
  constructor() {
    super("当前轮次仍在执行，消息应加入队列。");
  }
}
export class SessionsStore extends Store<SessionsState> {
  protected override update(state: SessionsState): void {
    super.update(reconcileNotifications(this.state, state));
  }
  private confirmedMetadata(ids: string[]): Record<string, true> {
    const pending = { ...this.state.notificationMetadataPending };
    for (const id of ids) delete pending[id];
    return pending;
  }
  private historyRevisions = new Map<string, number>();
  private sectionRead = 0;
  private sectionGeneration = 0;
  private hiddenServerIds = new Set<string>();
  private creatingDrafts = new Set<symbol>();
  private deferredStartedIds = new Set<string>();
  private canWrite(id: string): boolean {
    return this.state.threadAccess[id] === "editable";
  }
  resolveId(id: string): string {
    return (
      Object.keys(this.state.draftOrigins).find(
        (serverId) => this.state.draftOrigins[serverId] === id,
      ) ?? id
    );
  }
  private visibleServerId(id: string): boolean {
    return (
      !this.hiddenServerIds.has(id) &&
      !Object.values(this.state.localDrafts).some(
        (draft) => draft.serverId === id,
      )
    );
  }
  private pageVisible =
    typeof document === "undefined" || document.visibilityState !== "hidden";
  private pageFocused = typeof document === "undefined" || document.hasFocus();
  setPageFocused(focused: boolean): void {
    if (this.pageFocused === focused) return;
    this.pageFocused = focused;
    if (focused && this.pageVisible && this.foreground && this.state.selectedId)
      this.update(clearCompletion(this.state, this.state.selectedId));
  }
  private discovery = new Polling();
  private historySync = new Polling();
  setPageVisible(visible: boolean): void {
    if (this.pageVisible === visible) return;
    this.pageVisible = visible;
    this.resetSyncSchedule();
    if (visible && this.pageFocused && this.foreground && this.state.selectedId)
      this.update(clearCompletion(this.state, this.state.selectedId));
  }
  private resetSyncSchedule(): void {
    this.discovery.restart();
    this.historySync.restart();
  }
  private syncDelay(foregroundDelay: number): number {
    return !this.pageVisible
      ? 60000
      : !this.foreground
        ? 30000
        : foregroundDelay;
  }
  private scheduleDiscovery(): void {
    if (this.connection.getSnapshot().status !== "connected") return;
    this.discovery.start(
      () => this.discover(),
      () =>
        this.syncDelay(
          this.state.selectedId && this.canWrite(this.state.selectedId)
            ? 10000
            : 5000,
        ),
    );
  }
  private async discover(): Promise<void> {
    const epoch = this.connection.getSnapshot().epoch;
    const sectionFilter = this.state.sectionFilter;
    const sectionGeneration = this.sectionGeneration;
    const previous = this.state.threads;
    try {
      const page = await this.connection.client.request<{ data: Thread[] }>(
        "thread/list",
        {
          sourceKinds: ROOT_THREAD_SOURCES,
          ...(sectionFilter === "all"
            ? {}
            : {
                sectionId:
                  sectionFilter === "unsectioned" ? null : sectionFilter,
              }),
          limit: 50,
          sortKey: "updated_at",
          sortDirection: "desc",
        },
      );
      if (
        !this.current(epoch) ||
        sectionGeneration !== this.sectionGeneration ||
        sectionFilter !== this.state.sectionFilter ||
        this.connection.getSnapshot().status !== "connected"
      )
        return;
      let merged: ConversationState = this.state;
      const ids = [...this.state.listIds];
      const confirmedIds: string[] = [];
      for (const thread of page.data) {
        if (
          !this.visibleServerId(thread.id) ||
          this.state.threads[thread.id] !== previous[thread.id]
        )
          continue;
        const old = previous[thread.id];
        const metadata =
          this.canWrite(thread.id) && old && thread.updatedAt <= old.updatedAt
            ? { ...thread, status: old.status }
            : thread;
        merged = mergeThread(merged, metadata);
        confirmedIds.push(thread.id);
        if (!ids.includes(thread.id)) ids.unshift(thread.id);
      }
      this.update({
        ...this.state,
        ...merged,
        listIds: ids,
        notificationMetadataPending: this.confirmedMetadata(confirmedIds),
      });
    } catch {
      // Keep cached summaries on transient discovery failures.
    }
  }
  private setAccess(id: string, access: ThreadAccess): void {
    this.update({
      ...this.state,
      threadAccess: { ...this.state.threadAccess, [id]: access },
    });
  }
  private mergeRead(
    thread: Thread,
    previous: Thread | undefined,
  ): SessionsState | undefined {
    if (!this.visibleServerId(thread.id)) return;
    const current = this.state.threads[thread.id];
    if (previous && !current) return;
    // Metadata/notifications may advance while history pages are loading.
    // Merge the loaded turns while preserving those newer metadata fields.
    return {
      ...this.state,
      ...mergeThread(
        this.state,
        current && current !== previous
          ? {
              ...thread,
              ...current,
              source: isSubagentThread(current)
                ? current.source
                : thread.source,
              parentThreadId: current.parentThreadId ?? thread.parentThreadId,
              turns: thread.turns,
            }
          : thread,
      ),
      notificationMetadataPending: this.confirmedMetadata([thread.id]),
    };
  }
  private async syncViewedThread(id: string, epoch: number): Promise<void> {
    const before = this.state.threads[id];
    const { thread: metadata } = await this.connection.client.request<{
      thread: Thread;
    }>("thread/read", { threadId: id, includeTurns: false });
    if (!this.current(epoch)) return;
    const synced = this.historySynced.get(id);
    const changed =
      !synced ||
      metadata.updatedAt !== synced.updatedAt ||
      metadata.status.type !== synced.status ||
      metadata.status.type === "active" ||
      !!this.activeTurn(id);
    const thread = changed
      ? await this.readHistory(id, epoch, true, metadata)
      : metadata;
    if (!this.current(epoch)) return;
    const merged = this.mergeRead(thread, before);
    if (merged) {
      if (changed) this.recordHistory(thread);
      this.update({
        ...this.state,
        ...merged,
        historySyncError:
          this.state.selectedId === id ? null : this.state.historySyncError,
      });
    }
  }
  activate(id: string): Promise<void> {
    if (this.state.localDrafts[id])
      return Promise.reject(new Error("发送第一条消息时才会创建会话。"));
    if (this.canWrite(id)) return Promise.resolve();
    return this.locked(`activate:${id}`, () =>
      this.perform(async (epoch) => {
        if (this.state.selectedId === id) this.historySync.stop();
        this.setAccess(id, "activating");
        try {
          const { thread } = await this.connection.client.request<{
            thread: Thread;
          }>("thread/resume", { threadId: id, excludeTurns: true });
          if (
            !this.current(epoch) ||
            this.state.threadAccess[id] !== "activating"
          )
            return;
          const history =
            !thread.turns?.length &&
            (thread.status.type === "active" || this.activeTurn(id))
              ? await this.readHistory(id, epoch, true, thread)
              : thread;
          if (
            !this.current(epoch) ||
            this.state.threadAccess[id] !== "activating"
          )
            return;
          this.hydrate(history, epoch, true);
        } catch (error) {
          if (
            !this.current(epoch) ||
            this.state.threadAccess[id] !== "activating"
          )
            return;
          const occupied = /already has an active writer/i.test(
            errorMessage(error),
          );
          this.setAccess(id, occupied ? "occupied" : "viewing");
          if (!occupied) throw error;
        } finally {
          if (this.current(epoch) && this.state.selectedId === id)
            this.scheduleHistorySync(id, epoch);
        }
      }),
    );
  }
  private scheduleHistorySync(id: string, epoch: number): void {
    this.historySync.stop();
    const generation = this.selectionGeneration;
    const active = () =>
      this.current(epoch) &&
      generation === this.selectionGeneration &&
      this.state.selectedId === id &&
      this.state.threadAccess[id] !== "activating" &&
      !this.canWrite(id) &&
      !this.state.localDrafts[id];
    if (!active()) return;
    this.historySync.start(
      async () => {
        if (!active()) return false;
        try {
          await this.locked(`read:${id}`, () =>
            this.syncViewedThread(id, epoch),
          );
        } catch (error) {
          if (active())
            this.update({
              ...this.state,
              historySyncError: errorMessage(error),
            });
        }
        return active();
      },
      () =>
        this.syncDelay(
          this.state.threads[id]?.status.type === "active" ||
            this.activeTurn(id)
            ? 2000
            : 10000,
        ),
    );
  }
  private historySynced = new Map<
    string,
    { updatedAt: number; status: Thread["status"]["type"] }
  >();
  private recordHistory(thread: Thread): void {
    this.historySynced.set(thread.id, {
      updatedAt: thread.updatedAt,
      status: thread.status.type,
    });
  }
  private foreground = true;
  setForeground(value: boolean): void {
    if (this.foreground === value) return;
    this.foreground = value;
    this.resetSyncSchedule();
    if (
      value &&
      this.pageVisible &&
      this.pageFocused &&
      this.state.selectedId
    ) {
      const id = this.state.selectedId;
      this.update(clearCompletion(this.state, id));
    }
  }
  private completedNotifications = new Set<string>();
  private selectionGeneration = 0;
  private actions = 0;
  private locks = new Map<string, Promise<unknown>>();
  constructor(private connection: ConnectionStore) {
    super(initialState());
    let epoch = connection.getSnapshot().epoch;
    let scope = connection.getSnapshot().scope;
    connection.subscribe(() => {
      const next = connection.getSnapshot().epoch;
      if (next !== epoch) {
        epoch = next;
        this.historySync.stop();
        this.discovery.stop();
        this.historySynced.clear();
        this.historyRevisions.clear();
        this.sectionRead++;
        this.creatingDrafts.clear();
        this.deferredStartedIds.clear();
        this.selectionGeneration++;
        this.actions = 0;
        this.locks.clear();
        this.update({
          ...this.state,
          threadAccess: Object.fromEntries(
            Object.keys(this.state.threadAccess).map((id) => [id, "viewing"]),
          ),
          loading: false,
          openingId: null,
          error: null,
          historySyncError: null,
        });
      }
      const nextScope = connection.getSnapshot().scope;
      if (scope !== nextScope) {
        scope = nextScope;
        this.completedNotifications.clear();
        this.historySynced.clear();
        this.hiddenServerIds.clear();
        this.creatingDrafts.clear();
        this.deferredStartedIds.clear();
        this.update(initialState());
      }
      if (connection.getSnapshot().status === "connected")
        this.scheduleDiscovery();
      else this.discovery.stop();
    });
    connection.client.onNotification((event) => {
      if (
        event.method === "thread/archived" ||
        event.method === "thread/deleted"
      ) {
        const ids =
          event.method === "thread/deleted"
            ? descendantIds(this.state, event.params.threadId)
            : [event.params.threadId];
        for (const id of ids) {
          this.hiddenServerIds.add(id);
          this.historySynced.delete(id);
        }
      }
      if (event.method === "thread/reverted") {
        void this.syncReverted(event.params.threadId);
        return;
      }
      if (event.method === "thread/unarchived")
        this.hiddenServerIds.delete(event.params.threadId);
      let next = sessionNotification(
        this.state,
        event,
        this.completedNotifications,
        this.foreground && this.pageVisible && this.pageFocused,
      );
      if (event.method === "thread/started") {
        const id = event.params.thread.id;
        if (this.creatingDrafts.size) this.deferredStartedIds.add(id);
        else if (this.visibleServerId(id))
          next = {
            ...next,
            listIds: Array.from(new Set([id, ...next.listIds])),
          };
      }
      this.update(next);
      if (
        event.method === "thread/closed" &&
        this.state.selectedId === event.params.threadId
      )
        this.scheduleHistorySync(
          event.params.threadId,
          this.connection.getSnapshot().epoch,
        );
      if (event.method === "turn/completed")
        void this.syncMetadata(event.params.threadId);
    });
  }
  dismissCompletion(id: string): void {
    this.update({
      ...this.state,
      completionNotifications: this.state.completionNotifications.filter(
        (notice) => notice.id !== id,
      ),
    });
  }
  ensureNotificationMetadata(id: string): Promise<void> {
    if (
      this.state.subagentThreadIds[id] ||
      (this.state.threads[id] && !this.state.notificationMetadataPending[id])
    )
      return Promise.resolve();
    if (!this.state.notificationMetadataPending[id])
      this.update({
        ...this.state,
        notificationMetadataPending: {
          ...this.state.notificationMetadataPending,
          [id]: true,
        },
      });
    return this.syncMetadata(id);
  }
  private syncMetadata(id: string): Promise<void> {
    const key = `metadata:${id}`;
    const running = this.locks.get(key);
    if (running) return running as Promise<void>;
    const epoch = this.connection.getSnapshot().epoch;
    const pending: Promise<void> = (async () => {
      const previous = this.state.threads[id];
      try {
        const { thread } = await this.connection.client.request<{
          thread: Thread;
        }>("thread/read", { threadId: id, includeTurns: false });
        if (!this.current(epoch) || !this.visibleServerId(id)) return;
        const current = this.state.threads[id] ?? placeholderThread(id);
        // Preserve newer streamed content; identity metadata is needed even when
        // completion or a server request arrived before thread/started.
        this.update({
          ...this.state,
          notificationMetadataPending: this.confirmedMetadata([id]),
          threads: {
            ...this.state.threads,
            [id]: {
              ...current,
              source: isSubagentThread(current)
                ? current.source
                : thread.source,
              parentThreadId: current.parentThreadId ?? thread.parentThreadId,
              agentNickname: thread.agentNickname,
              agentRole: thread.agentRole,
              name:
                !previous || current.name === previous.name
                  ? thread.name
                  : current.name,
              preview:
                !previous || current.preview === previous.preview
                  ? thread.preview || current.preview
                  : current.preview,
            },
          },
        });
      } catch {
        // Unknown ownership stays pending; retry or a later metadata snapshot
        // can release main-thread notices without briefly notifying a child.
      } finally {
        if (this.current(epoch)) this.locks.delete(key);
      }
    })();
    this.locks.set(key, pending);
    return pending;
  }
  private locked<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const old = this.locks.get(key);
    if (old) return old as Promise<T>;
    const epoch = this.connection.getSnapshot().epoch;
    const pending = Promise.resolve().then(() => {
      if (!this.current(epoch))
        throw new Error("Connection changed before action started.");
      return operation();
    });
    this.locks.set(key, pending);
    void pending
      .finally(() => {
        if (this.locks.get(key) === pending) this.locks.delete(key);
      })
      .catch(() => {});
    return pending;
  }
  // Navigation has no local error surface; action callers present their own errors.
  private performGlobally<T>(operation: (epoch: number) => Promise<T>) {
    return this.perform(operation, true);
  }
  private async perform<T>(
    operation: (epoch: number) => Promise<T>,
    reportGlobally = false,
  ): Promise<T> {
    const epoch = this.connection.getSnapshot().epoch;
    this.actions++;
    this.update({ ...this.state, loading: true, error: null });
    try {
      return await operation(epoch);
    } catch (error) {
      if (reportGlobally && epoch === this.connection.getSnapshot().epoch)
        this.update({ ...this.state, error: errorMessage(error) });
      throw error;
    } finally {
      if (epoch === this.connection.getSnapshot().epoch) {
        this.actions--;
        this.update({ ...this.state, loading: this.actions > 0 });
      }
    }
  }
  private current(epoch: number): boolean {
    return this.connection.getSnapshot().epoch === epoch;
  }
  private hydrate(
    thread: Thread,
    epoch: number,
    resumed = false,
    listed = true,
  ): void {
    if (this.current(epoch)) {
      this.historySynced.delete(thread.id);
      this.update({
        ...this.state,
        ...mergeThread(this.state, thread, resumed),
        notificationMetadataPending: this.confirmedMetadata([thread.id]),
        threadAccess: { ...this.state.threadAccess, [thread.id]: "editable" },
        listIds: listed
          ? Array.from(new Set([thread.id, ...this.state.listIds]))
          : this.state.listIds,
      });
    }
  }
  async restoreSelected(): Promise<void> {
    const epoch = this.connection.getSnapshot().epoch;
    const id = this.state.selectedId;
    if (!id || this.state.localDrafts[id]) return;
    try {
      await this.locked(`read:${id}`, () => this.syncViewedThread(id, epoch));
      if (this.current(epoch) && this.state.selectedId === id) {
        this.scheduleHistorySync(id, epoch);
      }
    } catch (error) {
      if (this.current(epoch))
        this.update({ ...this.state, historySyncError: errorMessage(error) });
    }
  }
  clearError(): void {
    this.update({ ...this.state, error: null });
  }
  refresh = (): Promise<void> => this.locked("list", () => this.list(false));
  loadMore = (): Promise<void> =>
    this.state.nextCursor
      ? this.locked("list", () => this.list(true))
      : Promise.resolve();
  private list(append: boolean): Promise<void> {
    const cursor = append ? this.state.nextCursor : null;
    const sectionFilter = this.state.sectionFilter;
    const sectionGeneration = this.sectionGeneration;
    return this.performGlobally(async (epoch) => {
      const previous = this.state.threads;
      const result = await this.connection.client.request<{
        data: Thread[];
        nextCursor: string | null;
      }>("thread/list", {
        sourceKinds: ROOT_THREAD_SOURCES,
        ...(sectionFilter === "all"
          ? {}
          : {
              sectionId: sectionFilter === "unsectioned" ? null : sectionFilter,
            }),
        limit: 50,
        sortKey: "updated_at",
        sortDirection: "desc",
        ...(cursor ? { cursor } : {}),
      });
      if (
        !this.current(epoch) ||
        sectionGeneration !== this.sectionGeneration ||
        sectionFilter !== this.state.sectionFilter
      )
        return;
      const received = result.data.filter(
        (thread) =>
          this.visibleServerId(thread.id) &&
          this.state.threads[thread.id] === previous[thread.id],
      );
      const merged = received.reduce(
        (state, thread) =>
          this.state.threads[thread.id] === previous[thread.id]
            ? mergeThread(
                state,
                this.canWrite(thread.id) &&
                  previous[thread.id] &&
                  thread.updatedAt <= previous[thread.id].updatedAt
                  ? { ...thread, status: previous[thread.id].status }
                  : thread,
              )
            : state,
        this.state as ConversationState,
      );
      this.update({
        ...this.state,
        ...merged,
        notificationMetadataPending: this.confirmedMetadata(
          received.map((thread) => thread.id),
        ),
        listIds: Array.from(
          new Set([
            ...(append ? this.state.listIds : []),
            ...result.data
              .map((thread) => thread.id)
              .filter((id) => this.visibleServerId(id)),
          ]),
        ),
        nextCursor: result.nextCursor,
      });
    });
  }
  clearSelection(): void {
    this.historySync.stop();
    this.selectionGeneration++;
    this.update({
      ...this.state,
      selectedId: null,
      openingId: null,
      error: null,
    });
  }
  open(id: string): Promise<void> {
    id = this.resolveId(id);
    if (
      this.state.selectedId === id &&
      this.state.threads[id] &&
      !this.state.openingId &&
      !this.state.error &&
      !this.state.historySyncError
    )
      return Promise.resolve();
    if (
      this.connection.getSnapshot().status !== "connected" &&
      this.state.threads[id]
    ) {
      this.historySync.stop();
      this.selectionGeneration++;
      this.update({
        ...clearCompletion(this.state, id),
        selectedId: id,
        openingId: null,
        error: null,
        historySyncError: null,
      });
      return Promise.resolve();
    }
    if (this.state.localDrafts[id]) {
      this.historySync.stop();
      this.selectionGeneration++;
      this.update({
        ...this.state,
        selectedId: id,
        openingId: null,
        error: null,
        historySyncError: null,
      });
      return Promise.resolve();
    }
    // A previously loaded conversation can be displayed while its history refreshes.
    if (this.historySynced.has(id) && this.state.threads[id]) {
      this.historySync.stop();
      const generation = ++this.selectionGeneration;
      const epoch = this.connection.getSnapshot().epoch;
      this.update({
        ...clearCompletion(this.state, id),
        selectedId: id,
        openingId: null,
        error: null,
        historySyncError: null,
      });
      const selected = () =>
        this.current(epoch) &&
        this.selectionGeneration === generation &&
        this.state.selectedId === id;
      if (!this.canWrite(id))
        void this.locked(`read:${id}`, () => this.syncViewedThread(id, epoch))
          .catch((error) => {
            if (selected())
              this.update({
                ...this.state,
                historySyncError: errorMessage(error),
              });
          })
          .finally(() => {
            if (selected()) this.scheduleHistorySync(id, epoch);
          });
      return Promise.resolve();
    }
    const pending = this.locks.get(`read:${id}`);
    if (pending && this.state.selectedId === id)
      return pending as Promise<void>;
    this.historySync.stop();
    if (!this.state.threadAccess[id]) this.setAccess(id, "viewing");
    this.selectionGeneration++;
    this.update({
      ...clearCompletion(this.state, id),
      selectedId: id,
      openingId: id,
    });
    return this.locked(`read:${id}`, () =>
      this.performGlobally(async (epoch) => {
        const before = this.state.threads[id];
        let thread: Thread;
        try {
          thread = await this.readHistory(id, epoch);
        } catch (error) {
          if (!this.current(epoch)) return;
          throw error;
        }
        if (!this.current(epoch)) return;
        const merged = this.mergeRead(thread, before);
        if (merged) {
          this.recordHistory(thread);
          this.update({
            ...this.state,
            ...merged,
            listIds: Array.from(new Set([id, ...this.state.listIds])),
          });
        }
        if (this.current(epoch) && this.state.selectedId === id) {
          this.scheduleHistorySync(id, epoch);
        }
      }),
    ).finally(() => {
      if (this.state.openingId === id)
        this.update({ ...this.state, openingId: null });
    });
  }
  create(options: ThreadStartParams = {}): Promise<Thread> {
    return this.locked("create", async () => {
      this.historySync.stop();
      this.selectionGeneration++;
      this.update(createDraft(this.state, options));
      return this.state.threads[this.state.selectedId!];
    });
  }
  discardDraft(id: string): void {
    const draft = this.state.localDrafts[id];
    if (!draft) return;
    if (this.locks.has(`send:${id}`))
      throw new Error("正在发送，请等待发送结束后再删除草稿。");
    let next = removeDraft(this.state, id);
    const acceptedServerId =
      draft.serverId && next.threads[draft.serverId]?.turns.length
        ? draft.serverId
        : undefined;
    if (draft.serverId && !acceptedServerId) {
      this.hiddenServerIds.add(draft.serverId);
      next = removeThread(next, draft.serverId);
      void this.connection.client
        .request("thread/unsubscribe", { threadId: draft.serverId })
        .catch(() => {});
    }
    if (this.state.selectedId === id) {
      this.historySync.stop();
      this.selectionGeneration++;
    }
    this.update({
      ...next,
      listIds: acceptedServerId
        ? Array.from(new Set([acceptedServerId, ...next.listIds]))
        : next.listIds,
    });
  }

  private async ensureDraftThread(
    id: string,
    epoch: number,
    options: Omit<Partial<TurnStartParams>, "threadId" | "input">,
  ): Promise<string> {
    const draft = this.state.localDrafts[id];
    if (!draft) throw new Error("草稿已移除，请重新新建会话。");
    if (draft.serverId) return draft.serverId;
    const creating = Symbol(id);
    this.creatingDrafts.add(creating);
    try {
      const { thread } = await this.connection.client.request<{
        thread: Thread;
      }>("thread/start", {
        ...draft.options,
        ...(options.model ? { model: options.model } : {}),
        ...(options.approvalPolicy
          ? { approvalPolicy: options.approvalPolicy }
          : {}),
      });
      if (!this.current(epoch)) throw new Error("连接已改变，消息未发送。");
      this.update({
        ...this.state,
        localDrafts: {
          ...this.state.localDrafts,
          [id]: { ...draft, serverId: thread.id },
        },
        listIds: this.state.listIds.filter((entry) => entry !== thread.id),
      });
      this.hydrate(thread, epoch, false, false);
      return thread.id;
    } finally {
      this.creatingDrafts.delete(creating);
      if (this.current(epoch) && !this.creatingDrafts.size) {
        const ids = [...this.deferredStartedIds].filter((entry) =>
          this.visibleServerId(entry),
        );
        this.deferredStartedIds.clear();
        if (ids.length)
          this.update({
            ...this.state,
            listIds: Array.from(new Set([...ids, ...this.state.listIds])),
          });
      }
    }
  }
  private promoteDraft(
    id: string,
    serverId: string,
    beforePromote?: (serverId: string) => void,
  ): void {
    // Move the latest draft before exposing the new ID to the UI.
    beforePromote?.(serverId);
    this.update(
      promoteDraft(
        this.state,
        id,
        serverId,
        this.foreground && this.pageVisible && this.pageFocused,
      ),
    );
  }

  fork(id: string, lastTurnId?: string): Promise<Thread> {
    if (this.state.localDrafts[id])
      return Promise.reject(new Error("草稿尚未发送，无法分叉会话。"));
    return this.locked(`fork:${id}`, () => {
      const source = this.state.threads[id];
      if (source?.status.type === "active" || this.activeTurn(id))
        throw new Error("请等待当前会话执行结束后再回滚或分叉。");
      this.historySync.stop();
      const generation = ++this.selectionGeneration;
      return this.perform(async (epoch) => {
        const { thread } = await this.connection.client.request<{
          thread: Thread;
        }>("thread/fork", {
          threadId: id,
          ...(lastTurnId ? { lastTurnId } : {}),
        });
        this.hydrate(thread, epoch);
        if (this.current(epoch) && generation === this.selectionGeneration)
          this.update({ ...this.state, selectedId: thread.id });
        return thread;
      });
    });
  }
  revert(
    id: string,
    beforeTurnId: string,
    onConfirmed?: (turn: Turn) => void,
  ): Promise<void> {
    return this.locked(`revert:${id}`, () =>
      this.perform(async (epoch) => {
        const source = this.state.threads[id];
        if (!source) throw new Error("会话尚未加载。");
        if (source.status.type === "active" || this.activeTurn(id))
          throw new Error("请等待当前会话执行结束后再回滚。");

        if (source.historyMode !== "paginated")
          throw new Error("此会话使用旧格式历史，不支持 thread/revert 回滚。");
        const index = source.turns.findIndex(
          (turn) => turn.id === beforeTurnId,
        );
        if (index < 0) throw new Error("未找到要回滚的轮次，请刷新会话。");
        await this.activate(id);
        if (!this.current(epoch))
          throw new Error("连接已改变，回滚未执行。请重新连接后重试。");
        if (!this.canWrite(id)) {
          if (this.state.threadAccess[id] === "occupied")
            throw new Error(
              "无法回滚：此会话的写入权限由其他客户端持有。请先在原客户端释放或关闭会话，再重试回滚。",
            );
          throw new Error("未能取得会话写入权限，回滚未执行。请重试。");
        }
        if (conversationExecuting(this.state.threads[id]))
          throw new Error("请等待当前会话执行结束后再回滚。");
        const { thread } = await this.writeRequest<{
          thread: Thread;
        }>(id, epoch, "thread/revert", { threadId: id, beforeTurnId });
        if (!this.current(epoch)) return;
        // History merging preserves old turns; replace explicitly after a successful revert.
        // Keep the confirmed prefix visible even if the subsequent history read fails.
        const diffs = { ...this.state.diffs };
        const plans = { ...this.state.plans };
        const fileOutputs = { ...this.state.fileOutputs };
        const unreadCompleted = { ...this.state.unreadCompleted };
        const completedItems = { ...this.state.completedItems };
        const finished = { ...this.state.finishedTurns[id] };
        for (const turn of source.turns.slice(index)) delete finished[turn.id];
        for (const turn of source.turns.slice(index))
          for (const item of turn.items) delete completedItems[item.id];
        diffs[id] = { ...diffs[id] };
        plans[id] = { ...plans[id] };
        for (const turn of source.turns.slice(index)) {
          delete diffs[id][turn.id];
          delete plans[id][turn.id];
        }
        delete fileOutputs[id];
        delete unreadCompleted[id];
        this.update({
          ...this.state,
          diffs,
          plans,
          fileOutputs,
          unreadCompleted,
          completedItems,
          finishedTurns: { ...this.state.finishedTurns, [id]: finished },
          completionNotifications: this.state.completionNotifications.filter(
            (notice) => notice.threadId !== id,
          ),
          threads: {
            ...this.state.threads,
            [id]: { ...thread, turns: source.turns.slice(0, index) },
          },
        });
        onConfirmed?.(source.turns[index]);
        try {
          const history = await this.readHistory(id, epoch);
          if (this.current(epoch))
            this.update({
              ...this.state,
              historySyncError: null,
              ...mergeThread(this.state, history),
            });
        } catch (error) {
          if (this.current(epoch))
            this.update({
              ...this.state,
              historySyncError: `回滚已完成，历史暂未刷新：${errorMessage(error)}`,
            });
        }
      }),
    );
  }
  rename(id: string, name: string): Promise<void> {
    if (this.state.localDrafts[id]) {
      this.update({
        ...this.state,
        threads: {
          ...this.state.threads,
          [id]: { ...this.state.threads[id], name },
        },
      });
      return Promise.resolve();
    }

    return this.locked(`rename:${id}`, () =>
      this.perform(async (epoch) => {
        await this.connection.client.request("thread/name/set", {
          threadId: id,
          name,
        });
        if (this.current(epoch) && this.state.threads[id])
          this.update({
            ...this.state,
            threads: {
              ...this.state.threads,
              [id]: { ...this.state.threads[id], name },
            },
          });
      }),
    );
  }
  archive(id: string, reportGlobally = false): Promise<void> {
    if (this.state.localDrafts[id]) {
      this.discardDraft(id);
      return Promise.resolve();
    }
    return this.locked(`archive:${id}`, () =>
      this.perform(async (epoch) => {
        await this.connection.client.request("thread/archive", {
          threadId: id,
        });
        if (!this.current(epoch)) return;
        this.hiddenServerIds.add(id);
        this.update(removeThread(this.state, id));
      }, reportGlobally),
    );
  }
  readForExport(id: string): Promise<Thread> {
    if (this.state.localDrafts[id])
      return Promise.reject(new Error("草稿尚未发送，无法导出会话。"));
    return this.locked(`export:${id}`, () =>
      this.perform((epoch) => this.readHistory(id, epoch)),
    );
  }
  private async readHistory(
    id: string,
    epoch: number,
    incremental = false,
    metadata?: Thread,
  ): Promise<Thread> {
    const revision = this.historyRevisions.get(id) ?? 0;
    const thread = await readHistory(
      this.connection.client,
      id,
      this.state.threads[id],
      () => this.current(epoch),
      incremental,
      metadata,
    );
    if (
      this.current(epoch) &&
      revision !== (this.historyRevisions.get(id) ?? 0)
    )
      return this.readHistory(id, epoch);
    return thread;
  }

  private async syncReverted(id: string): Promise<void> {
    const epoch = this.connection.getSnapshot().epoch;
    const revision = (this.historyRevisions.get(id) ?? 0) + 1;
    this.historyRevisions.set(id, revision);
    this.historySynced.delete(id);
    const old = this.state.threads[id];
    if (!old || !this.visibleServerId(id)) return;
    const cleared = removeThread(this.state, id);
    this.update({
      ...cleared,
      threads: { ...cleared.threads, [id]: { ...old, turns: [] } },
      selectedId: this.state.selectedId,
      listIds: this.state.listIds,
      threadAccess: this.state.threadAccess,
      threadSettings: this.state.threadSettings,
    });
    try {
      const thread = await this.readHistory(id, epoch);
      if (
        !this.current(epoch) ||
        this.historyRevisions.get(id) !== revision ||
        !this.visibleServerId(id)
      )
        return;
      const merged = this.mergeRead(thread, this.state.threads[id]);
      if (merged) this.update({ ...merged, historySyncError: null });
    } catch (error) {
      if (this.current(epoch) && this.historyRevisions.get(id) === revision)
        this.update({
          ...this.state,
          historySyncError: `会话已回滚，历史暂未刷新：${errorMessage(error)}`,
        });
    }
  }

  async setPinned(id: string, isPinned: boolean): Promise<void> {
    return this.locked(`pin:${id}`, () =>
      this.perform(async (epoch) => {
        try {
          const { thread } = await this.connection.client.request<{
            thread: ManagedThread;
          }>("thread/metadata/update", { threadId: id, isPinned });
          if (!this.current(epoch) || !this.visibleServerId(id)) return;
          if (thread.isPinned !== isPinned)
            throw new Error("当前服务端不支持持久置顶，未更改会话。");
          const old = this.state.threads[id];
          if (old)
            this.update({
              ...this.state,
              threads: {
                ...this.state.threads,
                [id]: { ...old, isPinned } as ManagedThread,
              },
            });
        } catch (error) {
          throw managementError(error);
        }
      }),
    );
  }
  async loadSections(): Promise<void> {
    const epoch = this.connection.getSnapshot().epoch;
    const read = ++this.sectionRead;
    this.update({ ...this.state, sectionsLoading: true, sectionsError: null });
    try {
      const sections: ThreadSection[] = [];
      const seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const page: { data: ThreadSection[]; nextCursor: string | null } =
          await this.connection.client.request("threadSection/list", {
            limit: 100,
            ...(cursor ? { cursor } : {}),
          });
        if (!this.current(epoch) || read !== this.sectionRead) return;
        sections.push(...page.data);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor))
          throw new Error("分区分页异常，请重试。");
        if (cursor) seen.add(cursor);
      } while (cursor);
      this.update({ ...this.state, sections, sectionsLoading: false });
    } catch (error) {
      if (this.current(epoch) && read === this.sectionRead)
        this.update({
          ...this.state,
          sectionsLoading: false,
          sectionsError: managementError(error).message,
        });
    }
  }
  async saveSection(name: string, sectionId?: string): Promise<void> {
    if (!name.trim()) throw new Error("请填写分区名称。");
    return this.perform(async (epoch) => {
      try {
        const { section } = await this.connection.client.request<{
          section: ThreadSection;
        }>(sectionId ? "threadSection/update" : "threadSection/create", {
          name: name.trim(),
          ...(sectionId ? { sectionId } : {}),
        });
        if (!this.current(epoch)) return;
        this.sectionRead++;
        this.update({
          ...this.state,
          sectionsLoading: false,
          sections: [
            ...this.state.sections.filter((entry) => entry.id !== section.id),
            section,
          ],
          threads: Object.fromEntries(
            Object.entries(this.state.threads).map(([id, thread]) => [
              id,
              thread.section?.id === section.id
                ? { ...thread, section }
                : thread,
            ]),
          ),
        });
      } catch (error) {
        throw managementError(error);
      }
    });
  }
  async deleteSection(sectionId: string): Promise<void> {
    return this.perform(async (epoch) => {
      try {
        await this.connection.client.request("threadSection/delete", {
          sectionId,
        });
        if (!this.current(epoch)) return;
        this.sectionRead++;
        this.update({
          ...this.state,
          sectionsLoading: false,
          sections: this.state.sections.filter(
            (section) => section.id !== sectionId,
          ),
          threads: Object.fromEntries(
            Object.entries(this.state.threads).map(([id, thread]) => [
              id,
              thread.section?.id === sectionId
                ? { ...thread, section: null, sectionEnteredAt: null }
                : thread,
            ]),
          ),
        });
        if (this.state.sectionFilter === sectionId)
          await this.setSectionFilter("all");
      } catch (error) {
        throw managementError(error);
      }
    });
  }
  async moveSection(id: string, sectionId: string | null): Promise<void> {
    return this.perform(async (epoch) => {
      try {
        await this.connection.client.request("thread/section/move", {
          threadId: id,
          sectionId,
        });
        if (!this.current(epoch) || !this.visibleServerId(id)) return;
        const thread = this.state.threads[id];
        const section =
          this.state.sections.find((entry) => entry.id === sectionId) ?? null;
        if (thread)
          this.update({
            ...this.state,
            threads: { ...this.state.threads, [id]: { ...thread, section } },
          });
        await this.refresh();
      } catch (error) {
        throw managementError(error);
      }
    });
  }
  setSectionFilter(sectionFilter: string): Promise<void> {
    this.sectionGeneration++;
    this.update({
      ...this.state,
      sectionFilter,
      listIds: [],
      nextCursor: null,
    });
    return this.list(false);
  }
  delete(id: string): Promise<void> {
    return this.locked(`delete:${id}`, () =>
      this.perform(async (epoch) => {
        try {
          await this.connection.client.request("thread/delete", {
            threadId: id,
          });
          if (!this.current(epoch)) return;
          const ids = descendantIds(this.state, id);
          for (const child of ids) {
            this.hiddenServerIds.add(child);
            this.historySynced.delete(child);
          }
          this.update(ids.reduce(removeThread, this.state));
        } catch (error) {
          throw managementError(error);
        }
      }),
    );
  }
  threadRequest<T>(
    id: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    if (this.state.localDrafts[id])
      return Promise.reject(new Error("请先发送第一条消息创建会话。"));
    return this.locked(`write:${id}`, () =>
      this.perform(async (epoch) => {
        const target = await this.ensureWritableTarget(id, epoch, {});
        return this.writeRequest<T>(target, epoch, method, {
          ...params,
          threadId: target,
        });
      }),
    );
  }
  startReview(id: string, target: ReviewTarget): Promise<ReviewStartResponse> {
    return this.locked(`send:${id}`, () =>
      this.perform(async (epoch) => {
        if (this.state.localDrafts[id])
          throw new Error("请先发送第一条消息创建会话。");
        const targetId = await this.ensureWritableTarget(id, epoch, {});
        if (this.activeTurn(targetId)) throw new TurnBusyError();
        const result = await this.writeRequest<ReviewStartResponse>(
          targetId,
          epoch,
          "review/start",
          { threadId: targetId, target, delivery: "inline" },
        );
        if (this.current(epoch))
          this.update({
            ...this.state,
            ...reduceNotification(this.state, {
              method: "turn/started",
              params: { threadId: result.reviewThreadId, turn: result.turn },
            }),
          });
        return result;
      }),
    );
  }

  activeTurn(id: string): Turn | undefined {
    return [...(this.state.threads[id]?.turns ?? [])]
      .reverse()
      .find((turn) => turn.status === "inProgress");
  }
  private async writeRequest<T>(
    id: string,
    epoch: number,
    method: string,
    params: unknown,
  ): Promise<T> {
    const reverting = method === "thread/revert";
    if (!this.current(epoch))
      throw new Error(
        reverting ? "连接已改变，回滚未执行。" : "连接已改变，消息未发送。",
      );
    if (!this.canWrite(id))
      throw new Error(
        reverting
          ? "会话写入权限已失效，回滚未执行。请重新获取权限后重试。"
          : "会话写入权限已失效，消息未发送，草稿已保留。",
      );
    try {
      return await this.connection.client.request<T>(method, params);
    } catch (error) {
      if (
        this.current(epoch) &&
        /active writer|not loaded|not resumed/i.test(errorMessage(error))
      ) {
        this.setAccess(
          id,
          /active writer/i.test(errorMessage(error)) ? "occupied" : "viewing",
        );
        if (this.state.selectedId === id) this.scheduleHistorySync(id, epoch);
        if (reverting)
          throw new Error(
            /active writer/i.test(errorMessage(error))
              ? "无法回滚：此会话的写入权限由其他客户端持有。请先在原客户端释放或关闭会话，再重试回滚。"
              : "会话写入权限已失效，回滚未执行。请重试。",
            { cause: error },
          );
      }
      throw error;
    }
  }
  private async ensureWritableTarget(
    id: string,
    epoch: number,
    options: Omit<Partial<TurnStartParams>, "threadId" | "input">,
  ): Promise<string> {
    const draftId = this.state.localDrafts[id] ? id : undefined;
    let targetId = draftId
      ? await this.ensureDraftThread(draftId, epoch, options)
      : id;
    const resume =
      this.locks.get(`activate:${targetId}`) ??
      this.locks.get(`read:${targetId}`);
    if (resume) await resume;
    if (!this.current(epoch))
      throw new Error("Connection changed while resuming thread.");
    if (!this.canWrite(targetId)) {
      try {
        await this.activate(targetId);
      } catch (error) {
        // Only a confirmed missing, never-sent draft can be recreated.
        // Network/auth errors and uncertain accepted turns must not create duplicates.
        const missing =
          /no such thread|thread[^\n]*(?:not found|does not exist)|会话不存在/i.test(
            errorMessage(error),
          );
        if (
          !this.current(epoch) ||
          !draftId ||
          !missing ||
          this.state.threads[targetId]?.turns.length
        )
          throw error;
        const draft = this.state.localDrafts[draftId];
        this.hiddenServerIds.add(targetId);
        const threads = { ...this.state.threads };
        delete threads[targetId];
        this.update({
          ...this.state,
          threads,
          error: null,
          localDrafts: {
            ...this.state.localDrafts,
            [draftId]: { options: draft.options },
          },
        });
        targetId = await this.ensureDraftThread(draftId, epoch, options);
      }
    }
    if (!this.current(epoch)) throw new Error("连接已改变，消息未发送。");
    if (!this.canWrite(targetId))
      throw new Error(
        "此会话由其他客户端控制，只能查看；消息未发送，草稿已保留。",
      );

    if (draftId) {
      const name = this.state.threads[draftId]?.name;
      if (name && name !== this.state.threads[targetId]?.name)
        await this.rename(targetId, name);
    }
    return targetId;
  }
  private async submitTurn(
    id: string,
    epoch: number,
    input: UserInput[],
    options: Omit<Partial<TurnStartParams>, "threadId" | "input">,
    mode: "auto" | "start" = "auto",
  ): Promise<void> {
    const active = this.activeTurn(id);
    if (active && mode === "start") throw new TurnBusyError();
    if (active)
      await this.writeRequest(id, epoch, "turn/steer", {
        threadId: id,
        expectedTurnId: active.id,
        input,
      });
    else {
      const result = await this.writeRequest<{ turn: Turn }>(
        id,
        epoch,
        "turn/start",
        { ...options, threadId: id, input },
      );
      if (this.current(epoch))
        this.update({
          ...this.state,
          ...reduceNotification(this.state, {
            method: "turn/started",
            params: { threadId: id, turn: result.turn },
          }),
        });
    }
    if (!this.current(epoch))
      throw new Error("连接已改变，请先核实消息是否已发送。");
    const thread = this.state.threads[id];
    const preview = input
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n")
      .trim();
    if (this.current(epoch) && thread && !thread.preview && preview)
      this.update({
        ...this.state,
        threads: {
          ...this.state.threads,
          [id]: { ...thread, preview },
        },
      });
  }
  send(
    id: string,
    input: UserInput[],
    options: Omit<Partial<TurnStartParams>, "threadId" | "input"> = {},
    beforePromote?: (serverId: string) => void,
    mode: "auto" | "start" = "auto",
  ): Promise<string> {
    id = this.resolveId(id);
    const draftId = this.state.localDrafts[id] ? id : undefined;
    if (
      !input.length ||
      input.every((item) => item.type === "text" && !item.text.trim())
    )
      return Promise.resolve(id);
    return this.locked(`send:${id}`, () =>
      this.perform(async (epoch) => {
        try {
          if (draftId) this.setAccess(draftId, "activating");
          const targetId = await this.ensureWritableTarget(id, epoch, options);
          await this.submitTurn(targetId, epoch, input, options, mode);
          if (!this.current(epoch))
            throw new Error("连接已改变，请先核实消息是否已发送。");
          if (draftId) this.promoteDraft(draftId, targetId, beforePromote);
          return targetId;
        } finally {
          if (
            draftId &&
            this.current(epoch) &&
            this.state.localDrafts[draftId]
          ) {
            const serverId = this.state.localDrafts[draftId].serverId;
            this.setAccess(
              draftId,
              serverId && this.state.threadAccess[serverId] === "occupied"
                ? "occupied"
                : "viewing",
            );
          }
        }
      }),
    );
  }
  steer(id: string, input: UserInput[], expectedTurnId: string): Promise<void> {
    return this.locked(`send:${id}`, () =>
      this.perform(async (epoch) => {
        if (this.activeTurn(id)?.id !== expectedTurnId)
          throw new TurnBusyError();
        await this.writeRequest(id, epoch, "turn/steer", {
          threadId: id,
          expectedTurnId,
          input,
        });
        if (!this.current(epoch))
          throw new Error("连接已改变，请先核实消息是否已发送。");
      }),
    );
  }
  interrupt(id: string): Promise<void> {
    if (!this.canWrite(id))
      return Promise.reject(
        new Error("此会话由其他客户端控制，无法停止执行。"),
      );
    const turn = this.activeTurn(id);
    return turn
      ? this.locked(`interrupt:${id}`, () =>
          this.perform(async (epoch) => {
            await this.writeRequest(id, epoch, "turn/interrupt", {
              threadId: id,
              turnId: turn.id,
            });
          }),
        )
      : Promise.resolve();
  }
}
