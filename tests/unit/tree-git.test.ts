import { describe, expect, it } from "vitest";
import { treeGitDecorations } from "../../src/features/shell/tree-git";
import { parseWorkspaceGitStatus } from "../../src/features/shell/git-status";

describe("file tree Git decorations", () => {
  it("maps repository paths into a nested cwd and aggregates deleted and renamed files once", () => {
    const status = {
      ...parseWorkspaceGitStatus(
        "# branch.head main\0" +
          "2 R. N... 100644 100644 100644 abc def R100 sub/new/a.ts\0sub/old/a.ts\0" +
          "1 .D N... 100644 100644 100644 abc def sub/new/deleted.ts\0" +
          "? elsewhere/file.ts\0",
      ),
      repoRoot: "/repo",
    };
    const result = treeGitDecorations(status, "/repo/sub");
    expect(result.get("")?.count).toBe(2);
    expect(result.get("new")?.count).toBe(2);
    expect(result.get("old")?.count).toBe(1);
    expect(result.get("new/a.ts")?.badge).toBe("R");
    expect(result.get("new/deleted.ts")?.badge).toBe("D");
    expect(result.has("elsewhere/file.ts")).toBe(false);
    expect(treeGitDecorations(status, "/repo/submarine").size).toBe(0);
    expect(
      treeGitDecorations({ ...status, repoRoot: undefined }, "/repo").size,
    ).toBe(0);
  });
  it("prioritizes conflict summaries and explains staged and worktree states", () => {
    const status = {
      ...parseWorkspaceGitStatus(
        "# branch.head main\0" +
          "u UU N... 100644 100644 100644 100644 abc def ghi src/conflict.ts\0" +
          "1 AM N... 100644 100644 100644 abc def src/both.ts\0",
      ),
      repoRoot: "/repo",
    };
    const result = treeGitDecorations(status, "/repo");
    expect(result.get("src")?.badge).toBe("U");
    expect(result.get("src")?.label).toContain("冲突");
    expect(result.get("src/both.ts")?.label).toBe(
      "暂存区：已添加；工作区：已修改",
    );
  });
});
