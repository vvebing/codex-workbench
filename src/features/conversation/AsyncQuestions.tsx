import { useRef, useState } from "react";
import { useRuntime } from "../../lib/runtime-context";
import { useStore } from "../../components/hooks";
import { Button, ErrorNotice } from "../../components/ui";
import {
  asyncAnswerText,
  pendingAsyncQuestions,
  type QuestionMessage,
} from "./async-questions";

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
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [sending, setSending] = useState(false);
  const lock = useRef(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const thread = sessions.threads[threadId];
  const pending =
    !!thread &&
    pendingAsyncQuestions(thread).some((message) => message.id === item.id);
  const occupied =
    sessions.threadAccess[threadId] === "occupied" ||
    (!!runtime.sessions.activeTurn(threadId) &&
      sessions.threadAccess[threadId] !== "editable");
  const blocked = requests.pending.some(
    (request) =>
      "threadId" in request.params && request.params.threadId === threadId,
  );
  const disabled =
    sending ||
    submitted ||
    !pending ||
    occupied ||
    blocked ||
    connection.status !== "connected";
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
          await runtime.sessions.send(threadId, [
            {
              type: "text",
              text: asyncAnswerText(
                item,
                item.questions.map((_, index) => answer(index)),
              ),
              text_elements: [],
            },
          ]);
          setSubmitted(true);
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
        <fieldset key={index} disabled={disabled} className="mb-4 border-0 p-0">
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
                checked={answers[index] === String(optionIndex)}
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
                checked={answers[index] === "custom"}
                onChange={() => setAnswers({ ...answers, [index]: "custom" })}
              />
              自定义回答
            </label>
          )}
          {(!question.options?.length || answers[index] === "custom") && (
            <input
              aria-label={question.title}
              className="w-full rounded-md border border-border bg-elevated p-2 text-foreground"
              value={custom[index] ?? ""}
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
      {submitted ? (
        <p role="status">回答已发送</p>
      ) : !pending ? (
        <p className="text-muted">此问题已有后续回复，可在会话中继续补充。</p>
      ) : (
        <>
          {occupied && (
            <p className="mb-2 text-muted">
              此会话由其他客户端控制，请在原客户端回答，或待其释放会话后重试。
            </p>
          )}
          {blocked && (
            <p className="mb-2 text-muted">请先处理当前会话的确认请求。</p>
          )}
          {connection.status !== "connected" && (
            <p className="mb-2 text-muted">连接已断开，重连后可提交回答。</p>
          )}
          <Button
            type="submit"
            disabled={
              disabled ||
              !item.questions?.every((_, index) => answer(index).trim())
            }
          >
            {sending ? "正在发送…" : "提交回答"}
          </Button>
          <p className="mt-2 text-muted">回答将作为会话消息发送。</p>
        </>
      )}
    </form>
  );
}
