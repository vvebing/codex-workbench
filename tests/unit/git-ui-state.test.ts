import { describe, expect, it } from "vitest";
import {
  GitUiStateCache,
  gitUiState,
} from "../../src/features/shell/git-ui-state";

describe("Git UI state", () => {
  it("retains UI choices by canonical root without sharing connections or scopes", () => {
    const connection = {};
    const state = gitUiState(connection, 1, "/repo");
    state.treeView = false;
    state.selected = { path: "src/app.ts", group: "unstaged" };
    state.groups.staged = false;
    state.directories["unstaged:src"] = false;
    expect(gitUiState(connection, 1, "/repo")).toBe(state);
    expect(gitUiState(connection, 1, "/elsewhere").treeView).toBe(true);
    expect(gitUiState(connection, 2, "/repo").selected).toBeUndefined();
    expect(gitUiState({}, 1, "/repo").treeView).toBe(true);
  });
  it("bounds retained repository UI entries", () => {
    const cache = new GitUiStateCache(1);
    cache.entry(1, "/a").treeView = false;
    cache.entry(1, "/b");
    expect(cache.entry(1, "/a").treeView).toBe(true);
  });
});
