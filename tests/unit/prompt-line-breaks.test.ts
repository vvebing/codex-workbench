import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Markdown } from "../../src/features/conversation/Markdown";
vi.mock("../../src/lib/runtime-context", () => ({
  useRuntime: () => ({ files: { open: vi.fn() } }),
}));
const render = (text: string, preserveLineBreaks = true) =>
  renderToStaticMarkup(createElement(Markdown, { text, preserveLineBreaks }));

describe("user prompt Markdown line breaks", () => {
  it("preserves a single newline, including Markdown's lazy quote continuation", () => {
    const html = render(
      "> 查看 im-preview.aicoin.com 下 /api 的“后端服务”\n然后呢",
    );
    expect(html).toContain("<blockquote>");
    expect(html).toContain("“后端服务”<br/>\n然后呢</p>");
    expect(html).toContain("然后呢</p>\n</blockquote>");
    expect(render("第一行\r\n第二行")).toContain("第一行<br/>\n第二行");
  });
  it("uses a blank line to end the quote without changing the user's text", () => {
    expect(render("> 引用内容\n\n然后呢")).toContain(
      "</blockquote>\n<p>然后呢</p>",
    );
  });
  it("preserves list continuations and does not add duplicate hard breaks", () => {
    expect(render("- 第一行\n  第二行")).toContain("第一行<br/>\n第二行");
    expect(render("第一行  \n第二行").match(/<br\/>/g)).toHaveLength(1);
  });
  it("leaves assistant Markdown and code blocks unchanged", () => {
    expect(render("第一行\n第二行", false)).not.toContain("<br");
    const html = render("```text\nfirst\nsecond\n```");
    expect(html).toContain("first\nsecond\n</code>");
    expect(html).not.toContain("<br");
    expect(render("`first\nsecond`")).not.toContain("<br");
  });
});
