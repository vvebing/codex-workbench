import { expect, it } from "vitest";
import {
  pendingAsyncQuestions,
  asyncAnswerText,
  type QuestionMessage,
} from "../../src/features/conversation/async-questions";
import { isTimelineProgress } from "../../src/features/conversation/model";
import { placeholderThread } from "../../src/lib/state";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";

const question = (id: string): QuestionMessage => ({
  type: "agentMessage",
  id,
  text: "请选择",
  phase: "commentary",
  memoryCitation: null,
  delivery: null,
  questions: [{ title: `偏好 ${id}`, options: ["甲", "乙"] }],
});
const user = (text: string): ThreadItem => ({
  type: "userMessage",
  id: "reply",
  clientId: null,
  content: [{ type: "text", text, text_elements: [] }],
});
const thread = (items: ThreadItem[]) => ({
  ...placeholderThread("thread"),
  turns: [
    {
      id: "turn",
      rootTurnId: null,
      items,
      itemsView: "full" as const,
      status: "completed" as const,
      error: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
    },
  ],
});

it("keeps async prompts visible outside collapsed commentary and after completion", () => {
  const item = question("one");
  expect(
    isTimelineProgress(item, [item, { ...question("two"), questions: null }]),
  ).toBe(false);
  expect(pendingAsyncQuestions(thread([user("任务"), item]))).toEqual([item]);
});
it("resolves only the answered prompt and preserves another outstanding question", () => {
  const first = question("one");
  const second = question("two");
  const text = asyncAnswerText(first, ["  乙  "]);
  expect(text).toBe("回答问题：\n偏好 one\n乙");
  expect(
    pendingAsyncQuestions(thread([user("任务"), first, second, user(text)])),
  ).toEqual([second]);
});
it("supersedes old prompts on a manual follow-up and keeps new prompts", () => {
  const old = question("old");
  const latest = question("latest");
  expect(
    pendingAsyncQuestions(thread([old, user("继续下一项任务"), latest])),
  ).toEqual([latest]);
});
