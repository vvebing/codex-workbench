import { afterEach, expect, it } from "vitest";
import i18n from "../../src/lib/i18n";
import {
  asyncAnswerClientId,
  asyncAnswerText,
  pendingAsyncQuestions,
  type QuestionMessage,
} from "../../src/features/conversation/async-questions";
import { conversationMarkdown } from "../../src/features/conversation/export";
import { executionStatusLabel } from "../../src/features/conversation/model";
import { placeholderThread } from "../../src/lib/state";
import { executionSegments } from "../../src/features/conversation/execution-presentation";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";
import type { Thread } from "../../src/generated/v2/Thread";

const originalLanguage = i18n.language;
afterEach(async () => {
  await i18n.changeLanguage(originalLanguage);
});

const question: QuestionMessage = {
  type: "agentMessage",
  id: "question",
  text: "模型原文",
  phase: "commentary",
  memoryCitation: null,
  delivery: null,
  questions: [{ title: "保留中文问题", options: ["甲", "乙"] }],
};
function history(answer: string): Thread {
  return {
    ...placeholderThread("thread"),
    turns: [
      {
        id: "turn",
        rootTurnId: null,
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        items: [
          question,
          {
            type: "userMessage",
            id: "reply",
            clientId: asyncAnswerClientId(question.id, "delivery"),
            content: [{ type: "text", text: answer, text_elements: [] }],
          },
        ],
      },
    ],
  };
}
it("localizes answer scaffolding while preserving question and answer content across history reloads", async () => {
  await i18n.changeLanguage("en");
  const english = asyncAnswerText(question, ["  保留用户原文  "]);
  expect(english).toBe("Answer to questions:\n保留中文问题\n保留用户原文");
  await i18n.changeLanguage("zh-CN");
  expect(pendingAsyncQuestions(history(english))).toEqual([]);
  const chinese = asyncAnswerText(question, ["保留用户原文"]);
  expect(chinese).toBe("回答问题：\n保留中文问题\n保留用户原文");
  await i18n.changeLanguage("en");
  expect(pendingAsyncQuestions(history(chinese))).toEqual([]);
});
it("updates helper labels and export headings without translating conversation content", async () => {
  const session = history("保留用户原文");
  await i18n.changeLanguage("en");
  expect(executionStatusLabel("completed")).toBe("Completed");
  expect(conversationMarkdown(session)).toContain("## User\n\n保留用户原文");
  expect(conversationMarkdown(session)).toContain("模型原文");
  await i18n.changeLanguage("zh-CN");
  expect(executionStatusLabel("completed")).toBe("已完成");
  expect(conversationMarkdown(session)).toContain("## 用户\n\n保留用户原文");
});

it("uses count-neutral English execution summaries for one and multiple operations", async () => {
  await i18n.changeLanguage("en");
  const commands = Array.from(
    { length: 2 },
    (_, index) =>
      ({
        type: "commandExecution",
        id: `command-${index}`,
        commandActions: [],
      }) as unknown as ThreadItem,
  );
  expect(
    executionSegments(commands.slice(0, 1), () => "completed")[0],
  ).toMatchObject({ label: "Ran · Commands: 1" });
  expect(executionSegments(commands, () => "completed")[0]).toMatchObject({
    label: "Ran · Commands: 2",
  });
  expect(executionSegments(commands, () => "inProgress")[0]).toMatchObject({
    label: "Running · Commands: 2",
  });
});
