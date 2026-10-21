import { useSyncExternalStore } from "react";

const KEY = "codex-workbench.sidebar-widths";
export const SIDEBARS = {
  navigation: { initial: 280, min: 240, max: 400 },
  details: { initial: 320, min: 280, max: 480 },
};
export type Side = keyof typeof SIDEBARS;
type Widths = Record<Side, number>;
const defaults: Widths = { navigation: 280, details: 320 };
let widths = defaults;
const listeners = new Set<() => void>();
let cleanup: (() => void) | undefined;
function parse(raw: string | null): Widths {
  try {
    const value = JSON.parse(raw ?? "null");
    return Object.fromEntries(
      Object.entries(SIDEBARS).map(([key, range]) => {
        const width = value?.[key];
        return [
          key,
          typeof width === "number" && Number.isFinite(width)
            ? Math.max(range.min, Math.min(range.max, width))
            : range.initial,
        ];
      }),
    ) as Widths;
  } catch {
    return defaults;
  }
}
function publish(next: Widths) {
  widths = next;
  listeners.forEach((listener) => listener());
}
export function initializeSidebarLayout() {
  cleanup?.();
  try {
    publish(parse(localStorage.getItem(KEY)));
  } catch {
    publish(defaults);
  }
  const sync = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) publish(parse(event.newValue));
  };
  window.addEventListener("storage", sync);
  cleanup = () => window.removeEventListener("storage", sync);
  return cleanup;
}
export function setSidebarWidth(side: Side, width: number) {
  const next = parse(JSON.stringify({ ...widths, [side]: width }));
  publish(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* Storage is optional. */
  }
}
export function resetSidebarWidths() {
  publish(defaults);
  try {
    localStorage.removeItem(KEY);
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
export function useSidebarWidths() {
  return useSyncExternalStore(
    subscribe,
    () => widths,
    () => defaults,
  );
}
const onResize = (listener: () => void) => {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
};
export function useViewportWidth() {
  return useSyncExternalStore(
    onResize,
    () => document.documentElement.clientWidth,
    () => 1440,
  );
}

/** Temporary viewport constraints must never overwrite preferred pixel widths. */
export function fitSidebars(
  total: number,
  preferred: Widths,
  navigation: boolean,
  details: boolean,
) {
  const handles = (Number(navigation) + Number(details)) * 2;
  const available = Math.max(1, total - handles);
  let left = navigation ? preferred.navigation : 0;
  let right = details ? preferred.details : 0;
  const minLeft = navigation ? SIDEBARS.navigation.min : 0;
  const minRight = details ? SIDEBARS.details.min : 0;
  const excess = Math.max(0, left + right + 480 - available);
  const reducible = left + right - minLeft - minRight;
  if (excess > 0 && reducible > 0) {
    const factor = Math.min(1, excess / reducible);
    left -= (left - minLeft) * factor;
    right -= (right - minRight) * factor;
  }
  return { available, left, right };
}
