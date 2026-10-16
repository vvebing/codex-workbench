import { expect, it, vi } from "vitest";
import { QuestionDismissalsStore } from "../../src/features/conversation/question-dismissals";

it("persists ignores per environment, thread and question without affecting another prompt", () => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
  try {
    const store = new QuestionDismissalsStore("local");
    store.ignore("thread", "question");
    expect(store.isIgnored("thread", "question")).toBe(true);
    expect(store.isIgnored("other", "question")).toBe(false);
    expect(store.isIgnored("thread", "new")).toBe(false);
    expect(
      new QuestionDismissalsStore("local").isIgnored("thread", "question"),
    ).toBe(true);
    store.activateScope("remote");
    expect(store.isIgnored("thread", "question")).toBe(false);
    store.activateScope("local");
    expect(store.isIgnored("thread", "question")).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("allows ignoring when browser storage is unavailable", () => {
  const store = new QuestionDismissalsStore("local");
  store.ignore("thread", "question");
  expect(store.isIgnored("thread", "question")).toBe(true);
});
