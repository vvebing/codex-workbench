import { afterEach, expect, it, vi } from "vitest";
import { ConnectionStore } from "../../src/features/connection/store";
import { SessionsStore } from "../../src/features/sessions/store";
import { placeholderThread } from "../../src/lib/state";
import type { Thread } from "../../src/generated/v2/Thread";

type Page = { data: Thread[]; nextCursor: string | null };
const page = (ids: string[], nextCursor: string | null): Page => ({
  data: ids.map(placeholderThread),
  nextCursor,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  vi.useFakeTimers();
  const connection = new ConnectionStore();
  let state = connection.getSnapshot();
  let changed!: () => void;
  vi.spyOn(connection, "getSnapshot").mockImplementation(() => state);
  vi.spyOn(connection, "subscribe").mockImplementation((listener) => {
    changed = listener;
    return () => {};
  });
  const sessions = new SessionsStore(connection);
  const request = vi.spyOn(connection.client, "request");
  const connect = () => {
    state = { ...state, status: "connected" };
    changed();
  };
  const disconnect = () => {
    state = { ...state, status: "disconnected", epoch: state.epoch + 1 };
    changed();
  };
  connect();
  return { sessions, request, connect, disconnect };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("shows the first summary page while draining all remaining pages without reading bodies", async () => {
  const f = fixture();
  const second = deferred<Page>();
  f.request
    .mockResolvedValueOnce(page(["recent"], "second"))
    .mockReturnValueOnce(second.promise)
    .mockResolvedValueOnce(page(["older", "oldest"], "fourth"))
    .mockResolvedValueOnce(page(["last"], null));
  const loading = f.sessions.loadAll();
  expect(f.sessions.loadAll()).toBe(loading);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.sessions.getSnapshot()).toMatchObject({
    listIds: ["recent"],
    historyLoading: true,
    historyComplete: false,
    loading: false,
    selectedId: null,
  });
  second.resolve(page(["recent", "older"], "third"));
  await loading;
  expect(f.sessions.getSnapshot()).toMatchObject({
    listIds: ["recent", "older", "oldest", "last"],
    nextCursor: null,
    historyLoading: false,
    historyComplete: true,
    historyError: null,
  });
  expect(f.request.mock.calls.map(([method]) => method)).toEqual([
    "thread/list",
    "thread/list",
    "thread/list",
    "thread/list",
  ]);
  expect(
    f.request.mock.calls.map(([, params]) =>
      params && "cursor" in params ? params.cursor : null,
    ),
  ).toEqual([null, "second", "third", "fourth"]);
});

it("joins an in-flight first-page refresh and keeps completed history across head refreshes and discovery", async () => {
  const f = fixture();
  const first = deferred<Page>();
  f.request
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(page(["oldest"], null));
  const refresh = f.sessions.refresh();
  const loading = f.sessions.loadAll();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.request).toHaveBeenCalledTimes(1);
  first.resolve(page(["recent"], "older"));
  await Promise.all([refresh, loading]);
  await f.sessions.loadAll();
  expect(f.request).toHaveBeenCalledTimes(2);
  f.request.mockResolvedValue(page(["new", "recent"], "older"));
  await f.sessions.refresh();
  await f.sessions.loadAll();
  expect(f.request).toHaveBeenCalledTimes(3);
  expect(f.sessions.getSnapshot()).toMatchObject({
    listIds: ["new", "recent", "oldest"],
    nextCursor: null,
    historyComplete: true,
  });
  await vi.advanceTimersByTimeAsync(5000);
  await f.sessions.loadAll();
  expect(f.request).toHaveBeenCalledTimes(4);
  expect(f.sessions.getSnapshot().historyComplete).toBe(true);
  expect(f.sessions.getSnapshot().nextCursor).toBeNull();
});

it("retains loaded rows and the failed continuation, then retries just that page", async () => {
  const f = fixture();
  f.request
    .mockResolvedValueOnce(page(["recent"], "second"))
    .mockResolvedValueOnce(page(["older"], "third"))
    .mockRejectedValueOnce(new Error("temporary history failure"));
  await expect(f.sessions.loadAll()).rejects.toThrow(
    "temporary history failure",
  );
  expect(f.sessions.getSnapshot()).toMatchObject({
    listIds: ["recent", "older"],
    nextCursor: "third",
    historyLoading: false,
    historyComplete: false,
    historyError: "temporary history failure",
    loading: false,
    error: null,
  });
  f.request.mockResolvedValueOnce(page(["last"], null));
  await f.sessions.loadAll();
  expect(f.request).toHaveBeenLastCalledWith(
    "thread/list",
    expect.objectContaining({ cursor: "third" }),
  );
  expect(f.sessions.getSnapshot()).toMatchObject({
    listIds: ["recent", "older", "last"],
    historyError: null,
    historyComplete: true,
  });
});

