import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionStore } from "../../src/features/connection/store";
import { SessionsStore } from "../../src/features/sessions/store";
import { placeholderThread } from "../../src/lib/state";
import type { Turn } from "../../src/generated/v2/Turn";
import type { Thread } from "../../src/generated/v2/Thread";
import type { RpcNotification } from "../../src/lib/rpc";

const turn = (id: string): Turn => ({
  id,
  rootTurnId: null,
  items: [],
  itemsView: "full",
  status: "completed",
  error: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
});
function setup() {
  const connection = new ConnectionStore();
  const state = { ...connection.getSnapshot(), status: "connected" as const };
  vi.spyOn(connection, "getSnapshot").mockImplementation(() => state);
  let notify!: (event: RpcNotification) => void;
  vi.spyOn(connection.client, "onNotification").mockImplementation(
    (listener) => {
      notify = listener;
      return () => {};
    },
  );
  const sessions = new SessionsStore(connection);
  const metadata = (id: string): Thread => ({
    ...placeholderThread(id),
    historyMode: "paginated",
  });
  const request = vi
    .spyOn(connection.client, "request")
    .mockImplementation(async (...[method, params]) => {
      const p = params as { threadId: string; cursor?: string };
      if (method === "thread/read" || method === "thread/resume")
        return { thread: metadata(p.threadId) };
      if (method === "thread/turns/list")
        return {
          data: p.cursor ? [turn("old")] : [turn("recent")],
          nextCursor: p.cursor ? null : "older",
        };
      throw new Error(`Unexpected ${method}`);
    });
  return { connection, sessions, request, state, metadata, notify };
}
afterEach(() => {
  vi.restoreAllMocks();
});
describe("conversation cache and history windows", () => {
  it("keeps project notifications received during the first unknown-thread read and allows later server updates", async () => {
    const { sessions, request, metadata, notify } = setup();
    let finish!: (value: { thread: Thread }) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const opening = sessions.open("a");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    notify({
      method: "thread/project/updated",
      params: { threadId: "a", projectId: "new-project" },
    });
    finish({
      thread: {
        ...metadata("a"),
        projectId: "old-project",
        cwd: "/real-directory",
        name: "real-name",
      },
    });
    await opening;
    expect(sessions.getSnapshot().threads.a).toMatchObject({
      projectId: "new-project",
      cwd: "/real-directory",
      name: "real-name",
    });
    request.mockResolvedValueOnce({
      thread: { ...metadata("a"), projectId: "later-project" },
    });
    await sessions.restoreSelected();
    expect(sessions.getSnapshot().threads.a.projectId).toBe("later-project");
  });
  it("keeps the latest project assignment including null during a slow resume", async () => {
    const { sessions, request, metadata, notify } = setup();
    await sessions.open("a");
    let finish!: (value: { thread: Thread }) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const activating = sessions.activate("a");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    notify({
      method: "thread/project/updated",
      params: { threadId: "a", projectId: "new-project" },
    });
    notify({
      method: "thread/project/updated",
      params: { threadId: "a", projectId: null },
    });
    finish({ thread: { ...metadata("a"), projectId: "old-project" } });
    await activating;
    expect(sessions.getSnapshot().threads.a.projectId).toBeNull();
    expect(sessions.getSnapshot().threadAccess.a).toBe("editable");
  });
  it("does not resurrect reverted turns from a late older page", async () => {
    const { sessions, request, metadata, notify } = setup();
    await sessions.open("a");
    let resolve!: (value: { data: Turn[]; nextCursor: null }) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const older = sessions.loadOlder("a");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    request.mockImplementation(async (...[method]) =>
      method === "thread/read"
        ? { thread: metadata("a") }
        : { data: [], nextCursor: null },
    );
    notify({ method: "thread/reverted", params: { threadId: "a" } });
    await vi.waitFor(() =>
      expect(sessions.getSnapshot().historyPages.a?.cursor).toBeNull(),
    );
    resolve({ data: [turn("removed")], nextCursor: null });
    await older;
    expect(sessions.getSnapshot().threads.a.turns).toEqual([]);
    expect(sessions.getSnapshot().historyPages.a).toEqual({
      cursor: null,
      loading: false,
    });
    expect(sessions.getSnapshot().historySyncError).toBeNull();
  });
  it("renders hydrated writer history immediately after switching away and back", async () => {
    const { sessions, request, metadata } = setup();
    request.mockResolvedValueOnce({
      thread: { ...metadata("a"), turns: [turn("live")] },
    });
    await sessions.activate("a");
    await sessions.open("a");
    await sessions.open("b");
    request.mockClear();
    await sessions.open("a");
    expect(sessions.getSnapshot().openingId).toBeNull();
    expect(sessions.getSnapshot().threads.a.turns[0].id).toBe("live");
    expect(request).not.toHaveBeenCalled();
  });
  it("loads one recent page, prepends older history once and exports full history independently", async () => {
    const { sessions, request } = setup();
    await sessions.open("a");
    expect(
      request.mock.calls.filter(([method]) => method === "thread/turns/list"),
    ).toHaveLength(1);
    expect(sessions.getSnapshot().historyPages.a.cursor).toBe("older");
    await Promise.all([sessions.loadOlder("a"), sessions.loadOlder("a")]);
    expect(sessions.getSnapshot().threads.a.turns.map((t) => t.id)).toEqual([
      "old",
      "recent",
    ]);
    expect(sessions.getSnapshot().historyPages.a).toEqual({
      cursor: null,
      loading: false,
    });
    expect(
      request.mock.calls.filter(([method]) => method === "thread/turns/list"),
    ).toHaveLength(2);
    request.mockClear();
    await sessions.readForExport("a");
    expect(
      request.mock.calls.filter(([method]) => method === "thread/turns/list"),
    ).toHaveLength(2);
  });
  it("queues a load-older click behind a slow background read", async () => {
    const { sessions, request, metadata } = setup();
    await sessions.open("a");
    let resolve!: (value: { thread: Thread }) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const sync = sessions.restoreSelected();
    await Promise.resolve();
    const older = sessions.loadOlder("a");
    resolve({ thread: metadata("a") });
    await Promise.all([sync, older]);
    expect(sessions.getSnapshot().threads.a.turns.map((t) => t.id)).toEqual([
      "old",
      "recent",
    ]);
  });
  it("preserves cached content when background validation fails", async () => {
    const { sessions, request } = setup();
    await sessions.open("a");
    await sessions.open("b");
    request.mockRejectedValueOnce(new Error("offline"));
    await sessions.open("a");
    await vi.waitFor(() =>
      expect(sessions.getSnapshot().historySyncError).toBe("offline"),
    );
    expect(sessions.getSnapshot().openingId).toBeNull();
    expect(sessions.getSnapshot().threads.a.turns[0].id).toBe("recent");
  });
  it("reconnect bridges new history to the old anchor without reversing disjoint windows", async () => {
    const { connection, sessions, request, state, metadata } = setup();
    await sessions.open("a");
    state.epoch++;
    connection.disconnect();
    request.mockImplementation(async (...[method, params]) => {
      const p = params as { cursor?: string };
      if (method === "thread/read")
        return { thread: { ...metadata("a"), updatedAt: 2 } };
      if (method === "thread/turns/list") {
        if (p.cursor === "bridge")
          return {
            data: [turn("middle"), turn("recent")],
            nextCursor: "older",
          };
        return { data: [turn("newest")], nextCursor: "bridge" };
      }
      throw new Error(method);
    });
    await sessions.restoreSelected();
    expect(sessions.getSnapshot().threads.a.turns.map((t) => t.id)).toEqual([
      "recent",
      "middle",
      "newest",
    ]);
    expect(sessions.getSnapshot().historyPages.a).toEqual({
      cursor: "older",
      loading: false,
    });
  });
});
