import { expect, it } from "vitest";
import {
  pendingAsyncQuestions,
  asyncAnswerText,
  asyncAnswerClientId,
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
const user = (text: string): Extract<ThreadItem, { type: "userMessage" }> => ({
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
it("preserves old prompts on an unrelated follow-up", () => {
  const old = question("old");
  const latest = question("latest");
  expect(
    pendingAsyncQuestions(thread([old, user("继续下一项任务"), latest])),
  ).toEqual([old, latest]);
});

it("associates same-title prompts by item id after history reload", () => {
  const first = question("one");
  const second = { ...question("two"), questions: first.questions };
  expect(
    pendingAsyncQuestions(
      thread([
        first,
        second,
        {
          ...user(asyncAnswerText(first, ["甲"])),
          clientId: asyncAnswerClientId(first.id, "delivery"),
        },
      ]),
    ),
  ).toEqual([second]);
  expect(
    pendingAsyncQuestions(
      thread([first, second, user("回答问题：\n偏好 one\n甲")]),
    ),
  ).toEqual([first, second]);
});
