import { useTranslation } from "react-i18next";
import { t } from "../../lib/i18n";
import type { ThreadItem } from "../../generated/v2/ThreadItem";
import { useState } from "react";
import { useRuntime } from "../../lib/runtime-context";
import { useStore } from "../../components/hooks";
import { Button, ErrorNotice } from "../../components/ui";
import type { SubmittedAnswer } from "../requests/store";
import type { LocalMessage } from "../composer/local-messages";
import { questionDraftKey, writeQuestionDraft } from "./question-drafts";

export function ToolAnswerRecord({ answer }: { answer: SubmittedAnswer }) {
  useTranslation();
  return (
    <article
      tabIndex={-1}
      data-answer-record={`${answer.epoch}:${answer.id}`}
      data-question-answer-for={`tool:${answer.epoch}:${answer.id}`}
      data-slot="tool-answer-record"
      data-reading-id={`answer:${answer.epoch}:${answer.id}`}
      className="my-3 rounded-lg bg-surface p-4 text-control"
    >
      <p className="mb-2 font-semibold">{t("你的回答")}</p>
      <dl className="space-y-2">
        {answer.answers.map((entry, index) => (
          <div key={index}>
            <dt className="text-muted">{entry.question}</dt>
            <dd className="whitespace-pre-wrap">{entry.answer}</dd>
          </div>
        ))}
      </dl>
      {answer.status !== "resolved" && (
        <p role="status" className="mt-2 text-xs text-muted">
          {answer.status === "uncertain"
            ? t("送达状态待确认，请核实会话；不会自动重发。")
            : t("回答已提交，等待服务端确认。")}
        </p>
      )}
    </article>
  );
}

/** Recovery belongs beside the submitted answer, never in the outgoing form. */
export function QuestionAnswerDelivery({ message }: { message: LocalMessage }) {
  useTranslation();
  const runtime = useRuntime();
  useStore(runtime.queue);
  const connection = useStore(runtime.connection);
  useStore(runtime.requests);
  useStore(runtime.sessions);
  const [error, setError] = useState("");
  const queue = runtime.queue.forThread(message.threadId);
  const task = queue.items.find((entry) => entry.id === message.questionTaskId);
  const archived =
    !!runtime.sessions.getSnapshot().archivedIds[message.threadId];
  const run = async (action: () => Promise<void>) => {
    setError("");
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : t("操作失败，请重试。"),
      );
    }
  };
  const edit = async () => {
    if (!task?.question) return;
    // Save the complete answer before removing its durable outbox entry.
    writeQuestionDraft(
      questionDraftKey(connection.url, message.threadId, task.question.itemId),
      {
        values: Object.fromEntries(
          task.question.answers.map((_, index) => [index, "custom"]),
        ),
        custom: Object.fromEntries(
          task.question.answers.map((answer, index) => [index, answer]),
        ),
      },
    );
    await runtime.queue.remove(message.threadId, task.id);
  };
  const label = task?.question?.expired
    ? t("问题已结束，本次回答未发送。内容已保留。")
    : task?.status === "uncertain"
      ? t("送达状态待确认，请先核实会话；不会自动重发。")
      : task?.status === "sending"
        ? t("正在发送回答…")
        : !task
          ? t("服务器已接收，等待消息记录同步…")
          : queue.paused
            ? t("回答已保存。{{value0}}", { value0: queue.paused })
            : connection.status !== "connected"
              ? t("回答已保存，等待连接恢复。")
              : runtime.requests.forThread(message.threadId).length
                ? t("回答已保存，等待当前请求处理完毕。")
                : runtime.sessions.getSnapshot().threadAccess[
                      message.threadId
                    ] !== "editable"
                  ? t("回答已保存，等待取得写入权限。")
                  : t("回答已保存，等待发送。");
  return (
    <div
      className="mt-2 text-xs text-muted"
      data-slot="question-answer-delivery"
    >
      <p role="status">{label}</p>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {task && task.status !== "sending" && (
        <div className="mt-1 flex flex-wrap gap-2">
          {task.status === "queued" && !task.question?.expired && !archived && (
            <Button size="sm" variant="quiet" onClick={() => void run(edit)}>
              {t("修改回答")}
            </Button>
          )}
          {task.status === "queued" &&
            queue.paused &&
            !task.question?.expired &&
            !archived && (
              <Button
                size="sm"
                variant="quiet"
                onClick={() =>
                  void run(() => runtime.queue.resume(message.threadId))
                }
              >
                {t("继续发送")}
              </Button>
            )}
          {task.status === "uncertain" && !archived && (
            <Button
              size="sm"
              variant="quiet"
              onClick={() =>
                void run(async () => {
                  await runtime.queue.retry(message.threadId, task.id);
                  await runtime.queue.resume(message.threadId);
                })
              }
            >
              {t("确认未送达，重试")}
            </Button>
          )}
          <Button
            size="sm"
            variant="quiet"
            onClick={() =>
              void run(() => navigator.clipboard.writeText(task.draft.text))
            }
          >
            {t("复制回答")}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            onClick={() =>
              void run(() => runtime.queue.remove(message.threadId, task.id))
            }
          >
            {task.status === "uncertain"
              ? t("移除待确认记录")
              : t("取消待发送")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function toolAnswerId(answer: SubmittedAnswer): string {
  return `tool-answer:${answer.epoch}:${answer.id}`;
}

/** Keep the user's decision before the work it allowed the agent to continue. */
export function withToolAnswers(
  items: ThreadItem[],
  answers: SubmittedAnswer[],
): ThreadItem[] {
  const result: ThreadItem[] = [];
  const marker = (answer: SubmittedAnswer): ThreadItem => ({
    type: "userMessage",
    id: toolAnswerId(answer),
    clientId: toolAnswerId(answer),
    content: [],
  });
  for (const answer of answers.filter(
    (answer) =>
      !answer.afterItemId ||
      !items.some((item) => item.id === answer.afterItemId),
  ))
    result.push(marker(answer));
  for (const item of items) {
    result.push(item);
    for (const answer of answers.filter(
      (answer) => answer.afterItemId === item.id,
    ))
      result.push(marker(answer));
  }
  return result;
}
