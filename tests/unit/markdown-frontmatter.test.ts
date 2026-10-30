import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { splitFrontmatter } from "../../src/features/files/markdown-frontmatter";

describe("file preview frontmatter", () => {
  it("separates the design document metadata from its heading", () => {
    const result = splitFrontmatter(readFileSync("DESIGN.md", "utf8"));
    expect(result.body.trimStart()).toMatch(/^# Design System/);
    expect(result.rows).toContainEqual({
      key: "name",
      value: "Codex Workbench",
    });
    expect(result.rows.find((row) => row.key === "colors")?.value).toContain(
      'background: "#ffffff"',
    );
  });

  it("supports BOM, CRLF, lists, multiline values and YAML end markers", () => {
    const result = splitFrontmatter(
      "\uFEFF---\r\ntags: [one, two]\r\nnote: |\r\n  hello\r\n  world\r\n...\r\n# Body",
    );
    expect(result.body).toBe("# Body");
    expect(result.rows).toContainEqual({
      key: "note",
      value: "hello\nworld\n",
    });
    expect(result.rows[0].value).toContain("- one");
  });

  it.each([
    "---\n# Heading\n\nBody",
    "---\nname: [broken\n---\n# Body",
    "---\n- list\n---\n# Body",
    "# Heading\n\n---\nname: body\n---",
  ])("preserves ordinary Markdown or malformed metadata: %s", (text) => {
    expect(splitFrontmatter(text)).toEqual({ body: text, rows: [] });
  });
});
