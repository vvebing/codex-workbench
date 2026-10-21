import { referenceAttachmentType } from "./thread-tools-model";
import { Store, errorMessage } from "../../lib/store";
import type { ConnectionStore } from "../connection/store";
import type { SessionsStore } from "../sessions/store";
import type { ThreadGoal } from "../../generated/v2/ThreadGoal";
import type { ThreadGoalGetResponse } from "../../generated/v2/ThreadGoalGetResponse";
import type { ThreadGoalSetParams } from "../../generated/v2/ThreadGoalSetParams";
import type { ThreadGoalSetResponse } from "../../generated/v2/ThreadGoalSetResponse";
import type { ThreadAttachment } from "../../generated/v2/ThreadAttachment";
import type { ThreadAttachmentListResponse } from "../../generated/v2/ThreadAttachmentListResponse";
import type { ThreadAttachmentAddParams } from "../../generated/v2/ThreadAttachmentAddParams";
import type { ThreadAttachmentAddResponse } from "../../generated/v2/ThreadAttachmentAddResponse";
import type { ThreadAttachmentOwner } from "../../generated/v2/ThreadAttachmentOwner";
import type { ThreadAttachmentOwnerListResponse } from "../../generated/v2/ThreadAttachmentOwnerListResponse";
import type { ReviewTarget } from "../../generated/v2/ReviewTarget";

