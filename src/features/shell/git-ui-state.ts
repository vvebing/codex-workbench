import type { GitGroup } from "./git-status";
export interface GitUiState {
  treeView: boolean;
  selected?: { path: string; group: GitGroup };
  groups: Partial<Record<GitGroup, boolean>>;
  directories: Record<string, boolean>;
}
export class GitUiStateCache {
  private entries = new Map<string, GitUiState>();
  constructor(private capacity = 100) {}
  entry(scope: number, root: string) {
    const key = JSON.stringify([scope, root]);
    const state = this.entries.get(key) ?? {
      treeView: true,
      groups: {},
      directories: {},
    };
    this.entries.delete(key);
    this.entries.set(key, state);
    while (this.entries.size > this.capacity)
      this.entries.delete(this.entries.keys().next().value!);
    return state;
  }
}
const caches = new WeakMap<object, GitUiStateCache>();
export function gitUiState(connection: object, scope: number, root: string) {
  let cache = caches.get(connection);
  if (!cache) {
    cache = new GitUiStateCache();
    caches.set(connection, cache);
  }
  return cache.entry(scope, root);
}
