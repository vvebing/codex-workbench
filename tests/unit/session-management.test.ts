import { afterEach, expect, test, vi } from "vitest";
import { ConnectionStore } from "../../src/features/connection/store";
import { SessionsStore } from "../../src/features/sessions/store";
import { placeholderThread } from "../../src/lib/state";
import type { RpcNotification } from "../../src/lib/rpc";
import type { Thread } from "../../src/generated/v2/Thread";
import type { Turn } from "../../src/generated/v2/Turn";
import type { ThreadSettings } from "../../src/generated/v2/ThreadSettings";

function fixture() {
  const connection = new ConnectionStore();
  let notify!: (event: RpcNotification) => void;
  vi.spyOn(connection.client, "onNotification").mockImplementation(
    (listener) => {
      notify = listener;
      return () => {};
    },
  );
  const sessions = new SessionsStore(connection);
  const request = vi.spyOn(connection.client, "request");
  return { connection, sessions, request, notify };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const thread = (id: string) => ({ ...placeholderThread(id), name: id });
const turn = (id: string) =>
  ({
    id,
    items: [],
    status: "completed",
    itemsView: "full",
  }) as unknown as Turn;
afterEach(() => vi.restoreAllMocks());

test("pinning never sends a field absent from the protocol", async () => {
  const f = fixture();
  await expect(f.sessions.setPinned()).rejects.toThrow("不支持持久置顶");
  expect(f.request).not.toHaveBeenCalled();
});

test("sections persist CRUD and moving through their protocol endpoints", async () => {
  const f = fixture();
  const section = { id: "s", name: "计划", appearance: null };
  f.request
    .mockResolvedValueOnce({ data: [section], nextCursor: "next" })
    .mockResolvedValueOnce({ data: [], nextCursor: null });
  await f.sessions.loadSections();
  expect(f.request).toHaveBeenLastCalledWith("threadSection/list", {
    limit: 100,
    cursor: "next",
  });
  f.request.mockResolvedValueOnce({ section: { ...section, name: "进行中" } });
  await f.sessions.saveSection("进行中", "s");
  expect(f.sessions.getSnapshot().sections[0].name).toBe("进行中");
  f.request
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ data: [], nextCursor: null });
  await f.sessions.moveSection("a", "s");
  expect(f.request).toHaveBeenCalledWith("thread/section/move", {
    threadId: "a",
    sectionId: "s",
  });
  f.request.mockResolvedValueOnce({});
  await f.sessions.deleteSection("s");
  expect(f.sessions.getSnapshot().sections).toEqual([]);
});

test("switching section filters ignores stale responses including A-B-A races", async () => {
  const f = fixture();
  const a = deferred<{ data: Thread[]; nextCursor: null }>();
  const b = deferred<{ data: Thread[]; nextCursor: null }>();
  const c = deferred<{ data: Thread[]; nextCursor: null }>();
  f.request
    .mockReturnValueOnce(a.promise)
    .mockReturnValueOnce(b.promise)
    .mockReturnValueOnce(c.promise);
  const first = f.sessions.setSectionFilter("a");
  const second = f.sessions.setSectionFilter("b");
  const third = f.sessions.setSectionFilter("a");
  c.resolve({ data: [thread("current")], nextCursor: null });
  await third;
  b.resolve({ data: [thread("b")], nextCursor: null });
  await second;
  a.resolve({ data: [thread("old")], nextCursor: null });
  await first;
  expect(f.sessions.getSnapshot().listIds).toEqual(["current"]);
});

test("delete removes known descendants and blocks pending history resurrection", async () => {
  const f = fixture();
  const root = thread("root");
  const child = { ...thread("child"), parentThreadId: "root" };
  const grandchild = { ...thread("grandchild"), parentThreadId: "child" };
  f.request.mockResolvedValue({
    data: [root, child, grandchild],
    nextCursor: null,
  });
  await f.sessions.refresh();
  const pending = deferred<{ thread: Thread }>();
  f.request
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ thread: child });
  const snapshot = f.connection.getSnapshot();
  vi.spyOn(f.connection, "getSnapshot").mockReturnValue({
    ...snapshot,
    status: "connected",
  });
  const opening = f.sessions.open("child");
  await f.sessions.delete("root");
  pending.resolve({ thread: child });
  await opening;
  expect(f.sessions.getSnapshot().threads).toEqual({});
  expect(f.sessions.getSnapshot().selectedId).toBeNull();
});

