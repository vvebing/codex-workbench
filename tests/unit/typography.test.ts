import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultTypography,
  initializeTypography,
  setTypography,
  TYPOGRAPHY_STORAGE_KEY,
} from "../../src/features/settings/typography";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  vi.unstubAllGlobals();
});
function browser(raw: string | null = null, blocked = false) {
  const storage = new Map<string, string>();
  if (raw !== null) storage.set(TYPOGRAPHY_STORAGE_KEY, raw);
  const styles = new Map<string, string>([["--viewport-height", "800px"]]);
  const events = new EventTarget();
  vi.stubGlobal("document", {
    documentElement: {
      style: {
        setProperty: (key: string, value: string) => styles.set(key, value),
        removeProperty: (key: string) => styles.delete(key),
      },
    },
  });
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => {
        if (blocked) throw Error("unavailable");
        return storage.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (blocked) throw Error("unavailable");
        storage.set(key, value);
      },
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  return {
    styles,
    storage,
    sync(key: string | null, newValue: string | null) {
      events.dispatchEvent(
        Object.assign(new Event("storage"), { key, newValue }),
      );
    },
  };
}

describe("typography preferences", () => {
  it("migrates legacy scales without changing the rendered sizes", () => {
    const b = browser(
      JSON.stringify({
        fontScale: "1.25",
        codeFontScale: "1.125",
        interfaceFont: "system",
        codeFont: "courier",
      }),
    );
    dispose = initializeTypography();
    expect(Object.fromEntries(b.styles)).toMatchObject({
      "--font-scale": "1.25",
      "--code-font-size": "18.28125px",
      "--font-sans": "var(--font-system)",
      "--font-mono": "var(--font-courier)",
    });
  });
  it("persists partial changes and resets only typography overrides", () => {
    const b = browser();
    dispose = initializeTypography();
    setTypography({ fontSize: "21" });
    setTypography({ codeFont: "menlo" });
    expect(JSON.parse(b.storage.get(TYPOGRAPHY_STORAGE_KEY)!)).toEqual({
      ...defaultTypography,
      fontSize: "21",
      codeFont: "menlo",
    });
    setTypography(defaultTypography);
    expect(Object.fromEntries(b.styles)).toEqual({
      "--viewport-height": "800px",
    });
  });
  it("preserves fractional migrated sizes when another preference changes", () => {
    const b = browser(
      JSON.stringify({ fontScale: "0.875", codeFontScale: "0.875" }),
    );
    dispose = initializeTypography();
    setTypography({ codeFont: "menlo" });
    expect(JSON.parse(b.storage.get(TYPOGRAPHY_STORAGE_KEY)!)).toMatchObject({
      fontSize: "12.25",
      codeFontSize: "9.953125",
    });
    expect(b.styles.get("--code-font-size")).toBe("9.953125px");
  });
  it("rejects corrupt storage and out-of-range or unknown choices", () => {
    const b = browser("not json");
    dispose = initializeTypography();
    expect(b.styles.has("--font-scale")).toBe(false);
    b.sync(
      TYPOGRAPHY_STORAGE_KEY,
      JSON.stringify({
        fontSize: "99",
        codeFontSize: "16",
        interfaceFont: "__proto__",
        codeFont: "url(example)",
      }),
    );
    expect(b.styles.get("--code-font-size")).toBe("16px");
    expect(b.styles.has("--font-scale")).toBe(false);
    expect(b.styles.has("--font-sans")).toBe(false);
    expect(b.styles.has("--font-mono")).toBe(false);
  });
  it("syncs tabs, handles clearing, ignores other keys and disposes listeners", () => {
    const b = browser();
    dispose = initializeTypography();
    b.sync("other", JSON.stringify({ fontSize: "21" }));
    expect(b.styles.has("--font-scale")).toBe(false);
    b.sync(TYPOGRAPHY_STORAGE_KEY, JSON.stringify({ fontSize: "17.5" }));
    expect(b.styles.get("--font-scale")).toBe("1.25");
    b.sync(null, null);
    expect(b.styles.has("--font-scale")).toBe(false);
    dispose();
    b.sync(TYPOGRAPHY_STORAGE_KEY, JSON.stringify({ fontSize: "21" }));
    expect(b.styles.has("--font-scale")).toBe(false);
  });
  it("keeps controls usable without local storage", () => {
    const b = browser(null, true);
    dispose = initializeTypography();
    setTypography({ fontSize: "17.5", codeFont: "courier" });
    expect(b.styles.get("--font-scale")).toBe("1.25");
    expect(b.styles.get("--font-mono")).toBe("var(--font-courier)");
  });
  it("restores pixel sizes and keeps code size independent of interface changes", () => {
    const b = browser(JSON.stringify({ fontSize: "21", codeFontSize: "16" }));
    dispose = initializeTypography();
    expect(b.styles.get("--font-scale")).toBe("1.5");
    expect(b.styles.get("--code-font-size")).toBe("16px");
    setTypography({ fontSize: "14" });
    expect(b.styles.has("--font-scale")).toBe(false);
    expect(b.styles.get("--code-font-size")).toBe("16px");
  });
});
