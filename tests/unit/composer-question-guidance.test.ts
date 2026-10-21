import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "../../src/features/composer/Composer";

const mock = vi.hoisted(() => ({
  inputRequest: false,
  asyncQuestion: false,
  mode: "queue",
  restored: false,
}));
vi.mock("../../src/features/composer/useComposerSession", () => ({
  useComposerSession: () => ({
    runtime: { queue: { forThread: () => ({ items: [] }) } },
    connection: { models: [], url: "test", epoch: 1 },
    sessions: { tokenUsage: {} },
    draft: {
      text: "保留的草稿",
      images: [],
      restored: mock.restored
        ? { source: "draft", unavailableAttachments: true }
        : undefined,
    },
    thread: { id: "a" },
    access: mock.restored ? "viewing" : "editable",
    localDraft: mock.restored,
    connected: true,
    waiting: mock.inputRequest,
    inputRequest: mock.inputRequest ? { id: 1 } : undefined,
    asyncQuestion: mock.asyncQuestion ? { id: "question" } : undefined,
    capabilities: {
      running: true,
      executing: true,
      hasContent: true,
      editable: true,
      showStop: mock.inputRequest,
      canSend: !mock.inputRequest,
      canStop: true,
    },
  }),
}));
vi.mock("../../src/features/settings/conversation-preferences", () => ({
  useRunningSendMode: () => mock.mode,
}));
vi.mock("../../src/features/composer/MessageEditor", () => ({
  MessageEditor: ({ placeholder }: { placeholder: string }) =>
    createElement("textarea", { placeholder }),
}));
vi.mock("../../src/features/composer/QueuedTasks", () => ({
  QueuedTasks: () => null,
}));
vi.mock("../../src/features/composer/ContextUsage", () => ({
  ContextUsage: () => null,
}));

function render() {
  return renderToStaticMarkup(createElement(Composer, { threadId: "a" }));
}
describe("composer question guidance", () => {
  it("directs synchronous answers to the card, preserves draft context, and keeps an explicit stop action", () => {
    mock.inputRequest = true;
    mock.asyncQuestion = false;
    const html = render();
    expect(html).toContain("普通消息草稿会保留");
    expect(html).toContain('aria-label="前往问题卡片回答"');
    expect(html).toContain("停止当前执行");
    expect(html).not.toContain('type="submit"');
  });
  it.each(["queue", "steer"])(
    "labels asynchronous follow-ups as ordinary messages in %s mode",
    (mode) => {
      mock.inputRequest = false;
      mock.asyncQuestion = true;
      mock.mode = mode;
      const html = render();
      expect(html).toContain("下方输入框发送普通消息");
      expect(html).toContain("前往问题卡片回答");
      expect(html).toContain(
        mode === "queue" ? "加入任务队列" : "立即引导当前任务",
      );
      expect(html).toContain('type="submit"');
    },
  );
});

it("shows missing restored attachments while a local draft is viewing", () => {
  mock.restored = true;
  try {
    const html = render();
    expect(html).toContain("草稿已恢复 · 图片附件需重新添加");
    expect(html).not.toContain("原消息已恢复");
  } finally {
    mock.restored = false;
  }
});
