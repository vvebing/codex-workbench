import { useSyncExternalStore } from "react";

export type RunningSendMode = "queue" | "steer";
export const RUNNING_SEND_STORAGE_KEY = "codex-workbench.running-send-mode";
export const AUTO_COLLAPSE_STORAGE_KEY =
  "codex-workbench.auto-collapse-process";
const listeners = new Set<() => void>();

export function getRunningSendMode(): RunningSendMode {
  try {
    return localStorage.getItem(RUNNING_SEND_STORAGE_KEY) === "steer"
      ? "steer"
      : "queue";
  } catch {
    return "queue";
  }
}
export function setRunningSendMode(mode: RunningSendMode): void {
  localStorage.setItem(RUNNING_SEND_STORAGE_KEY, mode);
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === RUNNING_SEND_STORAGE_KEY ||
      event.key === AUTO_COLLAPSE_STORAGE_KEY ||
      event.key === null
    )
      listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
export function useRunningSendMode() {
  return useSyncExternalStore(
    subscribe,
    getRunningSendMode,
    () => "queue" as const,
  );
}

export function getAutoCollapseProcess(): boolean {
  try {
    return localStorage.getItem(AUTO_COLLAPSE_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}
export function setAutoCollapseProcess(enabled: boolean): void {
  localStorage.setItem(AUTO_COLLAPSE_STORAGE_KEY, String(enabled));
  for (const listener of listeners) listener();
}
export function useAutoCollapseProcess() {
  return useSyncExternalStore(subscribe, getAutoCollapseProcess, () => true);
}
