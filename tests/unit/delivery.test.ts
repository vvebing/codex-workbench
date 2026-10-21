import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Turn } from "../../src/generated/v2/Turn";
import { TurnResults } from "../../src/features/conversation/TurnResults";
import { exportText } from "../../src/features/conversation/export";
const turn: Turn = {
  id: "only-this-turn",
  items: [],
  itemsView: "full",
  status: "completed",
  rootTurnId: null,
  error: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
};
describe("turn changes", () => {
  it("hides turns with no files or nonempty diff, including plan-only turns", () => {
    const source = {
      ...turn,
      items: [{ type: "plan" as const, id: "plan", text: "do work" }],
    };
    expect(
      renderToStaticMarkup(createElement(TurnResults, { turn: source })),
    ).toBe("");
    expect(
      renderToStaticMarkup(createElement(TurnResults, { turn, diff: " \n" })),
    ).toBe("");
  });
  it("shows a recorded file even without diff content", () => {
    const source: Turn = {
      ...turn,
      items: [
        {
          type: "fileChange",
          id: "file",
          status: "completed",
          changes: [{ path: "a.ts", diff: "", kind: { type: "add" } }],
        },
      ],
    };
    expect(
      renderToStaticMarkup(createElement(TurnResults, { turn: source })),
    ).toContain("1 个文件");
  });
  it("shows nonempty aggregate diff and its patch action menu", () => {
    const html = renderToStaticMarkup(
      createElement(TurnResults, { turn, diff: "opaque patch" }),
    );
    expect(html).toContain("本轮变更");
    expect(html).toContain("本轮变更操作");
    expect(html).not.toContain("最终总结");
  });
  it("downloads exact patch content through the shared exporter", async () => {
    const click = vi.fn();
    const link = { href: "", download: "", click, remove: vi.fn() };
    const create = vi.fn(() => "blob:patch");
    vi.stubGlobal("document", {
      createElement: () => link,
      body: { append: vi.fn() },
    });
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
    vi.useFakeTimers();
    try {
      exportText("diff --git a/a.ts b/a.ts\n+new\n", "turn.patch");
      expect(await (create.mock.calls[0] as unknown as [Blob])[0].text()).toBe(
        "diff --git a/a.ts b/a.ts\n+new\n",
      );
      expect(link.download).toBe("turn.patch");
      expect(click).toHaveBeenCalledOnce();
      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