interface ToolsState {
  goal: ThreadGoal | null;
  goalLoaded: boolean;
  goalError: string | null;
  attachments: ThreadAttachment[];
  attachmentCursor: string | null;
  attachmentError: string | null;
  owners: ThreadAttachmentOwner[] | null;
  ownerCursor: string | null;
  ownerIdentity: { attachmentType: string; identityKey: string } | null;
  busy: boolean;
  error: string | null;
  message: string | null;
}
export class ThreadToolsStore extends Store<ToolsState> {
  private active = false;
  private generation = 0;
  private goalRevision = 0;
  private attachmentRevision = 0;
  constructor(
    readonly threadId: string,
    private epoch: number,
    private connection: ConnectionStore,
    private sessions: Pick<SessionsStore, "threadRequest" | "startReview">,
  ) {
    super({
      goal: null,
      goalLoaded: false,
      goalError: null,
      attachments: [],
      attachmentCursor: null,
      attachmentError: null,
      owners: null,
      ownerCursor: null,
      ownerIdentity: null,
      busy: false,
      error: null,
      message: null,
    });
  }
  private current(generation = this.generation): boolean {
    const state = this.connection.getSnapshot();
    return (
      this.active &&
      generation === this.generation &&
      state.epoch === this.epoch &&
      state.status === "connected"
    );
  }
  start(): () => void {
    this.active = true;
    this.update({ ...this.state, busy: false });
    const off = this.connection.client.onNotification((event) => {
      if (!this.current()) return;
      if (
        event.method === "thread/goal/updated" &&
        event.params.threadId === this.threadId
      ) {
        this.goalRevision++;
        this.update({
          ...this.state,
          goal: event.params.goal,
          goalLoaded: true,
          goalError: null,
        });
      } else if (
        event.method === "thread/goal/cleared" &&
        event.params.threadId === this.threadId
      ) {
        this.goalRevision++;
        this.update({
          ...this.state,
          goal: null,
          goalLoaded: true,
          goalError: null,
        });
      } else if (
        event.method === "thread/attachment/updated" &&
        event.params.threadId === this.threadId
      )
        void this.loadAttachments();
    });
    void this.loadGoal();
    void this.loadAttachments();
    return () => {
      this.active = false;
      this.generation++;
      off();
    };
  }
  async loadGoal(): Promise<void> {
    if (!this.current()) return;
    const generation = this.generation;
    const revision = ++this.goalRevision;
    try {
      const result =
        await this.connection.client.request<ThreadGoalGetResponse>(
          "thread/goal/get",
          { threadId: this.threadId },
        );
      if (this.current(generation) && revision === this.goalRevision)
        this.update({
          ...this.state,
          goal: result.goal,
          goalLoaded: true,
          goalError: null,
        });
    } catch (error) {
      if (this.current(generation) && revision === this.goalRevision)
        this.update({
          ...this.state,
          goalError: errorMessage(error),
          goalLoaded: true,
        });
    }
  }
  async loadAttachments(more = false): Promise<void> {
    if (!this.current()) return;
    const generation = this.generation;
    const revision = ++this.attachmentRevision;
    const cursor = more ? this.state.attachmentCursor : null;
    try {
      const result =
        await this.connection.client.request<ThreadAttachmentListResponse>(
          "thread/attachment/list",
          { threadId: this.threadId, cursor, limit: 50 },
        );
      if (this.current(generation) && revision === this.attachmentRevision)
        this.update({
          ...this.state,
          attachments: more
            ? [
                ...this.state.attachments,
                ...result.data.filter(
                  (item) =>
                    !this.state.attachments.some((old) => old.id === item.id),
                ),
              ]
            : result.data,
          attachmentCursor: result.nextCursor,
          attachmentError: null,
        });
    } catch (error) {
      if (this.current(generation) && revision === this.attachmentRevision)
        this.update({ ...this.state, attachmentError: errorMessage(error) });
    }
  }
  private async action(
    operation: (current: () => boolean) => Promise<void>,
  ): Promise<void> {
    if (!this.current() || this.state.busy) return;
    const generation = this.generation;
    this.update({ ...this.state, busy: true, error: null, message: null });
    try {
      await operation(() => this.current(generation));
    } catch (error) {
      if (this.current(generation))
        this.update({ ...this.state, error: errorMessage(error) });
    } finally {
      if (this.current(generation)) this.update({ ...this.state, busy: false });
    }
  }
  setGoal(params: ThreadGoalSetParams): Promise<void> {
    return this.action(async (current) => {
      const result = await this.sessions.threadRequest<ThreadGoalSetResponse>(
        this.threadId,
        "thread/goal/set",
        params,
      );
      if (current()) {
        this.goalRevision++;
        this.update({
          ...this.state,
          goal: result.goal,
          goalLoaded: true,
          goalError: null,
          message: "目标已保存。",
        });
      }
    });
  }
  clearGoal(): Promise<void> {
    return this.action(async (current) => {
      await this.sessions.threadRequest(this.threadId, "thread/goal/clear", {
        origin: "user",
      });
      if (current()) {
        this.goalRevision++;
        this.update({
          ...this.state,
          goal: null,
          goalLoaded: true,
          goalError: null,
          message: "目标已清除。",
        });
      }
    });
  }
  startReview(target: ReviewTarget): Promise<void> {
    return this.action(async (current) => {
      await this.sessions.startReview(this.threadId, target);
      if (current())
        this.update({
          ...this.state,
          message: "审查已开始，进度显示在会话中。",
        });
    });
  }
  addReference(params: ThreadAttachmentAddParams): Promise<void> {
    return this.action(async (current) => {
      const result =
        await this.sessions.threadRequest<ThreadAttachmentAddResponse>(
          this.threadId,
          "thread/attachment/add",
          params,
        );
      if (current()) {
        this.update({
          ...this.state,
          message:
            result.outcome === "created"
              ? "参考资料已保存。"
              : "此参考资料已存在。",
        });
        await this.loadAttachments();
      }
    });
  }
  removeAttachment(attachment: ThreadAttachment): Promise<void> {
    return this.action(async (current) => {
      if (attachment.attachmentType !== referenceAttachmentType)
        throw new Error("外部资料仅供查看，无法在此移除。");
      await this.sessions.threadRequest(
        this.threadId,
        "thread/attachment/remove",
        {
          attachmentType: attachment.attachmentType,
          identityKey: attachment.identityKey,
        },
      );
      if (current()) await this.loadAttachments();
    });
  }
  findOwners(
    identity: { attachmentType: string; identityKey: string },
    more = false,
  ): Promise<void> {
    return this.action(async () => {
      const generation = this.generation;
      const cursor = more ? this.state.ownerCursor : null;
      const result =
        await this.connection.client.request<ThreadAttachmentOwnerListResponse>(
          "thread/attachmentOwner/list",
          {
            attachmentType: identity.attachmentType,
            identityKey: identity.identityKey,
            cursor,
            limit: 50,
            archived: null,
          },
        );
      if (this.current(generation))
        this.update({
          ...this.state,
          owners: more
            ? [...(this.state.owners ?? []), ...result.data]
            : result.data,
          ownerIdentity: {
            attachmentType: identity.attachmentType,
            identityKey: identity.identityKey,
          },
          ownerCursor: result.nextCursor,
        });
    });
  }
}
