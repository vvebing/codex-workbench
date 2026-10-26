import { describe, expect, it } from "vitest";
import {
  attachmentPath,
  projectFileDrop,
} from "../../src/features/composer/file-attachments";

describe("composer file attachments", () => {
  it("places named files in an isolated project attachment directory", () => {
    expect(attachmentPath("/workspace", "需求.pdf", "upload-id")).toBe(
      "/workspace/.codex-workbench/attachments/upload-id/需求.pdf",
    );
    for (const name of [
      "../secret",
      "a/b",
      "a\\b",
      ".",
      "..",
      "",
      "a\u0000b",
      "C:secret",
    ]) {
      expect(() => attachmentPath("/workspace", name, "upload-id")).toThrow();
    }
  });
  it("accepts matching project references and rejects cross-project or forged paths", () => {
    const item = {
      cwd: "/workspace",
      relative: "src/a.ts",
      path: "/workspace/src/a.ts",
    };
    expect(projectFileDrop(JSON.stringify(item), "/workspace")).toEqual({
      relative: "src/a.ts",
      path: "/workspace/src/a.ts",
    });
    expect(() => projectFileDrop(JSON.stringify(item), "/other")).toThrow(
      "当前项目",
    );
    expect(() =>
      projectFileDrop(
        JSON.stringify({ ...item, path: "/etc/passwd" }),
        "/workspace",
      ),
    ).toThrow("路径");
    expect(() =>
      projectFileDrop(
        JSON.stringify({ ...item, relative: "../secret" }),
        "/workspace",
      ),
    ).toThrow();
  });
});
