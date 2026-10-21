import { expect, it } from "vitest";
import {
  NAVIGATION_PERSONALIZATION_STORAGE_KEY,
  NavigationPersonalizationStore,
  personalizationKey,
} from "../../src/features/navigation/navigation-personalization";

function storage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}
it("keeps session and project pins local to their environment and persists both", () => {
  const local = storage();
  const store = new NavigationPersonalizationStore(local);
  store.toggleThread("local", "shared-id");
  store.toggleProject("remote", "project:shared-id");
  expect(store.isThreadPinned("local", "shared-id")).toBe(true);
  expect(store.isThreadPinned("remote", "shared-id")).toBe(false);
  expect(store.isProjectPinned("remote", "project:shared-id")).toBe(true);
  const restored = new NavigationPersonalizationStore(local);
  expect(restored.getSnapshot()).toEqual(store.getSnapshot());
  restored.toggleThread("local", "shared-id");
  expect(restored.getSnapshot().pinnedThreads).toEqual([]);
  expect(restored.getSnapshot().pinnedProjects).toEqual([
    personalizationKey("remote", "project:shared-id"),
  ]);
});
it("rejects malformed stored entries and avoids delimiter collisions", () => {
  const local = storage();
  const key = personalizationKey("one", "two:three");
  local.data.set(
    NAVIGATION_PERSONALIZATION_STORAGE_KEY,
    JSON.stringify({
      pinnedThreads: [null, "invalid", key, key, '[1,"two"]'],
      pinnedProjects: "bad",
    }),
  );
  expect(new NavigationPersonalizationStore(local).getSnapshot()).toEqual({
    pinnedThreads: [key],
    pinnedProjects: [],
  });
  expect(personalizationKey("one:two", "three")).not.toBe(key);
});
it("keeps personalization usable when browser storage cannot be written", () => {
  const store = new NavigationPersonalizationStore({
    getItem: () => {
      throw Error("blocked");
    },
    setItem: () => {
      throw Error("blocked");
    },
  });
  store.toggleThread("environment", "id");
  expect(store.isThreadPinned("environment", "id")).toBe(true);
});
