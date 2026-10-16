import type { Thread } from "../../generated/v2/Thread";
import type { ThreadItem } from "../../generated/v2/ThreadItem";

export type QuestionMessage = Extract<ThreadItem, { type: "agentMessage" }>;

/** A later user message supersedes the preceding prompts, including manual replies. */
export function pendingAsyncQuestions(thread: Thread): QuestionMessage[] {
  const pending: QuestionMessage[] = [];
  const replies: string[] = [];
  for (const turn of [...thread.turns].reverse()) {
    for (const item of [...turn.items].reverse()) {
      if (item.type === "userMessage") {
        const text = item.content
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("\n");
        if (!text.startsWith("回答问题：\n")) return pending.reverse();
        replies.push(text);
      }
      if (
        item.type === "agentMessage" &&
        item.questions?.length &&
        !replies.some((reply) =>
          item.questions!.every((question) =>
            reply.includes(`${question.title}\n`),
          ),
        )
      )
        pending.push(item);
    }
  }
  return pending.reverse();
}

export function asyncAnswerText(
  item: QuestionMessage,
  answers: string[],
): string {
  return `回答问题：\n${item.questions!.map((question, index) => `${question.title}\n${answers[index].trim()}`).join("\n\n")}`;
}
