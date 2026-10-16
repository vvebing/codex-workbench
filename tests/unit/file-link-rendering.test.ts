import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it, vi } from "vitest";
import {
  FileAnchor,
  FileLinkProvider,
} from "../../src/features/files/FileLinkContext";
import { fileLinkUrlTransform } from "../../src/features/files/file-links";

vi.mock("../../src/lib/runtime-context", () => ({
  useRuntime: () => ({ files: { open: vi.fn(async () => {}) } }),
}));

function markdown(text: string) {
  return createElement(ReactMarkdown, {
    children: text,
    urlTransform: fileLinkUrlTransform,
    components: { a: FileAnchor },
  });
}

describe("Markdown file anchor rendering", () => {
  it("keeps validated local URI anchors inside an originating timeline", () => {
    const html = renderToStaticMarkup(
      createElement(FileLinkProvider, {
        cwd: "/origin",
        threadId: "original",
        children: markdown(
          "[source](file:///origin/a%20b.ts#L4-L8) [web](https://example.com) `src/no-link.ts`",
        ),
      }),
    );
    expect(html).toContain('href="file:///origin/a%20b.ts#L4-L8"');
    expect(html).toContain('title="/origin/a b.ts"');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("<code>src/no-link.ts</code>");
    expect(html.match(/<a /g)).toHaveLength(2);
  });

  it("keeps unsafe protocols sanitized and does not enable file protocols without origin", () => {
    const html = renderToStaticMarkup(
      markdown("[unsafe](javascript:alert) [file](file:///tmp/a.ts)"),
    );
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("file://");
    expect(html.match(/href=""/g)).toHaveLength(2);
  });
});
