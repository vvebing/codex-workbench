import { describe, expect, it } from "vitest";
import { gitWorkspacePath } from "../../src/features/shell/git-workspace-path";
describe("Git workspace path mapping", () => {
  it("maps physical root and nested cwd file paths", () => {
    expect(
      gitWorkspacePath("/repo", "/repo/src", "src/", "/repo/src/a.ts"),
    ).toBe("src/a.ts");
  });
  it("maps filesystem aliases through the prefix resolved by Git", () => {
    expect(
      gitWorkspacePath("/physical/repo", "/alias", "src/", "/alias/a.ts"),
    ).toBe("src/a.ts");
    expect(
      gitWorkspacePath("/physical/repo", "/alias", "", "/alias/a.ts"),
    ).toBe("a.ts");
  });
  it("rejects unrelated paths and unresolved aliases", () => {
    expect(
      gitWorkspacePath("/repo", "/alias", undefined, "/alias/a.ts"),
    ).toBeUndefined();
    expect(
      gitWorkspacePath("/repo", "/alias", "", "/other/a.ts"),
    ).toBeUndefined();
  });
});
