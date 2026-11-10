import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Markdown } from "../../src/features/conversation/Markdown";
import { TerminalCommandProvider } from "../../src/features/conversation/TerminalCommandContext";
import { terminalCodeCommand } from "../../src/features/conversation/terminal-code-action";

const captured = vi.hoisted(() => ({
  copy: undefined as ((event: unknown) => unknown) | undefined,
}));
vi.mock("../../src/components/ui", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/components/ui")>();
  const react = await import("react");
  return {
    ...actual,
    Button: (props: ComponentProps<typeof actual.Button>) => {
      if (props["aria-label"] === "复制代码")
        captured.copy = props.onClick as (event: unknown) => unknown;
      return react.createElement(actual.Button, props);
    },
  };
});

function render(text: string, withTerminal = true, streaming = false) {
  const fill = vi.fn(() => true);
  const content = createElement(Markdown, { text, streaming });
  const html = renderToStaticMarkup(
    withTerminal
      ? createElement(TerminalCommandProvider, {
          onFill: fill,
          children: content,
        })
      : content,
  );
  return { html, fill };
}

describe("conversation code to terminal", () => {
  it.each([false, true])(
    "copies exact highlighted code through the toolbar wrapper (terminal provider: %s)",
    async (withTerminal) => {
      const source = 'printf "%s\\n" "你好"\ngit status\n';
      const { html } = render(`\`\`\`bash\n${source}\`\`\``, withTerminal);
      expect(html).toContain('aria-label="复制代码"');
      expect(captured.copy).toBeTypeOf("function");
      const writeText = vi.fn(async () => {});
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      vi.stubGlobal("window", { setTimeout: vi.fn() });
      try {
        // The button's new toolbar parent does not contain the code <pre>.
        await captured.copy!({
          currentTarget: { parentElement: { querySelector: () => null } },
        });
        expect(writeText).toHaveBeenCalledExactlyOnceWith(source);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("offers a highlighted shell command only inside an explicitly enabled conversation", () => {
    const text = '```bash\ngit commit -m "修复测试"\n```';
    const enabled = render(text);
    expect(enabled.html).toContain('data-slot="terminal-code-action"');
    expect(enabled.html).toContain('aria-label="填入终端"');
    expect(enabled.html).toContain('aria-label="复制代码"');
    expect(enabled.fill).not.toHaveBeenCalled();
    expect(render(text, false).html).not.toContain(
      'data-slot="terminal-code-action"',
    );
  });

  it("excludes multiline examples, incomplete streaming and non-shell fences", () => {
    for (const text of [
      "```sh\nnpm install\nnpm test\n```",
      "```javascript\nconsole.log('test')\n```",
      "```\ngit status\n```",
    ])
      expect(render(text).html).not.toContain(
        'data-slot="terminal-code-action"',
      );
    expect(render("```sh\ngit status\n```", true, true).html).not.toContain(
      'data-slot="terminal-code-action"',
    );
  });

  it("preserves one-line command text without injecting Enter or stripping quoting", () => {
    expect(terminalCodeCommand('git commit -m "修复"\n', "bash")).toBe(
      'git commit -m "修复"',
    );
    expect(terminalCodeCommand("npm install", "shell")).toBe("npm install");
    expect(terminalCodeCommand("git status\n", "zsh")).toBe("git status");
  });

  it("rejects control sequences and substantive extra lines rather than silently rewriting commands", () => {
    for (const input of [
      "npm install\nnpm test\n",
      "git status\n\n",
      "git status\r\n",
      "git status" + String.fromCharCode(27) + "[2K\n",
      "git status\u2028rm -rf build\n",
    ])
      expect(terminalCodeCommand(input, "sh")).toBeNull();
    expect(terminalCodeCommand(" ", "sh")).toBeNull();
  });
});