test("external revert replaces history, retries older reads and settings update metadata", async () => {
  const f = fixture();
  const old = { ...thread("a"), turns: [turn("keep"), turn("remove")] };
  f.request.mockResolvedValue({ thread: old });
  await f.sessions.open("a");
  const pending = deferred<{ thread: Thread }>();
  f.request.mockReturnValueOnce(pending.promise);
  const exporting = f.sessions.readForExport("a");
  await Promise.resolve();
  f.request.mockResolvedValue({ thread: { ...old, turns: [turn("keep")] } });
  f.notify({ method: "thread/reverted", params: { threadId: "a" } });
  await vi.waitFor(() =>
    expect(f.sessions.getSnapshot().threads.a.turns.map((t) => t.id)).toEqual([
      "keep",
    ]),
  );
  pending.resolve({ thread: old });
  expect((await exporting).turns.map((t) => t.id)).toEqual(["keep"]);
  const settings = {
    cwd: "/new",
    model: "new-model",
    modelProvider: "provider",
    effort: "high",
  } as ThreadSettings;
  f.notify({
    method: "thread/settings/updated",
    params: { threadId: "a", threadSettings: settings },
  });
  expect(f.sessions.getSnapshot().threads.a).toMatchObject({
    cwd: "/new",
    model: "new-model",
    reasoningEffort: "high",
  });
  expect(f.sessions.getSnapshot().threadSettings.a).toBe(settings);
});

test("review acquires writer access and response cannot regress a completed streamed turn", async () => {
  const f = fixture();
  f.request
    .mockResolvedValueOnce({ thread: thread("a") })
    .mockResolvedValueOnce({ thread: thread("a") });
  await f.sessions.open("a");
  const review = deferred<{ turn: Turn; reviewThreadId: string }>();
  f.request
    .mockResolvedValueOnce({ thread: thread("a") })
    .mockReturnValueOnce(review.promise);
  const starting = f.sessions.startReview("a", { type: "uncommittedChanges" });
  await vi.waitFor(() =>
    expect(f.request).toHaveBeenCalledWith("review/start", {
      threadId: "a",
      target: { type: "uncommittedChanges" },
      delivery: "inline",
    }),
  );
  f.notify({
    method: "turn/completed",
    params: { threadId: "a", turn: turn("review") },
  });
  review.resolve({
    turn: { ...turn("review"), status: "inProgress" },
    reviewThreadId: "a",
  });
  await starting;
  expect(f.sessions.getSnapshot().threadAccess.a).toBe("editable");
  expect(f.sessions.getSnapshot().threads.a.turns[0].status).toBe("completed");
});

test("revert retains earlier turn results and removes the reverted suffix", async () => {
  const f = fixture();
  const source = {
    ...thread("source"),
    historyMode: "paginated" as const,
    turns: [turn("a"), turn("b")],
  };
  f.request.mockResolvedValueOnce({ thread: source });
  await f.sessions.fork("parent");
  for (const id of ["a", "b"]) {
    f.notify({
      method: "turn/diff/updated",
      params: { threadId: "source", turnId: id, diff: `+${id}` },
    });
    f.notify({
      method: "turn/plan/updated",
      params: {
        threadId: "source",
        turnId: id,
        explanation: null,
        plan: [{ step: id, status: "completed" }],
      },
    });
  }
  f.request
    .mockResolvedValueOnce({ thread: { ...source, turns: [] } })
    .mockRejectedValueOnce(new Error("history offline"));
  await f.sessions.revert("source", "b");
  expect(f.sessions.getSnapshot().diffs.source).toEqual({ a: "+a" });
  expect(f.sessions.getSnapshot().plans.source).toEqual({
    a: [{ step: "a", status: "completed" }],
  });
});

test("revert activates a viewed historical thread before writing", async () => {
  const f = fixture();
  const source = { ...thread("history"), historyMode: "paginated" as const };
  f.request
    .mockResolvedValueOnce({ thread: source })
    .mockResolvedValueOnce({ data: [turn("b"), turn("a")], nextCursor: null });
  await f.sessions.open("history");
  expect(f.sessions.getSnapshot().threadAccess.history).toBe("viewing");
  f.request.mockClear();
  f.request
    .mockResolvedValueOnce({ thread: source })
    .mockResolvedValueOnce({ thread: source })
    .mockRejectedValueOnce(new Error("history offline"));
  await f.sessions.revert("history", "b");
  expect(f.request.mock.calls.map(([method]) => method)).toEqual([
    "thread/resume",
    "thread/revert",
    "thread/read",
  ]);
  expect(f.sessions.getSnapshot().threadAccess.history).toBe("editable");
  expect(
    f.sessions.getSnapshot().threads.history.turns.map((turn) => turn.id),
  ).toEqual(["a"]);
});

