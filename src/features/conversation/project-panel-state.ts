import type { Thread } from "../../generated/v2/Thread";

export type ProjectTab = "files" | "git" | "workspace";
/** Preserve a previously selected tools tab when the UI is updated in place. */
export function normalizeProjectTab(tab: string): ProjectTab {
  if (tab === "session" || tab === "project") return "workspace";
  return tab === "git" || tab === "workspace" ? tab : "files";
}
export function projectPanelKey(
  scope: string,
  thread?: Pick<Thread, "projectId" | "cwd">,
) {
  return JSON.stringify([
    scope,
    thread?.projectId
      ? ["project", thread.projectId]
      : ["cwd", thread?.cwd ?? ""],
  ]);
}
export class ProjectPanelStateCache {
  private tabs = new Map<string, ProjectTab>();
  private scroll = new Map<string, number>();
  constructor(private capacity = 200) {}
  private keep<T>(map: Map<string, T>, key: string, value: T) {
    map.delete(key);
    map.set(key, value);
    while (map.size > this.capacity) map.delete(map.keys().next().value!);
    return value;
  }
  tab(key: string) {
    return this.keep(
      this.tabs,
      key,
      normalizeProjectTab(this.tabs.get(key) ?? "files"),
    );
  }
  select(key: string, tab: ProjectTab | "session" | "project") {
    this.keep(this.tabs, key, normalizeProjectTab(tab));
  }
  position(scope: string, resource: string) {
    const key = JSON.stringify([scope, resource]);
    return this.keep(this.scroll, key, this.scroll.get(key) ?? 0);
  }
  savePosition(scope: string, resource: string, top: number) {
    this.keep(this.scroll, JSON.stringify([scope, resource]), top);
  }
}
export const projectPanelState = new ProjectPanelStateCache();
