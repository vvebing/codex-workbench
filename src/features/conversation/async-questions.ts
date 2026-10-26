import { t } from "../../lib/i18n";
import type { Thread } from "../../generated/v2/Thread";
import type { ThreadItem } from "../../generated/v2/ThreadItem";

export type QuestionMessage = Extract<ThreadItem, { type: "agentMessage" }>;

/** Resolve only explicitly associated replies; unrelated follow-ups preserve prompts. */
export function pendingAsyncQuestions(thread: Thread): QuestionMessage[] {
  const pending: QuestionMessage[] = [];
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (item.type === "agentMessage" && item.questions?.length)
        pending.push(item);
      if (item.type !== "userMessage") continue;
      const text = item.content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n");
      if (!/^(?:回答问题：|Answer to questions:)\n/.test(text)) continue;
      const associated = asyncAnswerItemId(item.clientId);
      const marker = associated
        ? ["", encodeURIComponent(associated)]
        : text.match(
            /^(?:回答问题：|Answer to questions:)\n(?:问题编号：|Question ID:)([^\n]+)\n/,
          );
      if (marker) {
        const index = pending.findIndex(
          (question) => encodeURIComponent(question.id) === marker[1],
        );
        if (index >= 0) pending.splice(index, 1);
      } else {
        // Historical replies have no identity. Resolve only an unambiguous match.
        const matches = pending.filter((question) =>
          question.questions!.every((entry) =>
            text.includes(`${entry.title}\n`),
          ),
        );
        if (matches.length === 1)
          pending.splice(pending.indexOf(matches[0]), 1);
      }
    }
  }
  return pending;
}

export function asyncAnswerText(
  item: QuestionMessage,
  answers: string[],
): string {
  return t("回答问题：\n{{value0}}", {
    value0: item
      .questions!.map(
        (question, index) => `${question.title}\n${answers[index].trim()}`,
      )
      .join("\n\n"),
  });
}

export function asyncAnswerClientId(
  itemId: string,
  deliveryId: string,
): string {
  return `codex-question:${encodeURIComponent(itemId)}:${deliveryId}`;
}
export function asyncAnswerItemId(clientId: string | null): string | undefined {
  const match = clientId?.match(/^codex-question:([^:]+):[^:]+$/);
  try {
    return match ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
}
