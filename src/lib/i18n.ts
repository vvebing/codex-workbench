import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { useSyncExternalStore } from "react";
import { initReactI18next, useTranslation } from "react-i18next";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

export type LanguagePreference = "system" | "en" | "zh-CN";
const storageKey = "codex-workbench.language";
function readLanguagePreference(): LanguagePreference {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === "en" || value === "zh-CN") return value;
  } catch {
    /* Storage may be unavailable in private browser contexts. */
  }
  return "system";
}
export function resolveLanguage(
  languages: readonly string[] = typeof navigator === "undefined"
    ? []
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language],
): "en" | "zh-CN" {
  return languages[0]?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}
let preference = readLanguagePreference();
const preferenceListeners = new Set<() => void>();
export function getLanguagePreference() {
  return preference;
}
export function useLanguagePreference() {
  return useSyncExternalStore(
    (listener) => {
      preferenceListeners.add(listener);
      return () => {
        preferenceListeners.delete(listener);
      };
    },
    getLanguagePreference,
    () => "system" as LanguagePreference,
  );
}
void i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, "zh-CN": { translation: zh } },
    lng: preference === "system" ? resolveLanguage() : preference,
    fallbackLng: "en",
    supportedLngs: ["en", "zh-CN"],
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    detection: { order: ["navigator"], caches: [] },
    initAsync: false,
  });
export function t(key: string, values?: Record<string, unknown>): string {
  return String(i18next.t(key, values));
}
export function useLocale() {
  useTranslation();
  return i18next.resolvedLanguage ?? "en";
}
export function getLocale() {
  return i18next.resolvedLanguage === "zh-CN" ? "zh-CN" : "en";
}
export function setLanguagePreference(value: LanguagePreference) {
  preference = value;
  preferenceListeners.forEach((listener) => listener());
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    /* Keep the preference for this session. */
  }
  void i18next.changeLanguage(value === "system" ? resolveLanguage() : value);
}
function updateDocumentLanguage() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = getLocale();
  // App owns session-specific titles; only update the initial generic title here.
  if (
    !document.title ||
    ["Codex Workbench", "Codex 工作台"].includes(document.title)
  )
    document.title = t("Codex 工作台");
}
i18next.on("languageChanged", updateDocumentLanguage);
updateDocumentLanguage();
if (typeof window !== "undefined") {
  window.addEventListener("languagechange", () => {
    if (getLanguagePreference() === "system")
      void i18next.changeLanguage(resolveLanguage());
  });
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey || event.key === null) {
      const value = readLanguagePreference();
      preference = value;
      preferenceListeners.forEach((listener) => listener());
      void i18next.changeLanguage(
        value === "system" ? resolveLanguage() : value,
      );
    }
  });
}
export default i18next;

export { i18next as i18n };