it("cancels a previous section traversal without overwriting the new section's pages", async () => {
  const f = fixture();
  const stale = deferred<Page>();
  const current = deferred<Page>();
  f.request
    .mockResolvedValueOnce(page(["all-recent"], "all-next"))
    .mockReturnValueOnce(stale.promise);
  const oldLoading = f.sessions.loadAll();
  await vi.advanceTimersByTimeAsync(0);
  f.request
    .mockResolvedValueOnce(page(["section-recent"], "section-next"))
    .mockReturnValueOnce(current.promise);
  await f.sessions.setSectionFilter("section");
  const newLoading = f.sessions.loadAll();
  await vi.advanceTimersByTimeAsync(0);
  stale.resolve(page(["stale"], "stale-next"));
  await oldLoading;
  expect(f.sessions.getSnapshot()).toMatchObject({
    listIds: ["section-recent"],
    nextCursor: "section-next",
    historyLoading: true,
  });
  current.resolve(page(["section-oldest"], null));
  await newLoading;
  expect(f.sessions.getSnapshot().listIds).toEqual([
    "section-recent",
    "section-oldest",
  ]);
  expect(f.sessions.getSnapshot().threads.stale).toBeUndefined();
});

it("shares a new section's first page when background loading begins before the filter request finishes", async () => {
  const f = fixture();
  const first = deferred<Page>();
  f.request
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(page(["older"], null));
  const filtering = f.sessions.setSectionFilter("section");
  const loading = f.sessions.loadAll();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.request).toHaveBeenCalledTimes(1);
  first.resolve(page(["recent"], "older"));
  await Promise.all([filtering, loading]);
  expect(f.request).toHaveBeenCalledTimes(2);
  expect(f.request).toHaveBeenLastCalledWith(
    "thread/list",
    expect.objectContaining({ sectionId: "section", cursor: "older" }),
  );
  expect(f.sessions.getSnapshot().historyComplete).toBe(true);
});

it("resumes an unfinished history after reconnect and rejects late responses from the old connection", async () => {
  const f = fixture();
  const stale = deferred<Page>();
  f.request
    .mockResolvedValueOnce(page(["recent"], "older"))
    .mockReturnValueOnce(stale.promise);
  const previous = f.sessions.loadAll();
  await vi.advanceTimersByTimeAsync(0);
  f.disconnect();
  expect(f.sessions.getSnapshot().historyLoading).toBe(false);
  f.connect();
  f.request
    .mockResolvedValueOnce(page(["new", "recent"], "head-cursor"))
    .mockResolvedValueOnce(page(["oldest"], null));
  await f.sessions.refresh();
  await f.sessions.loadAll();
  expect(f.request).toHaveBeenLastCalledWith(
    "thread/list",
    expect.objectContaining({ cursor: "older" }),
  );
  stale.resolve(page(["stale"], "unwanted"));
  await previous;
  expect(f.sessions.getSnapshot()).toMatchObject({
    listIds: ["new", "recent", "oldest"],
    historyLoading: false,
    historyComplete: true,
    nextCursor: null,
  });
  expect(f.sessions.getSnapshot().threads.stale).toBeUndefined();
});

it("detects a cursor cycle across pages with new rows, preserving those rows for a fresh retry", async () => {
  const f = fixture();
  f.request
    .mockResolvedValueOnce(page(["recent"], "a"))
    .mockResolvedValueOnce(page(["older"], "b"))
    .mockResolvedValueOnce(page(["oldest"], "a"));
  await expect(f.sessions.loadAll()).rejects.toThrow("游标重复");
  expect(f.request).toHaveBeenCalledTimes(3);
  expect(f.sessions.getSnapshot()).toMatchObject({
    listIds: ["recent", "older", "oldest"],
    historyLoading: false,
    historyComplete: false,
    nextCursor: null,
  });
  f.request.mockResolvedValueOnce(page(["recent", "older", "oldest"], null));
  await f.sessions.loadAll();
  expect(f.request).toHaveBeenLastCalledWith(
    "thread/list",
    expect.not.objectContaining({ cursor: expect.anything() }),
  );
  expect(f.sessions.getSnapshot().historyComplete).toBe(true);
  expect(f.sessions.getSnapshot().historyError).toBeNull();
});

it("restarts from the head when the server rejects an expired continuation", async () => {
  const f = fixture();
  f.request
    .mockResolvedValueOnce(page(["recent"], "expired"))
    .mockRejectedValueOnce(new Error("Cursor is expired"));
  await expect(f.sessions.loadAll()).rejects.toThrow("expired");
  expect(f.sessions.getSnapshot()).toMatchObject({
    listIds: ["recent"],
    nextCursor: null,
    historyComplete: false,
  });
  f.request
    .mockResolvedValueOnce(page(["new", "recent"], "valid"))
    .mockResolvedValueOnce(page(["older"], null));
  await f.sessions.loadAll();
  expect(f.request.mock.calls.slice(2).map(([, params]) => params)).toEqual([
    expect.not.objectContaining({ cursor: expect.anything() }),
    expect.objectContaining({ cursor: "valid" }),
  ]);
  expect(f.sessions.getSnapshot()).toMatchObject({
    listIds: ["new", "recent", "older"],
    historyComplete: true,
    historyError: null,
  });
});

it.each(["", "   ", 5])(
  "stops an invalid continuation (%j) without discarding received rows",
  async (cursor) => {
    const f = fixture();
    f.request.mockResolvedValueOnce({
      data: [placeholderThread("recent")],
      nextCursor: cursor,
    });
    await expect(f.sessions.loadAll()).rejects.toThrow("游标无效");
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.sessions.getSnapshot()).toMatchObject({
      listIds: ["recent"],
      nextCursor: null,
      historyComplete: false,
      historyLoading: false,
    });
  },
);
