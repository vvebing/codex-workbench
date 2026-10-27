import { describe, expect, it } from "vitest";
import { DraftsStore } from "../../src/features/composer/drafts";
import {
  MAX_PREVIEW_BYTES,
  previewText,
  referenceProjectFile,
  workspacePath,
} from "../../src/features/shell/project-files";

const base64 = (text: string) => Buffer.from(text).toString("base64");

describe("project file preview", () => {
  it("decodes UTF-8 and empty files, rejecting binary and oversized responses", () => {
    expect(previewText(base64("中文\nhello"))).toBe("中文\nhello");
    expect(previewText("")).toBe("");
    expect(() => previewText(base64("a\0b"))).toThrow("二进制");
    expect(() => previewText(Buffer.from([0xff]).toString("base64"))).toThrow(
      "UTF-8",
    );
    expect(() =>
      previewText(base64("x".repeat(MAX_PREVIEW_BYTES + 1))),
    ).toThrow("8 MB");
  });

  it("previews larger text using the workspace byte limit", () => {
    const text = "x".repeat(1024 * 1024);
    expect(previewText(base64(text))).toBe(text);
    expect(previewText(base64("中文"), 6)).toBe("中文");
    expect(() => previewText(base64("中文"), 5)).toThrow("预览");
    expect(() =>
      previewText(
        base64("x".repeat(MAX_PREVIEW_BYTES + 1)),
        MAX_PREVIEW_BYTES * 2,
      ),
    ).toThrow("8 MB");
  });

  it("keeps relative candidates inside the project and supports Windows roots", () => {
    expect(workspacePath("/workspace", "foo:bar/a.ts")).toBe(
      "/workspace/foo:bar/a.ts",
    );
    expect(workspacePath("/workspace/", "src/a.ts")).toBe(
      "/workspace/src/a.ts",
    );
    expect(workspacePath("C:\\work", "src\\a.ts")).toBe("C:\\work/src/a.ts");
    for (const path of [
      "../secrets",
      "/etc/passwd",
      "src/../../a",
      "C:\\other",
      "src//a",
      ".",
    ])
      expect(() => workspacePath("/workspace", path)).toThrow();
  });
});

describe("project file draft references", () => {
  it("preserves existing document, skills and images when appending a file reference", () => {
    const drafts = new DraftsStore();
    drafts.setDocument(
      "t",
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "reference",
                attrs: {
                  kind: "skill",
                  name: "review",
                  value: "$review",
                  path: "/skills/review",
                },
              },
            ],
          },
        ],
      },
      "$review",
      [{ name: "review", path: "/skills/review" }],
    );
    drafts.addImage("t", {
      id: "image",
      name: "ref.png",
      url: "data:image/png;base64,a",
    });
    const before = drafts.get("t");
    referenceProjectFile(drafts, "t", "src/a b.ts", "/workspace/src/a b.ts");
    const after = drafts.get("t");
    expect(after.text).toBe('$review\n"/workspace/src/a b.ts" ');
    expect(after.document?.content?.[0]).toEqual(before.document?.content?.[0]);
    expect(after.document?.content?.[1].content?.[0]).toMatchObject({
      type: "reference",
      attrs: { kind: "file", path: "/workspace/src/a b.ts" },
    });
    expect(after.skills).toEqual(before.skills);
    expect(after.images).toEqual(before.images);
    expect(before.document?.content).toHaveLength(1);
    expect(after.revision).toBe(before.revision + 1);
  });

  it("does not add an empty first paragraph and edits only the selected draft", () => {
    const drafts = new DraftsStore();
    drafts.setText("other", "keep");
    referenceProjectFile(drafts, "t", "README.md", "/workspace/README.md");
    expect(drafts.get("t").document?.content).toHaveLength(1);
    expect(drafts.get("other").text).toBe("keep");
  });
});