test("opening a running thread reads history without acquiring writer access", async () => {
  const f = fixture();
  const source = {
    ...thread("running"),
    status: { type: "active" as const, activeFlags: [] },
    turns: [{ ...turn("run"), status: "inProgress" as const }],
  };
  f.request.mockResolvedValue({ thread: source });
  await f.sessions.open("running");
  expect(f.request.mock.calls).toEqual([
    ["thread/read", { threadId: "running", includeTurns: false }],
  ]);
  expect(f.sessions.getSnapshot().threadAccess.running).toBe("viewing");
  expect(f.sessions.activeTurn("running")?.id).toBe("run");
});

test("action errors stay local while navigation errors have a global fallback", async () => {
  const f = fixture();
  f.request.mockResolvedValue({ thread: thread("a") });
  await f.sessions.open("a");
  f.request.mockRejectedValue(new Error("操作失败"));
  await expect(f.sessions.rename("a", "新名称")).rejects.toThrow("操作失败");
  expect(f.sessions.getSnapshot().error).toBeNull();
  await expect(f.sessions.open("b")).rejects.toThrow("操作失败");
  expect(f.sessions.getSnapshot().error).toBe("操作失败");
  f.sessions.clearError();
  await expect(f.sessions.archive("a", true)).rejects.toThrow("操作失败");
  expect(f.sessions.getSnapshot().error).toBe("操作失败");
});

test("revert explains an occupied remote session without writing or changing history", async () => {
  const f = fixture();
  const source = { ...thread("remote"), historyMode: "paginated" as const };
  f.request
    .mockResolvedValueOnce({ thread: source })
    .mockResolvedValueOnce({ data: [turn("b"), turn("a")], nextCursor: null });
  await f.sessions.open("remote");
  f.request.mockClear();
  f.request.mockRejectedValueOnce(
    new Error("thread already has an active writer"),
  );
  const confirmed = vi.fn();
  await expect(f.sessions.revert("remote", "b", confirmed)).rejects.toThrow(
    "写入权限由其他客户端持有",
  );
  expect(f.request.mock.calls.map(([method]) => method)).toEqual([
    "thread/resume",
  ]);
  expect(
    f.sessions.getSnapshot().threads.remote.turns.map((entry) => entry.id),
  ).toEqual(["a", "b"]);
  expect(f.sessions.getSnapshot().threadAccess.remote).toBe("occupied");
  expect(f.sessions.getSnapshot().error).toBeNull();
  expect(confirmed).not.toHaveBeenCalled();
  f.request
    .mockResolvedValueOnce({ thread: source })
    .mockResolvedValueOnce({ thread: source })
    .mockRejectedValueOnce(new Error("history offline"));
  await f.sessions.revert("remote", "b", confirmed);
  expect(confirmed).toHaveBeenCalledOnce();
  expect(
    f.sessions.getSnapshot().threads.remote.turns.map((entry) => entry.id),
  ).toEqual(["a"]);
});

test("revert reports writer loss during the request without replaying it", async () => {
  const f = fixture();
  const source = { ...thread("remote"), historyMode: "paginated" as const };
  f.request
    .mockResolvedValueOnce({ thread: source })
    .mockResolvedValueOnce({ data: [turn("b"), turn("a")], nextCursor: null });
  await f.sessions.open("remote");
  f.request.mockClear();
  f.request
    .mockResolvedValueOnce({ thread: source })
    .mockRejectedValueOnce(new Error("thread already has an active writer"));
  await expect(f.sessions.revert("remote", "b")).rejects.toThrow(
    "写入权限由其他客户端持有",
  );
  expect(f.request.mock.calls.map(([method]) => method)).toEqual([
    "thread/resume",
    "thread/revert",
  ]);
  expect(
    f.sessions.getSnapshot().threads.remote.turns.map((entry) => entry.id),
  ).toEqual(["a", "b"]);
  expect(f.sessions.getSnapshot().threadAccess.remote).toBe("occupied");
});

