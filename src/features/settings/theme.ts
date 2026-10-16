import { useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
export const THEME_STORAGE_KEY = "codex-workbench.theme";
const listeners = new Set<() => void>();
let preference: ThemePreference = "system";
let media: MediaQueryList | undefined;
let cleanup: (() => void) | undefined;

function parse(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}
function apply() {
  if (typeof document === "undefined") return;
  const resolved =
    preference === "system" ? (media?.matches ? "dark" : "light") : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "dark" ? "#191c19" : "#f7f7f5");
}
function update(value: ThemePreference) {
  preference = value;
  apply();
  for (const listener of listeners) listener();
}
/** Initialize before rendering; the returned disposer removes browser listeners. */
export function initializeTheme() {
  cleanup?.();
  if (typeof window === "undefined") return () => {};
  try {
    preference = parse(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    preference = "system";
  }
  try {
    media = window.matchMedia("(prefers-color-scheme: dark)");
  } catch {
    media = undefined;
  }
  const onSystemChange = () => {
    apply();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null)
      update(parse(event.newValue));
  };
  media?.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorage);
  apply();
  const query = media;
  cleanup = () => {
    query?.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
    cleanup = undefined;
  };
  return cleanup;
}
export function setTheme(value: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    /* Theme selection still works when storage is unavailable. */
  }
  update(value);
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    () => preference,
    () => "system" as ThemePreference,
  );
  return { theme, setTheme };
}
