import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initializeTheme,
  setTheme,
  THEME_STORAGE_KEY,
} from "../../src/features/settings/theme";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  vi.unstubAllGlobals();
});
function browser(
  stored: string | null = null,
  dark = false,
  brokenStorage = false,
) {
  const storage = new Map<string, string>();
  if (stored !== null) storage.set(THEME_STORAGE_KEY, stored);
  const windowEvents = new EventTarget();
  const mediaEvents = new EventTarget();
  const media = {
    matches: dark,
    addEventListener: mediaEvents.addEventListener.bind(mediaEvents),
    removeEventListener: mediaEvents.removeEventListener.bind(mediaEvents),
  };
  const root = {
    dataset: {} as Record<string, string>,
    style: { colorScheme: "" },
  };
  const meta = {
    content: "",
    setAttribute(_name: string, value: string) {
      this.content = value;
    },
  };
  vi.stubGlobal("document", {
    documentElement: root,
    querySelector: () => meta,
  });
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => {
        if (brokenStorage) throw Error("blocked");
        return storage.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (brokenStorage) throw Error("blocked");
        storage.set(key, value);
      },
    },
    matchMedia: () => media,
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
  });
  return {
    root,
    meta,
    storage,
    changeSystem(value: boolean) {
      media.matches = value;
      mediaEvents.dispatchEvent(new Event("change"));
    },
    sync(key: string | null, newValue: string | null) {
      windowEvents.dispatchEvent(
        Object.assign(new Event("storage"), { key, newValue }),
      );
    },
  };
}
describe("theme preferences", () => {
  it("defaults to system and follows changes", () => {
    const b = browser(null, true);
    dispose = initializeTheme();
    expect(b.root.dataset.theme).toBe("dark");
    expect(b.meta.content).toBe("#191c19");
    b.changeSystem(false);
    expect(b.root.dataset.theme).toBe("light");
    expect(b.root.style.colorScheme).toBe("light");
    expect(b.meta.content).toBe("#f7f7f5");
  });
  it("persists explicit themes and ignores system changes until system is selected", () => {
    const b = browser("dark");
    dispose = initializeTheme();
    setTheme("light");
    expect(b.storage.get(THEME_STORAGE_KEY)).toBe("light");
    b.changeSystem(true);
    expect(b.root.dataset.theme).toBe("light");
    setTheme("system");
    expect(b.root.dataset.theme).toBe("dark");
  });
  it("syncs other tabs, handles invalid values and storage clearing", () => {
    const b = browser("invalid", true);
    dispose = initializeTheme();
    expect(b.root.dataset.theme).toBe("dark");
    b.sync(THEME_STORAGE_KEY, "light");
    expect(b.root.dataset.theme).toBe("light");
    b.sync("other", "dark");
    expect(b.root.dataset.theme).toBe("light");
    b.sync(null, null);
    expect(b.root.dataset.theme).toBe("dark");
  });
  it("works with unavailable storage and cleans up listeners", () => {
    const b = browser(null, false, true);
    dispose = initializeTheme();
    setTheme("dark");
    expect(b.root.dataset.theme).toBe("dark");
    dispose();
    b.sync(THEME_STORAGE_KEY, "light");
    expect(b.root.dataset.theme).toBe("dark");
  });
});
