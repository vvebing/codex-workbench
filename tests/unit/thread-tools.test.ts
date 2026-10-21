import { describe, expect, it, vi } from "vitest";
import { ThreadToolsStore } from "../../src/features/conversation/thread-tools-store";
import {
  attachmentLabel,
  goalParams,
  referenceAttachmentType,
  referenceParams,
  reviewTarget,
} from "../../src/features/conversation/thread-tools-model";
import type { ConnectionStore } from "../../src/features/connection/store";
import type { SessionsStore } from "../../src/features/sessions/store";
import type { RpcNotification } from "../../src/lib/rpc";
import type { ThreadGoal } from "../../src/generated/v2/ThreadGoal";

const goal: ThreadGoal = {
  threadId: "t",
  objective: "Finish migration",
  status: "active",
  tokenBudget: 100,
  tokensUsed: 12,
  timeUsedSeconds: 3,
  createdAt: 1,
  updatedAt: 2,
};
const reference = {
  id: "a",
  attachmentType: referenceAttachmentType,
  identityKey: "/work/README.md",
  payload: { label: "Readme", location: "/work/README.md" },
  createdAt: 1,
};
function setup(
  handler?: (method: string, params: unknown) => Promise<unknown>,
) {
  let epoch = 1;
  let listener: ((event: RpcNotification) => void) | undefined;
  const request = vi.fn(
    handler ??
      ((method: string) =>
        Promise.resolve(
          method === "thread/goal/get"
            ? { goal }
            : { data: [], nextCursor: null },
        )),
  );
  const connection = {
    getSnapshot: () => ({ epoch, status: "connected" }),
    client: {
      request,
      onNotification: (callback: typeof listener) => {
        listener = callback;
        return () => {
          listener = undefined;
        };
      },
    },
  } as unknown as ConnectionStore;
  const threadRequest = vi.fn(async (_id: string, method: string) =>
    method === "thread/goal/set"
      ? { goal }
      : method === "thread/attachment/add"
        ? { outcome: "created", attachment: reference }
        : {},
  );
  const startReview = vi.fn(async () => ({}));
  const sessions = { threadRequest, startReview } as unknown as Pick<
    SessionsStore,
    "threadRequest" | "startReview"
  >;
  const store = new ThreadToolsStore("t", 1, connection, sessions);
  const stop = store.start();
  return {
    store,
    stop,
    request,
    threadRequest,
    startReview,
    notify: (event: RpcNotification) => listener?.(event),
    disconnect: () => {
      epoch++;
    },
  };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
describe("thread tools parameters", () => {
  it("requires explicit user goal changes and validates objective and budgets", () => {
    expect(goalParams("t", " do work ", "paused", "200")).toEqual({
      threadId: "t",
      objective: "do work",
      status: "paused",
      tokenBudget: 200,
      origin: "user",
    });
    expect(goalParams("t", "work", "active", "").tokenBudget).toBeNull();
    for (const budget of ["0", "-1", "1.2", "Infinity"])
      expect(() => goalParams("t", "work", "active", budget)).toThrow();
    expect(() => goalParams("t", " ", "active", "")).toThrow();
    expect(() => goalParams("t", "x".repeat(4001), "active", "")).toThrow();
  });
  it("builds all review targets without starting a review", () => {
    expect(reviewTarget("uncommittedChanges", "")).toEqual({
      type: "uncommittedChanges",
    });
    expect(reviewTarget("baseBranch", " main ")).toEqual({
      type: "baseBranch",
      branch: "main",
    });
    expect(reviewTarget("commit", "123abc")).toEqual({
      type: "commit",
      sha: "123abc",
      title: null,
    });
    expect(reviewTarget("custom", " inspect auth ")).toEqual({
      type: "custom",
      instructions: "inspect auth",
    });
    expect(() => reviewTarget("commit", " ")).toThrow();
  });
  it("stores references rather than pretending to upload files", () => {
    expect(referenceParams("t", " Readme ", " /work/README.md ")).toEqual({
      threadId: "t",
      attachmentType: referenceAttachmentType,
      identityKey: "/work/README.md",
      payload: { label: "Readme", location: "/work/README.md" },
    });
    expect(attachmentLabel(reference)).toBe("Readme");
    expect(attachmentLabel({ ...reference, payload: null })).toBe(
      reference.identityKey,
    );
    expect(() => referenceParams("t", "", "")).toThrow();
  });
});
describe("thread tools scoped lifecycle", () => {
  it("only reads on mount and reflects goal notifications for the selected thread", async () => {
    const setupResult = setup();
    const { store, notify, threadRequest, startReview, stop } = setupResult;
    await settle();
    expect(store.getSnapshot().goal).toEqual(goal);
    expect(threadRequest).not.toHaveBeenCalled();
    expect(startReview).not.toHaveBeenCalled();
    notify({
      method: "thread/goal/updated",
      params: {
        threadId: "other",
        turnId: null,
        goal: { ...goal, tokensUsed: 90 },
      },
    });
    expect(store.getSnapshot().goal?.tokensUsed).toBe(12);
    notify({
      method: "thread/goal/updated",
      params: {
        threadId: "t",
        turnId: "turn",
        goal: { ...goal, tokensUsed: 22 },
      },
    });
    expect(store.getSnapshot().goal?.tokensUsed).toBe(22);
    notify({ method: "thread/goal/cleared", params: { threadId: "t" } });
    expect(store.getSnapshot().goal).toBeNull();
    stop();
  });
  it("ignores stale reads after new notifications and connection changes", async () => {
    let resolve!: (value: unknown) => void;
    const { store, notify, disconnect, stop } = setup((method) =>
      method === "thread/goal/get"
        ? new Promise((done) => {
            resolve = done;
          })
        : Promise.resolve({ data: [], nextCursor: null }),
    );
    notify({
      method: "thread/goal/updated",
      params: {
        threadId: "t",
        turnId: null,
        goal: { ...goal, status: "paused" },
      },
    });
    resolve({ goal });
    await settle();
    expect(store.getSnapshot().goal?.status).toBe("paused");
    disconnect();
    notify({ method: "thread/goal/cleared", params: { threadId: "t" } });
    expect(store.getSnapshot().goal?.status).toBe("paused");
    stop();
  });
  it("routes explicit writes through sessions readiness and uses the generated owner lookup method", async () => {
    const { store, request, threadRequest, startReview, stop } = setup();
    await settle();
    const params = goalParams("t", goal.objective, "active", "100");
    await store.setGoal(params);
    expect(threadRequest).toHaveBeenCalledWith("t", "thread/goal/set", params);
    await store.clearGoal();
    expect(threadRequest).toHaveBeenCalledWith("t", "thread/goal/clear", {
      origin: "user",
    });
    await store.startReview({ type: "uncommittedChanges" });
    expect(startReview).toHaveBeenCalledWith("t", {
      type: "uncommittedChanges",
    });
    await store.addReference(
      referenceParams("t", "Readme", reference.identityKey),
    );
    await store.removeAttachment({
      ...reference,
      attachmentType: "external/type",
    });
    expect(store.getSnapshot().error).toContain("仅供查看");
    expect(threadRequest).not.toHaveBeenCalledWith(
      "t",
      "thread/attachment/remove",
      expect.objectContaining({ attachmentType: "external/type" }),
    );
    await store.removeAttachment(reference);
    expect(threadRequest).toHaveBeenCalledWith(
      "t",
      "thread/attachment/remove",
      {
        attachmentType: referenceAttachmentType,
        identityKey: reference.identityKey,
      },
    );
    await store.findOwners(reference);
    expect(request).toHaveBeenCalledWith(
      "thread/attachmentOwner/list",
      expect.objectContaining({
        attachmentType: referenceAttachmentType,
        identityKey: reference.identityKey,
        archived: null,
      }),
    );
    stop();
  });
  it("shows unsupported endpoint failures instead of silently hiding them", async () => {
    const { store, stop } = setup(() =>
      Promise.reject(new Error("Method not found")),
    );
    await settle();
    expect(store.getSnapshot().goalError).toBe("Method not found");
    expect(store.getSnapshot().attachmentError).toBe("Method not found");
    stop();
  });
  it("follows attachment cursors and refreshes on update notifications", async () => {
    const { store, request, notify, stop } = setup(async (method, params) =>
      method === "thread/goal/get"
        ? { goal: null }
        : {
            data: [
              (params as { cursor?: string }).cursor
                ? { ...reference, id: "b" }
                : reference,
            ],
            nextCursor: (params as { cursor?: string }).cursor ? null : "page2",
          },
    );
    await settle();
    await store.loadAttachments(true);
    expect(store.getSnapshot().attachments.map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
    expect(request).toHaveBeenCalledWith(
      "thread/attachment/list",
      expect.objectContaining({ cursor: "page2" }),
    );
    notify({
      method: "thread/attachment/updated",
      params: {
        threadId: "t",
        attachmentType: referenceAttachmentType,
        identityKey: reference.identityKey,
        attachmentId: "a",
        operation: "deleted",
      },
    });
    await settle();
    expect(store.getSnapshot().attachments).toHaveLength(1);
    stop();
  });
});

it("ignores action acknowledgement after cleanup/setup replay", async () => {
  const { store, stop, threadRequest } = setup();
  await settle();
  let resolve!: (value: { goal: ThreadGoal }) => void;
  threadRequest.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const saving = store.setGoal(goalParams("t", "old action", "active", ""));
  stop();
  const stopAgain = store.start();
  await settle();
  resolve({ goal: { ...goal, objective: "stale action" } });
  await saving;
  expect(store.getSnapshot().goal?.objective).toBe(goal.objective);
  expect(store.getSnapshot().message).toBeNull();
  expect(store.getSnapshot().busy).toBe(false);
  stopAgain();
});