test("project notifications received while listing an unknown thread survive the list response", async () => {
  const f = fixture();
  const pending = deferred<{ data: Thread[]; nextCursor: null }>();
  f.request.mockReturnValueOnce(pending.promise);
  const refresh = f.sessions.refresh();
  await vi.waitFor(() =>
    expect(f.request).toHaveBeenCalledWith("thread/list", expect.anything()),
  );
  f.notify({
    method: "thread/project/updated",
    params: { threadId: "a", projectId: "current-project" },
  });
  pending.resolve({
    data: [
      { ...thread("a"), projectId: "stale-project", cwd: "/real-directory" },
    ],
    nextCursor: null,
  });
  await refresh;
  expect(f.sessions.getSnapshot().threads.a).toMatchObject({
    projectId: "current-project",
    cwd: "/real-directory",
  });
  f.request.mockResolvedValueOnce({
    data: [{ ...thread("a"), projectId: "later-project" }],
    nextCursor: null,
  });
  await f.sessions.refresh();
  expect(f.sessions.getSnapshot().threads.a.projectId).toBe("later-project");
});

test("archiving the current thread preserves reading context and rejects further writer acquisition", async () => {
  const f = fixture();
  const source = { ...thread("reading"), turns: [turn("done")] };
  f.request.mockResolvedValue({ thread: source });
  await f.sessions.open("reading");
  await f.sessions.activate("reading");
  f.notify({
    method: "turn/diff/updated",
    params: { threadId: "reading", turnId: "done", diff: "+preserved" },
  });
  const before = f.sessions.getSnapshot();
  expect(before.threadAccess.reading).toBe("editable");
  f.request.mockImplementationOnce(async () => {
    // Servers may publish this before acknowledging the action.
    f.notify({ method: "thread/archived", params: { threadId: "reading" } });
    return {};
  });
  await f.sessions.archive("reading");
  const archived = f.sessions.getSnapshot();
  expect(archived.selectedId).toBe("reading");
  expect(archived.threads.reading).toBe(before.threads.reading);
  expect(archived.diffs.reading).toBe(before.diffs.reading);
  expect(archived.threadAccess.reading).toBe("viewing");
  expect(archived.archivedIds.reading).toBe(true);
  expect(archived.listIds).not.toContain("reading");
  f.request.mockClear();
  await expect(f.sessions.activate("reading")).rejects.toThrow("已归档");
  await expect(
    f.sessions.startReview("reading", { type: "uncommittedChanges" }),
  ).rejects.toThrow("已归档");
  expect(f.request).not.toHaveBeenCalled();
});

test("external archiving keeps the current thread but removes background archived threads", async () => {
  const f = fixture();
  f.request.mockResolvedValueOnce({
    thread: { ...thread("reading"), turns: [turn("done")] },
  });
  await f.sessions.open("reading");
  f.request.mockResolvedValueOnce({
    data: [thread("background")],
    nextCursor: null,
  });
  await f.sessions.refresh();
  f.notify({ method: "thread/archived", params: { threadId: "background" } });
  expect(f.sessions.getSnapshot().threads.background).toBeUndefined();
  expect(f.sessions.getSnapshot().selectedId).toBe("reading");
  f.notify({ method: "thread/archived", params: { threadId: "reading" } });
  expect(f.sessions.getSnapshot().threads.reading).toBeDefined();
  expect(f.sessions.getSnapshot().selectedId).toBe("reading");
  expect(f.sessions.getSnapshot().archivedIds).toEqual({
    background: true,
    reading: true,
  });
});

test("restoration immediately restores local visibility without granting writer access or requiring a notification", async () => {
  const f = fixture();
  const source = { ...thread("reading"), turns: [turn("keep")] };
  f.request.mockResolvedValueOnce({ thread: source });
  await f.sessions.open("reading");
  f.notify({ method: "thread/archived", params: { threadId: "reading" } });
  f.request.mockResolvedValueOnce({ thread: { ...source, turns: [] } });
  await f.sessions.unarchive("reading");
  expect(f.sessions.getSnapshot().archivedIds.reading).toBeUndefined();
  expect(f.sessions.getSnapshot().listIds).toContain("reading");
  expect(f.sessions.getSnapshot().selectedId).toBe("reading");
  expect(f.sessions.getSnapshot().threadAccess.reading).toBe("viewing");
  expect(
    f.sessions.getSnapshot().threads.reading.turns.map((turn) => turn.id),
  ).toEqual(["keep"]);
  f.request.mockRejectedValueOnce(new Error("list offline"));
  await expect(f.sessions.refresh()).rejects.toThrow("list offline");
  expect(f.sessions.getSnapshot().listIds).toContain("reading");
  expect(f.sessions.getSnapshot().archivedIds.reading).toBeUndefined();
});
