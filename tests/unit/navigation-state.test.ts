import { afterEach, expect, test, vi } from "vitest";
import {
  NAVIGATION_STORAGE_KEY,
  NavigationStore,
  navigationEnvironmentKey,
  navigationVisitKey,
} from "../../src/features/navigation/navigation-state";

function storage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
  };
}
afterEach(() => vi.useRealTimers());

test("navigation defaults to current environment and persists explicit scope, view, collapsed projects, and visits", () => {
  const local = storage();
  const state = new NavigationStore(local);
  expect(state.getSnapshot()).toEqual({
    scope: "current",
    view: "projects",
    status: "all",
    collapsed: {},
    visits: {},
  });
  const environment = navigationEnvironmentKey({
    id: "local",
    url: "ws://127.0.0.1:4501",
  });
  state.setScope("all");
  state.setView("recent");
  state.setStatus("unread");
  state.setCollapsed("project", true);
  state.visit(environment, "thread", 123);
  const restored = new NavigationStore(local);
  expect(restored.getSnapshot()).toEqual(state.getSnapshot());
  expect(
    restored.getSnapshot().visits[navigationVisitKey(environment, "thread")],
  ).toBe(123);
  expect(
    navigationEnvironmentKey({ id: "local", url: "ws://127.0.0.1:4501" }),
  ).toBe(environment);
  expect(
    navigationEnvironmentKey({ id: "local", url: "ws://127.0.0.1:4502" }),
  ).not.toBe(environment);
  restored.setScope("current");
  expect(new NavigationStore(local).getSnapshot().scope).toBe("current");
});

test("malformed persisted values cannot become a scope, status, inherited position, or invalid timestamp", () => {
  const local = storage();
  const key = navigationVisitKey("environment", "thread");
  local.data.set(
    NAVIGATION_STORAGE_KEY,
    JSON.stringify({
      scope: "invalid scope",
      view: [],
      status: ["attention"],
      collapsed: { valid: true, wrong: "true", constructor: true },
      visits: {
        [key]: 100,
        invalid: 2,
        '["environment","huge"]': 1e300,
        '["environment","negative"]': -1,
      },
      positions: { valid: 42, negative: -5, constructor: 23 },
    }),
  );
  const state = new NavigationStore(local);
  expect(state.getSnapshot()).toEqual({
    scope: "current",
    view: "projects",
    status: "all",
    collapsed: { valid: true },
    visits: { [key]: 100 },
  });
  expect(state.scrollPosition("valid")).toBe(42);
  expect(state.scrollPosition("negative")).toBe(0);
  expect(state.scrollPosition("constructor")).toBe(0);
  for (const raw of ["bad json", "[]", "null", '"text"']) {
    local.data.set(NAVIGATION_STORAGE_KEY, raw);
    expect(new NavigationStore(local).getSnapshot().scope).toBe("current");
  }
});

test("visit retention preserves the latest visits and rejects invalid runtime values", () => {
  const local = storage();
  local.data.set(
    NAVIGATION_STORAGE_KEY,
    JSON.stringify({
      visits: Object.fromEntries(
        Array.from({ length: 2001 }, (_, index) => [
          navigationVisitKey("environment", String(index)),
          2001 - index,
        ]),
      ),
    }),
  );
  const state = new NavigationStore(local);
  expect(Object.keys(state.getSnapshot().visits)).toHaveLength(2000);
  expect(
    state.getSnapshot().visits[navigationVisitKey("environment", "0")],
  ).toBe(2001);
  expect(
    state.getSnapshot().visits[navigationVisitKey("environment", "2000")],
  ).toBeUndefined();
  const before = state.getSnapshot();
  state.setScope("invalid scope");
  state.visit("environment", "bad", Infinity);
  state.visit("environment", "bad", -1);
  state.saveScroll("position", NaN);
  state.setCollapsed("__proto__", true);
  expect(state.getSnapshot()).toBe(before);
  state.visit("environment", "new", 3000);
  expect(Object.keys(state.getSnapshot().visits)).toHaveLength(2000);
  expect(
    state.getSnapshot().visits[navigationVisitKey("environment", "new")],
  ).toBe(3000);
});

test("scroll positions debounce writes and navigation remains usable without storage", async () => {
  vi.useFakeTimers();
  const local = storage();
  const state = new NavigationStore(local);
  state.saveScroll("scope", 123);
  state.saveScroll("scope", 456);
  expect(local.setItem).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(150);
  expect(local.setItem).toHaveBeenCalledTimes(1);
  expect(new NavigationStore(local).scrollPosition("scope")).toBe(456);
  const blocked = new NavigationStore({
    getItem: () => {
      throw Error("blocked");
    },
    setItem: () => {
      throw Error("blocked");
    },
  });
  blocked.setScope("remote");
  blocked.setView("recent");
  expect(blocked.getSnapshot().scope).toBe("remote");
  expect(blocked.getSnapshot().view).toBe("recent");
});
