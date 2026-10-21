import { describe, expect, it } from "vitest";
import {
  projectPanelKey,
  normalizeProjectTab,
  ProjectPanelStateCache,
} from "../../src/features/conversation/project-panel-state";

describe("project panel state", () => {
  it("maps both former tool tabs to the merged workspace", () => {
    const cache = new ProjectPanelStateCache();
    for (const old of ["session", "project"] as const) {
      cache.select(old, old);
      expect(cache.tab(old)).toBe("workspace");
      expect(normalizeProjectTab(old)).toBe("workspace");
    }
    expect(normalizeProjectTab("unknown")).toBe("files");
  });
  it("restores tabs by canonical project across sessions and cwds", () => {
    const cache = new ProjectPanelStateCache();
    const a = projectPanelKey("environment/account", {
      projectId: "project-a",
      cwd: "/repo/a",
    });
    const same = projectPanelKey("environment/account", {
      projectId: "project-a",
      cwd: "/repo/a/subdir",
    });
    const b = projectPanelKey("environment/account", {
      projectId: "project-b",
      cwd: "/repo/a",
    });
    cache.select(a, "git");
    expect(cache.tab(same)).toBe("git");
    expect(cache.tab(b)).toBe("files");
    cache.select(b, "workspace");
    expect(cache.tab(a)).toBe("git");
    expect(
      cache.tab(
        projectPanelKey("other-account", {
          projectId: "project-a",
          cwd: "/repo/a",
        }),
      ),
    ).toBe("files");
  });
  it("falls back to cwd without project metadata and keeps resource scrolling separate", () => {
    const cache = new ProjectPanelStateCache();
    const fallback = projectPanelKey("scope", {
      projectId: null,
      cwd: "/repo",
    });
    cache.select(fallback, "workspace");
    expect(
      cache.tab(projectPanelKey("scope", { projectId: null, cwd: "/repo" })),
    ).toBe("workspace");
    expect(
      cache.tab(
        projectPanelKey("scope", { projectId: null, cwd: "/elsewhere" }),
      ),
    ).toBe("files");
    cache.savePosition("scope", JSON.stringify(["session", "thread-a"]), 420);
    cache.savePosition("scope", JSON.stringify(["git", "/repo"]), 120);
    expect(
      cache.position("scope", JSON.stringify(["session", "thread-b"])),
    ).toBe(0);
    expect(
      cache.position("scope", JSON.stringify(["session", "thread-a"])),
    ).toBe(420);
    expect(
      cache.position("other-scope", JSON.stringify(["git", "/repo"])),
    ).toBe(0);
    expect(cache.position("scope", JSON.stringify(["files", "/repo"]))).toBe(0);
  });
  it("evicts least recently visited entries", () => {
    const cache = new ProjectPanelStateCache(2);
    cache.select("a", "git");
    cache.select("b", "workspace");
    cache.tab("a");
    cache.select("c", "git");
    expect(cache.tab("a")).toBe("git");
    expect(cache.tab("b")).toBe("files");
  });
});
