import { expect, it } from "vitest";
import {
  conversationMarkdown,
  finalSummary,
  exportFilename,
} from "../../src/features/conversation/export";
import type { Thread } from "../../src/generated/v2/Thread";
import type { Turn } from "../../src/generated/v2/Turn";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";
const agent = (
  text: string,
  phase: "final_answer" | "commentary" | null,
): ThreadItem => ({
  type: "agentMessage",
  id: text,
  text,
  phase,
  memoryCitation: null,
  delivery: null,
  questions: null,
});
const turn = (
  items: ThreadItem[],
  status: Turn["status"] = "completed",
): Turn => ({
  id: "t",
  rootTurnId: null,
  items,
  itemsView: "full",
  status,
  error: null,
  startedAt: 1,
  completedAt: 2,
  durationMs: 1000,
});
const thread = (turns: Turn[]): Thread =>
  ({
    id: "thread-123",
    sessionId: "session-456",
    name: "测试会话",
    preview: "",
    cwd: "/demo",
    turns,
  }) as Thread;
it("exports all user and assistant messages in order with Markdown intact", () => {
  const history = thread([
    turn([
      {
        type: "userMessage",
        id: "u",
        clientId: null,
        content: [
          { type: "text", text: "请检查", text_elements: [] },
          { type: "image", url: "https://example.test/image.png" },
        ],
      },
      agent("正在检查", "commentary"),
      { type: "reasoning", id: "r", summary: ["内部思考"], content: [] },
      agent("## 结果\n\n```ts\nconst x = 1;\n```", "final_answer"),
    ]),
  ]);
  const markdown = conversationMarkdown(history);
  expect(markdown).toContain("Session ID: session-456");
  expect(markdown).toContain("Thread ID: thread-123");
  expect(markdown).toContain("![图片](https://example.test/image.png)");
  expect(markdown.indexOf("请检查")).toBeLessThan(markdown.indexOf("正在检查"));
  expect(markdown.indexOf("正在检查")).toBeLessThan(
    markdown.indexOf("## 结果"),
  );
  expect(markdown).toContain("```ts\nconst x = 1;\n```");
  expect(markdown).not.toContain("内部思考");
});
it("copies the latest completed final answer without commentary or partial streaming", () => {
  const history = thread([
    turn([agent("旧总结", "final_answer")]),
    turn([agent("最终总结", "final_answer"), agent("补充进度", "commentary")]),
    turn([agent("未完成", "final_answer")], "inProgress"),
  ]);
  expect(finalSummary(history)).toBe("最终总结");
  expect(finalSummary(thread([turn([agent("旧模型回复", null)])]))).toBe(
    "旧模型回复",
  );
  expect(
    finalSummary(thread([turn([agent("只有进度", "commentary")])])),
  ).toBeNull();
});
it("uses safe Markdown filenames", () => {
  expect(exportFilename({ ...thread([]), name: "测试/会话:*?\n标题" })).toBe(
    "测试_会话____标题-thread-1.md",
  );
});
