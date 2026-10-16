import { afterEach, expect, test, vi } from "vitest";
import {
  HistorySearch,
  type HistorySearchClient,
} from "../../src/features/navigation/history-search";
import type { Thread } from "../../src/generated/v2/Thread";

function setup() {
  const pending: {
    resolve: (page: unknown) => void;
    reject: (error: Error) => void;
  }[] = [];
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(
    () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
  );
  let current = true;
  const search = new HistorySearch(
    { request } as HistorySearchClient,
    "Case 标题",
    () => current,
  );
  return {
    search,
    request,
    pending,
    invalidate: () => {
      current = false;
    },
  };
}
const thread = (id: string) => ({ id }) as Thread;
const page = (...ids: string[]) => ({
  data: ids.map(thread),
  nextCursor: null,
});
afterEach(() => vi.useRealTimers());

test("debounces title search and keeps pagination isolated with duplicate removal", async () => {
  vi.useFakeTimers();
  const { search, request, pending } = setup();
  search.start();
  await vi.advanceTimersByTimeAsync(249);
  expect(request).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledWith("thread/list", {
    searchTerm: "Case 标题",
    sourceKinds: ["cli", "vscode", "exec", "appServer", "unknown"],
    limit: 50,
    sortKey: "updated_at",
    sortDirection: "desc",
  });
  pending[0].resolve({ ...page("a"), nextCursor: "next" });
  await Promise.resolve();
  search.more();
  search.more();
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][1]).toMatchObject({
    cursor: "next",
    searchTerm: "Case 标题",
  });
  pending[1].resolve(page("a", "b"));
  await Promise.resolve();
  expect(search.getSnapshot().threads.map((t) => t.id)).toEqual(["a", "b"]);
  expect(search.getSnapshot().loading).toBe(false);
  search.more();
  expect(request).toHaveBeenCalledTimes(2);
});

test("closing cancels debounce and ignores pending results or errors", async () => {
  vi.useFakeTimers();
  const first = setup();
  first.search.start();
  first.search.dispose();
  await vi.advanceTimersByTimeAsync(250);
  expect(first.request).not.toHaveBeenCalled();
  for (const fail of [false, true]) {
    const { search, pending } = setup();
    search.start();
    await vi.advanceTimersByTimeAsync(250);
    const before = search.getSnapshot();
    search.dispose();
    if (fail) pending[0].reject(Error("late error"));
    else pending[0].resolve(page("stale"));
    await Promise.resolve();
    expect(search.getSnapshot()).toBe(before);
  }
});

test("connection invalidation suppresses responses even before lifecycle cleanup", async () => {
  vi.useFakeTimers();
  const { search, pending, invalidate } = setup();
  search.start();
  await vi.advanceTimersByTimeAsync(250);
  const before = search.getSnapshot();
  invalidate();
  pending[0].resolve(page("old-environment"));
  await Promise.resolve();
  expect(search.getSnapshot()).toBe(before);
});

test("failed pagination keeps results and retries the same cursor", async () => {
  vi.useFakeTimers();
  const { search, request, pending } = setup();
  search.start();
  await vi.advanceTimersByTimeAsync(250);
  pending[0].resolve({ ...page("a"), nextCursor: "next" });
  await Promise.resolve();
  search.more();
  pending[1].reject(Error("unavailable"));
  await Promise.resolve();
  expect(search.getSnapshot()).toMatchObject({
    loading: false,
    error: "unavailable",
    nextCursor: "next",
  });
  expect(search.getSnapshot().threads.map((t) => t.id)).toEqual(["a"]);
  search.retry();
  expect(request.mock.calls[2][1]).toMatchObject({ cursor: "next" });
  pending[2].resolve(page("b"));
  await Promise.resolve();
  expect(search.getSnapshot().threads.map((t) => t.id)).toEqual(["a", "b"]);
  expect(search.getSnapshot().error).toBeNull();
});

test("stops repeated pagination cursors and excludes child threads", async () => {
  vi.useFakeTimers();
  const { search, request, pending } = setup();
  search.start();
  await vi.advanceTimersByTimeAsync(250);
  pending[0].resolve({
    data: [
      thread("root"),
      { ...thread("child"), parentThreadId: "root" },
      { ...thread("agent"), source: { subAgent: "review" } },
    ],
    nextCursor: "a",
  });
  await Promise.resolve();
  expect(search.getSnapshot().threads.map((t) => t.id)).toEqual(["root"]);
  search.more();
  pending[1].resolve({ ...page("second"), nextCursor: "b" });
  await Promise.resolve();
  search.more();
  pending[2].resolve({ ...page("third"), nextCursor: "a" });
  await Promise.resolve();
  expect(search.getSnapshot()).toMatchObject({
    loading: false,
    nextCursor: null,
  });
  expect(search.getSnapshot().error).toContain("重复");
  search.more();
  expect(request).toHaveBeenCalledTimes(3);
});
