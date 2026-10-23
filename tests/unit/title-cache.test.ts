import { expect, test, vi } from "vitest";
import { ThreadTitleCache } from "../../src/features/sessions/title-cache";
import { threadTitle } from "../../src/features/sessions/thread-title";
import { placeholderThread } from "../../src/lib/state";
import type { Turn } from "../../src/generated/v2/Turn";

const turn = (id: string, text: string): Turn => ({
  id,
  rootTurnId: null,
  itemsView: "full",
  status: "completed",
  error: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
  items: [
    {
      type: "userMessage",
      id,
      clientId: null,
      content: [{ type: "text", text, text_elements: [] }],
    },
  ],
});
const thread = {
  ...placeholderThread("same-id"),
  preview: "回答问题：\n版本？\nv1.49.8",
  turns: [turn("original", "请分析 Session 频繁请求与接口 401")],
};
function storageFixture() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

test("keeps the task after previews change, bodies are evicted, and the browser reloads", () => {
  const storage = storageFixture();
  const cache = new ThreadTitleCache(storage);
  cache.activateScope('["remote","ws://first"]');
  const first = cache.apply({ [thread.id]: thread });
  expect(threadTitle(first[thread.id])).toBe("分析 Session 频繁请求与接口 401");
  expect(first[thread.id].preview).toBe(thread.preview);
  expect(first[thread.id].name).toBeNull();
  expect(cache.apply(first)).toBe(first);
  const metadata = {
    ...thread,
    preview: "[ crs-example | DB0 ] # TTL sess:example\n85451",
    turns: [],
  };
  expect(threadTitle(cache.apply({ [thread.id]: metadata })[thread.id])).toBe(
    "分析 Session 频繁请求与接口 401",
  );
  expect(storage.setItem).toHaveBeenCalledTimes(1);
  const restored = new ThreadTitleCache(storage);
  restored.activateScope('["remote","ws://first"]');
  const current = restored.apply({ [thread.id]: metadata });
  expect(threadTitle(current[thread.id])).toBe(
    "分析 Session 频繁请求与接口 401",
  );
  expect(threadTitle({ ...current[thread.id], name: "用户重命名" })).toBe(
    "用户重命名",
  );
});

test("separates environment endpoints and tolerates unavailable storage", () => {
  const storage = storageFixture();
  const cache = new ThreadTitleCache(storage);
  cache.activateScope('["remote","ws://first"]');
  cache.apply({ [thread.id]: thread });
  cache.activateScope('["remote","ws://second"]');
  expect(
    threadTitle(
      cache.apply({ [thread.id]: { ...thread, turns: [] } })[thread.id],
    ),
  ).toBe("未命名会话");
  const unavailable = new ThreadTitleCache({
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("full");
    },
  });
  unavailable.activateScope("test");
  expect(
    threadTitle(unavailable.apply({ [thread.id]: thread })[thread.id]),
  ).toBe("分析 Session 频繁请求与接口 401");
});

test("improves a partial history title only when older task history becomes available", () => {
  const cache = new ThreadTitleCache(storageFixture());
  const recent = turn("recent", "请分析登录顺序");
  cache.apply({ [thread.id]: { ...thread, turns: [recent] } });
  const complete = cache.apply({
    [thread.id]: { ...thread, turns: [...thread.turns, recent] },
  });
  expect(threadTitle(complete[thread.id])).toBe(
    "分析 Session 频繁请求与接口 401",
  );
  const nextPage = cache.apply({
    [thread.id]: { ...thread, turns: [turn("newest", "请检查前端代码")] },
  });
  expect(threadTitle(nextPage[thread.id])).toBe(
    "分析 Session 频繁请求与接口 401",
  );
});

test("does not persist ephemeral conversations or diagnostic-only histories", () => {
  const storage = storageFixture();
  const cache = new ThreadTitleCache(storage);
  cache.activateScope("test");
  cache.apply({ [thread.id]: { ...thread, ephemeral: true } });
  cache.apply({
    [thread.id]: {
      ...thread,
      turns: [turn("answer", thread.preview)],
    },
  });
  expect(storage.setItem).not.toHaveBeenCalled();
});
