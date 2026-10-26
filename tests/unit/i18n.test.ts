import { afterEach, expect, it, vi } from "vitest";
import i18n, {
  getLanguagePreference,
  getLocale,
  resolveLanguage,
  setLanguagePreference,
  t,
} from "../../src/lib/i18n";

afterEach(() => {
  vi.unstubAllGlobals();
  setLanguagePreference("system");
});
it("follows the preferred browser language with an English fallback", () => {
  expect(resolveLanguage(["zh-TW", "en-US"])).toBe("zh-CN");
  expect(resolveLanguage(["en-US", "zh-CN"])).toBe("en");
  expect(resolveLanguage(["fr-FR"])).toBe("en");
  expect(resolveLanguage([])).toBe("en");
});
it("persists an explicit choice and updates helpers and document metadata immediately", () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal("document", { documentElement: { lang: "" }, title: "" });
  setLanguagePreference("en");
  expect(getLanguagePreference()).toBe("en");
  expect(getLocale()).toBe("en");
  expect(t("关闭")).toBe("Close");
  expect(document.documentElement.lang).toBe("en");
  expect(document.title).toBe("Codex Workbench");
  expect(storage.get("codex-workbench.language")).toBe("en");
  setLanguagePreference("zh-CN");
  expect(t("关闭")).toBe("关闭");
  expect(document.documentElement.lang).toBe("zh-CN");
});
it("retains a manual choice when browser storage is unavailable", () => {
  vi.stubGlobal("localStorage", {
    setItem() {
      throw Error("blocked");
    },
  });
  setLanguagePreference("en");
  expect(getLanguagePreference()).toBe("en");
  expect(i18n.language).toBe("en");
});
it("treats punctuation as literal keys and preserves interpolated user content", () => {
  setLanguagePreference("en");
  expect(t("MCP 登录失败：{{v0}}", { v0: "<用户原文>" })).toBe(
    "MCP sign-in failed: <用户原文>",
  );
});

it("preserves a session title when changing preferences without changing the resolved language", () => {
  vi.stubGlobal("document", {
    documentElement: { lang: "en" },
    title: "User session · Codex Workbench",
  });
  setLanguagePreference("en");
  expect(document.title).toBe("User session · Codex Workbench");
});
