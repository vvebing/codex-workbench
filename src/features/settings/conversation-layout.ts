import { useSyncExternalStore } from "react";

const KEY = "codex-workbench.conversation-width";
type Width = "fluid" | "reading" | "wide";
let width: Width = "reading";
const listeners = new Set<() => void>();
let cleanup: (() => void) | undefined;
function apply(value: string | null) {
  width = value === "fluid" || value === "wide" ? value : "reading";
  document.documentElement.style.setProperty(
    "--conversation-max-width",
    width === "fluid" ? "100%" : width === "wide" ? "1128px" : "928px",
  );
  listeners.forEach((listener) => listener());
}
export function initializeConversationLayout() {
  cleanup?.();
  let value: string | null = null;
  try {
    value = localStorage.getItem(KEY);
  } catch {
    /* Storage is optional. */
  }
  apply(value);
  const sync = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) apply(event.newValue);
  };
  window.addEventListener("storage", sync);
  cleanup = () => window.removeEventListener("storage", sync);
  return cleanup;
}
export function setConversationWidth(value: string) {
  apply(value);
  try {
    localStorage.setItem(KEY, width);
  } catch {
    /* Apply for this visit. */
  }
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useConversationWidth() {
  return useSyncExternalStore(
    subscribe,
    () => width,
    () => "reading" as Width,
  );
}
