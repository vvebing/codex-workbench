import { useEffect, useState, useSyncExternalStore } from "react";
export function useStore<T>(store: {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
}): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
export function useNarrow() {
  const [narrow, set] = useState(
    () => matchMedia("(max-width: 900px)").matches,
  );
  useEffect(() => {
    const query = matchMedia("(max-width: 900px)");
    const listener = () => set(query.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
  return narrow;
}
export const titleOf = (t?: { name?: string | null; preview?: string }) =>
  t?.name || t?.preview || "新会话";
export const folderOf = (path: string) =>
  path.split("/").filter(Boolean).at(-1) || "工作区";
export function relativeTime(timestamp: number, now = Date.now()) {
  const seconds = Math.max(0, now / 1000 - timestamp);
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时`;
  return `${Math.floor(seconds / 86400)} 天`;
}

// Mobile keyboards can resize the visual viewport without changing 100dvh.
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      if (viewport.scale !== 1) return;
      document.documentElement.style.setProperty(
        "--viewport-height",
        `${viewport.height}px`,
      );
      document.documentElement.style.setProperty(
        "--viewport-top",
        `${viewport.offsetTop}px`,
      );
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      document.documentElement.style.removeProperty("--viewport-height");
      document.documentElement.style.removeProperty("--viewport-top");
    };
  }, []);
}
