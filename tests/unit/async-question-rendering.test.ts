import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import {
  AsyncQuestions,
  AsyncQuestionPanel,
} from "../../src/features/conversation/AsyncQuestions";
import { RuntimeContext } from "../../src/lib/runtime-context";
import { createRuntime } from "../../src/lib/runtime";
import type { QueuedTask } from "../../src/features/composer/queue";
import { placeholderThread } from "../../src/lib/state";
import { emptyDraft } from "../../src/features/composer/drafts";

// Render a fixed store snapshot without a browser subscription.
vi.mock("../../src/components/hooks", async (original) => ({
  ...(await original<object>()),
  useStore: (store: { getSnapshot: () => unknown }) => store.getSnapshot(),
}));
afterEach(() => vi.restoreAllMocks());
const item = {
  type: "agentMessage" as const,
  id: "question",
  text: "Choose",
  phase: "commentary" as const,
  memoryCitation: null,
  delivery: null,
  questions: [{ title: "Preference", options: ["A", "B"] }],
};
function render(
  status?: QueuedTask["status"],
  sent = false,
  history?: "pending" | "confirmed" | "question-missing",
) {
  const runtime = createRuntime();
  if (history) {
    const thread = placeholderThread("a");
    thread.turns = [
      {
        id: "turn",
        rootTurnId: null,
        status: "completed",
        itemsView: "full",
        error: null,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        items:
          history === "question-missing"
            ? []
            : [
                item,
                ...(history === "confirmed"
                  ? [
                      {
                        type: "userMessage" as const,
                        id: "reply",
                        clientId: "codex-question:question:delivery",
                        content: [
                          {
                            type: "text" as const,
                            text: "回答问题：\nPreference\nB",
                            text_elements: [],
                          },
                        ],
                      },
                    ]
                  : []),
              ],
      },
    ];
    vi.spyOn(runtime.sessions, "getSnapshot").mockReturnValue({
      ...runtime.sessions.getSnapshot(),
      threads: { a: thread },
    });
  }
  vi.spyOn(runtime.queue, "forThread").mockReturnValue({
    items: status
      ? [
          {
            id: "answer",
            draft: emptyDraft(),
            input: [],
            options: {},
            status,
            question: { itemId: item.id, answers: ["B"] },
          },
        ]
      : [],
    paused: null,
    sentAnswers: sent ? { [item.id]: ["B"] } : {},
  });
  return renderToStaticMarkup(
    createElement(
      RuntimeContext.Provider,
      { value: runtime },
      createElement(AsyncQuestions, { item, threadId: "a" }),
    ),
  );
}
it("shows a saved answer summary while queued, without claiming it is sending", () => {
  const html = render("queued");
  expect(html).toContain("回答已保存，等待连接恢复后检查并继续发送");
  expect(html).toContain('<dt class="font-semibold">Preference</dt>');
  expect(html).toContain(">B</dd>");
  expect(html).toContain("修改回答");
  expect(html).not.toContain("正在发送回答");
  expect(html).not.toContain("<fieldset");
  expect(html).not.toContain("提交回答");
});
it("only claims sending during dispatch and disables editing", () => {
  const html = render("sending");
  expect(html).toContain("正在发送回答");
  expect(html).not.toContain("修改回答");
  expect(html).not.toContain("取消待发送");
});
it("keeps the answer and sent status while waiting for echo", () => {
  const html = render(undefined, true);
  expect(html).toContain("回答已发送，等待会话更新");
  expect(html).toContain(">B</dd>");
  expect(html).not.toContain("提交回答");
  expect(html).not.toContain("<fieldset");
});
it("preserves uncertain answers and explains reconciliation", () => {
  const html = render("uncertain");
  expect(html).toContain("系统不会自动重发");
  expect(html).toContain(">B</dd>");
  expect(html).not.toContain("提交回答");
});

it.each([false, true])(
  "keeps archived question content readable without interactive controls (panel=%s)",
  (panel) => {
    const runtime = createRuntime();
    const thread = {
      ...placeholderThread("a"),
      turns: [
        {
          id: "turn",
          rootTurnId: null,
          items: [item],
          itemsView: "full" as const,
          status: "completed" as const,
          error: null,
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
        },
      ],
    };
    vi.spyOn(runtime.sessions, "getSnapshot").mockReturnValue({
      ...runtime.sessions.getSnapshot(),
      threads: { a: thread },
      archivedIds: { a: true },
      selectedId: "a",
    });
    const html = renderToStaticMarkup(
      createElement(
        RuntimeContext.Provider,
        { value: runtime },
        panel
          ? createElement(AsyncQuestionPanel, { thread })
          : createElement(AsyncQuestions, { item, threadId: "a" }),
      ),
    );
    expect(html).toContain("Preference");
    expect(html).toContain("A / B");
    expect(html).toContain("会话已归档，问题仅供查看");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
  },
);

it.each(["queued", "uncertain"] as const)(
  "preserves %s status when the thread is missing",
  (status) => {
    const html = render(status);
    expect(html).toContain(
      status === "queued" ? "回答已保存" : "系统不会自动重发",
    );
    expect(html).not.toContain("此问题已回答或已忽略");
  },
);
it("does not infer confirmation from a loaded history missing the question", () => {
  const html = render("uncertain", false, "question-missing");
  expect(html).toContain("系统不会自动重发");
  expect(html).not.toContain("此问题已回答或已忽略");
});
it("requires an associated server history reply before replacing queue status with confirmation", () => {
  expect(render(undefined, true, "pending")).toContain(
    "回答已发送，等待会话更新",
  );
  const html = render(undefined, true, "confirmed");
  expect(html).toContain("此问题已回答或已忽略");
  expect(html).not.toContain("等待会话更新");
});
it("shows unknown history as unconfirmed and disables unanswered controls", () => {
  const html = render();
  expect(html).toContain("正在核实问题状态");
  expect(html).toContain("disabled");
  expect(html).not.toContain("此问题已回答或已忽略");
});
