import { useSyncExternalStore } from "react";

export const DEFAULT_MODEL_STORAGE_KEY = "codex-workbench.default-model";
const listeners = new Set<() => void>();

export function getDefaultModel(): string {
  try {
    return window.localStorage.getItem(DEFAULT_MODEL_STORAGE_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

export function setDefaultModel(model: string): void {
  window.localStorage.setItem(DEFAULT_MODEL_STORAGE_KEY, model.trim());
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === DEFAULT_MODEL_STORAGE_KEY || event.key === null)
      listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useDefaultModel() {
  return useSyncExternalStore(subscribe, getDefaultModel, () => "");
}
