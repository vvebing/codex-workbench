import { afterEach, expect, it, vi } from "vitest";
import {
  initializeConversationLayout,
  setConversationWidth,
} from "../../src/features/settings/conversation-layout";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  vi.unstubAllGlobals();
});

it("defaults to comfortable prose, restores existing preferences, and persists changes", () => {
  const values = new Map<string, string>();
  const styles = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("document", {
    documentElement: {
      style: {
        setProperty: (key: string, value: string) => styles.set(key, value),
      },
    },
  });
  vi.stubGlobal("window", new EventTarget());
  dispose = initializeConversationLayout();
  expect(styles.get("--conversation-max-width")).toBe("928px");
  setConversationWidth("wide");
  dispose = initializeConversationLayout();
  expect(styles.get("--conversation-max-width")).toBe("1128px");
  setConversationWidth("fluid");
  dispose = initializeConversationLayout();
  expect(styles.get("--conversation-max-width")).toBe("100%");
  setConversationWidth("invalid");
  expect(styles.get("--conversation-max-width")).toBe("928px");
});
