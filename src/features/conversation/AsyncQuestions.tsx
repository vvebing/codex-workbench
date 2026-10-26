import { useTranslation } from "react-i18next";
import { t } from "../../lib/i18n";
import { QuestionPresence } from "./QuestionPresence";
import { useStableQuestionCard } from "./use-stable-question-card";
import { settingsInputClass } from "../settings/settings-ui";
import type { Thread } from "../../generated/v2/Thread";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRuntime } from "../../lib/runtime-context";
import { useStore } from "../../components/hooks";
import { Button, ErrorNotice, ScrollArea } from "../../components/ui";
import { pendingAsyncQuestions, type QuestionMessage } from "./async-questions";

import {
  questionDraftKey,
  readQuestionDraft,
  clearQuestionDraft,
  writeQuestionDraft,
} from "./question-drafts";

export function AsyncQuestions({
  item,
  threadId,
}: {
  item: QuestionMessage;
  threadId: string;
}) {
  useTranslation();
  const runtime = useRuntime();
  const sessions = useStore(runtime.sessions);
  const connection = useStore(runtime.connection);
  const requests = useStore(runtime.requests);
  useStore(runtime.questionDismissals);
  const queueState = useStore(runtime.queue);
  const task = runtime.queue
    .forThread(threadId)
    .items.find((task) => task.question?.itemId === item.id);
  const queue = runtime.queue.forThread(threadId);
  const sent = queue.sentAnswers?.[item.id];
  const saved = task?.question?.answers ?? sent;
  const draftKey = questionDraftKey(connection.url, threadId, item.id);
  const [draft] = useState(() => readQuestionDraft(draftKey));
  const [answers, setAnswers] = useState<Record<number, string>>(() =>
    Object.assign(
      {},
      draft.values,
      Object.fromEntries(
        (saved ?? []).map((answer, index) => {
          const option = item.questions?.[index].options?.indexOf(answer) ?? -1;
          return [index, option < 0 ? "custom" : String(option)];
        }),
      ),
    ),
  );
  const [custom, setCustom] = useState<Record<number, string>>(() =>
    Object.assign(
      {},
      draft.custom,
      Object.fromEntries((saved ?? []).map((answer, index) => [index, answer])),
    ),
  );
  useEffect(() => {
    writeQuestionDraft(draftKey, { values: answers, custom });
  }, [draftKey, answers, custom]);
  const [sending, setSending] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const thread = sessions.threads[threadId];
  const unresolved = thread ? pendingAsyncQuestions(thread) : [];
  const questionPresent = !!thread?.turns.some((turn) =>
    turn.items.some(
      (entry) => entry.type === "agentMessage" && entry.id === item.id,
    ),
  );
  // Absence from an unloaded/partial history cannot confirm an answer.
  const confirmed =
    questionPresent && !unresolved.some((entry) => entry.id === item.id);
  const ignored = runtime.questionDismissals.isIgnored(threadId, item.id);
  const pending = unresolved.some((entry) => entry.id === item.id) && !ignored;
  const occupied =
    sessions.threadAccess[threadId] === "occupied" ||
    (!!runtime.sessions.activeTurn(threadId) &&
      sessions.threadAccess[threadId] !== "editable");
  const blocked = requests.pending.some(
    (request) =>
      "threadId" in request.params && request.params.threadId === threadId,
  );
  const archived = !!sessions.archivedIds[threadId];
  const inputDisabled = archived || sending || !!saved || !pending;
  const disabled = inputDisabled || !queueState.ready;
  const selection = (index: number) => {
    if (!saved) return answers[index];
    const option = item.questions?.[index].options?.indexOf(saved[index]) ?? -1;
    return option < 0 ? "custom" : String(option);
  };
  const answer = (index: number) =>
    answers[index] === "custom"
      ? (custom[index] ?? "")
      : (item.questions?.[index].options?.[Number(answers[index])] ?? "");
  const stable = useStableQuestionCard(!!saved || confirmed, sending);
  if (archived) return <ArchivedQuestions items={[item]} />;
  return (
    <form
      ref={stable.ref as React.Ref<HTMLFormElement>}
      style={{ minHeight: stable.minHeight }}
      data-async-question-id={item.id}
      tabIndex={-1}
      className="mt-4 mb-3 rounded-xl border border-border bg-elevated p-4 text-control"
      aria-label={!confirmed && !ignored ? t("回答异步问题") : undefined}
      onSubmit={async (event) => {
        event.preventDefault();
        if (
          disabled ||
          runtime.sessions.getSnapshot().archivedIds[threadId] ||
          lock.current ||
          !item.questions?.every((_, index) => answer(index).trim())
        )
          return;
        stable.preserve();
        lock.current = true;
        setSending(true);
        setError("");
        try {
          const submitted = item.questions.map((_, index) => answer(index));
          await runtime.queue.addAnswer(threadId, item, submitted);
          clearQuestionDraft(draftKey);
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : t("回答发送失败，请核实会话记录后重试。"),
          );
        } finally {
          lock.current = false;
          setSending(false);
        }
      }}
    >
      <p className="mb-3 font-semibold">
        {saved ? t("你的回答") : t("需要你的回答")}
      </p>
      {saved && (
        <dl className="mb-3 space-y-2">
          {item.questions?.map((question, index) => (
            <div key={index}>
              <dt className="font-semibold">{question.title}</dt>
              <dd className="whitespace-pre-wrap">
                {saved?.[index] ?? answer(index)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {!saved &&
        item.questions?.map((question, index) => (
          <fieldset
            key={index}
            disabled={inputDisabled}
            className="mb-4 border-0 p-0"
          >
            <legend className="mb-2 font-semibold">{question.title}</legend>
            {question.options?.map((option, optionIndex) => (
              <label
                key={optionIndex}
                className="flex cursor-pointer items-start gap-2 py-2"
              >
                <input
                  type="radio"
                  name={`${item.id}-${index}`}
                  className="mt-1 accent-accent"
                  checked={selection(index) === String(optionIndex)}
                  onChange={() =>
                    setAnswers({ ...answers, [index]: String(optionIndex) })
                  }
                />
                {option}
              </label>
            ))}
            {!!question.options?.length && (
              <label className="flex cursor-pointer items-start gap-2 py-2">
                <input
                  type="radio"
                  name={`${item.id}-${index}`}
                  className="mt-1 accent-accent"
                  checked={selection(index) === "custom"}
                  onChange={() => setAnswers({ ...answers, [index]: "custom" })}
                />
                {t("自定义回答")}
              </label>
            )}
            {(!question.options?.length || selection(index) === "custom") && (
              <textarea
                rows={4}
                aria-label={question.title}
                className={settingsInputClass}
                value={saved?.[index] ?? custom[index] ?? ""}
                onChange={(event) => {
                  setCustom({ ...custom, [index]: event.target.value });
                  if (!question.options?.length)
                    setAnswers({ ...answers, [index]: "custom" });
                }}
              />
            )}
          </fieldset>
        ))}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {sent && !confirmed ? (
        <p role="status" className="text-muted">
          {t("回答已发送，等待会话更新。")}
        </p>
      ) : task && !confirmed ? (
        <>
          <p role="status" className="mb-2 text-muted">
            {task.status === "sending"
              ? t("正在发送回答…")
              : task.status === "uncertain"
                ? t("发送结果待确认，请先核实会话记录，系统不会自动重发。")
                : queue.paused
                  ? t("回答已保存，等待发送。{{value0}}", {
                      value0: queue.paused,
                    })
                  : connection.status !== "connected"
                    ? t("回答已保存，等待连接恢复后检查并继续发送。")
                    : occupied
                      ? t("回答已保存，等待取得写入权限后发送。")
                      : blocked
                        ? t("回答已保存，等待当前确认请求处理完毕后发送。")
                        : t("回答已保存，等待发送。")}
          </p>
          <div className="flex items-center gap-2">
            {task.status === "queued" && (
              <Button
                type="button"
                variant="quiet"
                onClick={async () => {
                  try {
                    const values = task.question!.answers;
                    await runtime.queue.remove(threadId, task.id);
                    setAnswers(
                      Object.fromEntries(
                        values.map((value, index) => {
                          const option =
                            item.questions?.[index].options?.indexOf(value) ??
                            -1;
                          return [
                            index,
                            option < 0 ? "custom" : String(option),
                          ];
                        }),
                      ),
                    );
                    setCustom(
                      Object.fromEntries(
                        values.map((value, index) => [index, value]),
                      ),
                    );
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : t("暂时无法修改回答。"),
                    );
                  }
                }}
              >
                {t("修改回答")}
              </Button>
            )}
            {task.status !== "sending" && (
              <Button
                type="button"
                variant="quiet"
                onClick={async () => {
                  try {
                    await runtime.queue.remove(threadId, task.id);
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : t("取消失败，请重试。"),
                    );
                  }
                }}
              >
                {task.status === "uncertain"
                  ? t("移除待确认回答")
                  : t("取消待发送")}
              </Button>
            )}
            {task.status === "queued" &&
              runtime.queue.forThread(threadId).paused && (
                <Button
                  type="button"
                  onClick={async () => {
                    try {
                      await runtime.queue.resume(threadId);
                    } catch (error) {
                      setError(
                        error instanceof Error
                          ? error.message
                          : t("暂时无法继续发送。"),
                      );
                    }
                  }}
                >
                  {t("继续发送")}
                </Button>
              )}
          </div>
        </>
      ) : confirmed || ignored ? (
        <>
          <p className="text-muted">
            {t("此问题已回答或已忽略，可在会话中继续补充。")}
          </p>
        </>
      ) : !pending ? (
        <p role="status" className="text-muted">
          {t("正在核实问题状态，请等待会话记录加载。")}
        </p>
      ) : (
        <>
          {occupied && (
            <p className="mb-2 text-muted">
              {t(
                "此会话由其他客户端控制，提交后将保留回答，取得写入权限后自动发送。",
              )}
            </p>
          )}
          {blocked && (
            <p className="mb-2 text-muted">
              {t("提交后将保留回答，待当前确认请求处理完毕后发送。")}
            </p>
          )}
          {connection.status !== "connected" && (
            <p className="mb-2 text-muted">
              {t("连接已断开，仍可提交并保留回答，重连后请检查并继续发送。")}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              disabled={
                disabled ||
                !item.questions?.every((_, index) => answer(index).trim())
              }
            >
              {sending ? t("正在保存…") : t("提交回答")}
            </Button>
            <Button
              type="button"
              variant="quiet"
              disabled={sending}
              onClick={() =>
                runtime.questionDismissals.ignore(threadId, item.id)
              }
            >
              {t("忽略")}
            </Button>
          </div>
          <p className="mt-2 text-muted">
            {t(
              "可忽略此问题；提交的回答会作为会话消息发送，暂时无法发送时会保留。",
            )}
          </p>
        </>
      )}
    </form>
  );
}

export function AsyncQuestionPanel({ thread }: { thread: Thread }) {
  useTranslation();
  const runtime = useRuntime();
  useStore(runtime.questionDismissals);
  useStore(runtime.queue);
  const connection = useStore(runtime.connection);
  const sessions = useStore(runtime.sessions);
  const active = useMemo(() => pendingAsyncQuestions(thread), [thread]);
  const sent = runtime.queue.forThread(thread.id).sentAnswers;
  const queued = runtime.queue.forThread(thread.id).items;
  const all = active.filter(
    (item) =>
      !sent?.[item.id] &&
      !queued.some((task) => task.question?.itemId === item.id),
  );
  const ignored = all.filter((item) =>
    runtime.questionDismissals.isIgnored(thread.id, item.id),
  );
  const pending = all.filter(
    (item) => !runtime.questionDismissals.isIgnored(thread.id, item.id),
  );
  if (sessions.archivedIds[thread.id]) return <ArchivedQuestions items={all} />;
  return (
    <ScrollArea
      role="region"
      aria-label={t("待回答问题")}
      data-slot="async-question-panel"
      className="conversation-content max-h-[45vh] shrink-0"
    >
      {ignored.length > 0 && (
        <Button
          type="button"
          variant="quiet"
          onClick={() =>
            ignored.forEach((item) =>
              runtime.questionDismissals.restore(thread.id, item.id),
            )
          }
        >
          {t("恢复已忽略问题（{{value0}}）", { value0: ignored.length })}
        </Button>
      )}
      <QuestionPresence
        entries={pending.map((item) => ({
          id: JSON.stringify([connection.url, thread.id, item.id]),
          answerFor: item.id,
          content: <AsyncQuestions item={item} threadId={thread.id} />,
        }))}
      />
    </ScrollArea>
  );
}

function ArchivedQuestions({ items }: { items: QuestionMessage[] }) {
  useTranslation();
  return (
    <ScrollArea
      role="region"
      aria-label={t("已归档会话中的问题")}
      className="conversation-content max-h-[45vh] shrink-0 text-control"
    >
      <p className="mb-2 text-xs text-muted">
        {t("会话已归档，问题仅供查看。恢复会话后可回答。")}
      </p>
      {items.map((item) => (
        <dl
          key={item.id}
          className="mb-3 space-y-2 rounded-xl border border-border bg-elevated p-4"
        >
          {item.questions?.map((question, index) => (
            <div key={index}>
              <dt className="font-semibold">{question.title}</dt>
              {!!question.options?.length && (
                <dd className="mt-1 text-muted">
                  {question.options.join(" / ")}
                </dd>
              )}
            </div>
          ))}
        </dl>
      ))}
    </ScrollArea>
  );
}
