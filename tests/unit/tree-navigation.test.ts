import { describe, expect, it } from "vitest";
import { relativeWorkspaceFile } from "../../src/features/files/tree-navigation";

describe("project tree navigation", () => {
  it("resolves nested project files and normalizes separators", () => {
    expect(relativeWorkspaceFile("/work/", "/work/src/a.ts")).toBe("src/a.ts");
    expect(relativeWorkspaceFile("C:\\Work", "c:\\work\\src\\a.ts")).toBe(
      "src/a.ts",
    );
    expect(relativeWorkspaceFile("/", "/src/a.ts")).toBe("src/a.ts");
  });
  it("excludes sibling projects, the root itself, and paths escaping the project", () => {
    expect(relativeWorkspaceFile("/work", "/workspace/a.ts")).toBeUndefined();
    expect(relativeWorkspaceFile("/work", "/work")).toBeUndefined();
    expect(relativeWorkspaceFile("/work", "../private/a.ts")).toBeUndefined();
    expect(relativeWorkspaceFile("/Work", "/work/a.ts")).toBeUndefined();
  });
});
