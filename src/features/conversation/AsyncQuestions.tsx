import type { Thread } from "../../generated/v2/Thread";
import { useRef, useState } from "react";
import { useRuntime } from "../../lib/runtime-context";
import { useStore } from "../../components/hooks";
import { Button, ErrorNotice } from "../../components/ui";
import { pendingAsyncQuestions, type QuestionMessage } from "./async-questions";

export function AsyncQuestions({
  item,
  threadId,
}: {
  item: QuestionMessage;
  threadId: string;
}) {
  const runtime = useRuntime();
  const sessions = useStore(runtime.sessions);
  const connection = useStore(runtime.connection);
  const requests = useStore(runtime.requests);
  useStore(runtime.questionDismissals);
  const queueState = useStore(runtime.queue);
  const task = runtime.queue
    .forThread(threadId)
    .items.find((task) => task.question?.itemId === item.id);
  const saved = task?.question?.answers;
  const [answers, setAnswers] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      (saved ?? []).map((answer, index) => {
        const option = item.questions?.[index].options?.indexOf(answer) ?? -1;
        return [index, option < 0 ? "custom" : String(option)];
      }),
    ),
  );
  const [custom, setCustom] = useState<Record<number, string>>(() =>
    Object.fromEntries((saved ?? []).map((answer, index) => [index, answer])),
  );
  const [sending, setSending] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const thread = sessions.threads[threadId];
  const pending =
    !!thread &&
    pendingAsyncQuestions(thread).some((message) => message.id === item.id) &&
    !runtime.questionDismissals.isIgnored(threadId, item.id);
  const occupied =
    sessions.threadAccess[threadId] === "occupied" ||
    (!!runtime.sessions.activeTurn(threadId) &&
      sessions.threadAccess[threadId] !== "editable");
  const blocked = requests.pending.some(
    (request) =>
      "threadId" in request.params && request.params.threadId === threadId,
  );
  const inputDisabled = sending || !!task || !pending;
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
  return (
    <form
      className="mt-4 rounded-xl border border-border bg-elevated p-4 text-[13px]"
      aria-label="回答异步问题"
      onSubmit={async (event) => {
        event.preventDefault();
        if (
          disabled ||
          lock.current ||
          !item.questions?.every((_, index) => answer(index).trim())
        )
          return;
        lock.current = true;
        setSending(true);
        setError("");
        try {
          await runtime.queue.addAnswer(
            threadId,
            item,
            item.questions.map((_, index) => answer(index)),
          );
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "回答发送失败，请核实会话记录后重试。",
          );
        } finally {
          lock.current = false;
          setSending(false);
        }
      }}
    >
      <p className="mb-3 font-semibold">需要你的回答</p>
      {item.questions?.map((question, index) => (
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
              自定义回答
            </label>
          )}
          {(!question.options?.length || selection(index) === "custom") && (
            <input
              aria-label={question.title}
              className="w-full rounded-md border border-border bg-elevated p-2 text-foreground"
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
      {task ? (
        <>
          <p role="status" className="mb-2 text-muted">
            {task.status === "sending"
              ? "正在发送回答…"
              : task.status === "uncertain"
                ? "发送结果待确认，请先核实会话记录，系统不会自动重发。"
                : runtime.queue.forThread(threadId).paused
                  ? "回答已保存，待确认后继续发送。"
                  : "回答已保存，等待连接或写入权限，恢复后自动发送。"}
          </p>
          <p className="mb-2 whitespace-pre-wrap text-muted">
            {task.question?.answers.join("\n")}
          </p>
          <div className="flex items-center gap-2">
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
                        : "取消失败，请重试。",
                    );
                  }
                }}
              >
                {task.status === "uncertain" ? "移除待确认回答" : "取消待发送"}
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
                          : "暂时无法继续发送。",
                      );
                    }
                  }}
                >
                  继续发送
                </Button>
              )}
          </div>
        </>
      ) : !pending ? (
        <p className="text-muted">此问题已有后续回复，可在会话中继续补充。</p>
      ) : (
        <>
          {occupied && (
            <p className="mb-2 text-muted">
              此会话由其他客户端控制，提交后将保留回答，取得写入权限后自动发送。
            </p>
          )}
          {blocked && (
            <p className="mb-2 text-muted">
              提交后将保留回答，待当前确认请求处理完毕后发送。
            </p>
          )}
          {connection.status !== "connected" && (
            <p className="mb-2 text-muted">
              连接已断开，仍可提交并保留回答，重连后自动发送。
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
              {sending ? "正在发送…" : "提交回答"}
            </Button>
            <Button
              type="button"
              variant="quiet"
              disabled={sending}
              onClick={() =>
                runtime.questionDismissals.ignore(threadId, item.id)
              }
            >
              忽略
            </Button>
          </div>
          <p className="mt-2 text-muted">
            可忽略此问题；提交的回答会作为会话消息发送，暂时无法发送时会保留。
          </p>
        </>
      )}
    </form>
  );
}

export function AsyncQuestionPanel({ thread }: { thread: Thread }) {
  const runtime = useRuntime();
  useStore(runtime.questionDismissals);
  const pending = pendingAsyncQuestions(thread).filter(
    (item) => !runtime.questionDismissals.isIgnored(thread.id, item.id),
  );
  if (!pending.length) return null;
  return (
    <section
      aria-label="待回答问题"
      data-slot="async-question-panel"
      className="mx-auto max-h-[45vh] w-full max-w-[840px] shrink-0 overflow-y-auto px-4 pb-3 sm:px-7"
    >
      {pending.map((item) => (
        <AsyncQuestions
          key={JSON.stringify([thread.id, item.id])}
          item={item}
          threadId={thread.id}
        />
      ))}
    </section>
  );
}
