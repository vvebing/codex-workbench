import { t, useLocale } from "../../lib/i18n";
import { QuestionPresence } from "../conversation/QuestionPresence";
import { useStableQuestionCard } from "../conversation/use-stable-question-card";
import { settingsInputClass } from "../settings/settings-ui";
import {
  questionDraftKey,
  readQuestionDraft,
  clearQuestionDraft,
  writeQuestionDraft,
} from "../conversation/question-drafts";
import {
  PermissionsApproval,
  ElicitationApproval,
} from "./AdditionalApprovals";
import { ScrollArea, Button, ErrorNotice } from "../../components/ui";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { ShieldCheck } from "lucide-react";
import { useRuntime } from "../../lib/runtime-context";
import { requestThreadId } from "../requests/store";
import type { RpcRequest } from "../../lib/rpc";
import type { CommandExecutionApprovalDecision } from "../../generated/v2/CommandExecutionApprovalDecision";
import type { ToolRequestUserInputParams } from "../../generated/v2/ToolRequestUserInputParams";
interface Choice {
  label: string;
  decision: CommandExecutionApprovalDecision;
}
function ApprovalCard({
  title,
  children,
  requestId,
  receipt = false,
}: {
  title: ReactNode;
  children: ReactNode;
  requestId?: string;
  receipt?: boolean;
}) {
  const i18nLocale = useLocale();
  void i18nLocale;

  const stable = useStableQuestionCard(receipt);
  return (
    <section
      ref={stable.ref}
      style={{ minHeight: stable.minHeight }}
      onSubmitCapture={stable.preserve}
      data-question-request-id={requestId}
      tabIndex={requestId ? -1 : undefined}
      className="mb-3 min-w-0 rounded-lg border border-border bg-elevated p-4 text-control leading-copy [overflow-wrap:anywhere]"
    >
      <h3 className="mb-3 flex items-center gap-2 text-control font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}
function AnswerOption({ children }: { children: ReactNode }) {
  const i18nLocale = useLocale();
  void i18nLocale;

  return (
    <label className="flex min-h-10 cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-hover has-[:checked]:bg-selected">
      {children}
    </label>
  );
}
function UserInputForm({
  params,
  disabled,
  respond,
}: {
  params: ToolRequestUserInputParams;
  disabled: boolean;
  respond: (result: unknown) => boolean;
}) {
  const i18nLocale = useLocale();
  void i18nLocale;
  const runtime = useRuntime();
  const key = questionDraftKey(
    runtime.connection.getSnapshot().url,
    params.threadId,
    params.itemId,
  );
  const [draft] = useState(() => readQuestionDraft(key));
  const secretIds = params.questions
    .filter((question) => question.isSecret)
    .map((question) => question.id);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(draft.values).filter(([id]) => !secretIds.includes(id)),
    ),
  );
  const [custom, setCustom] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(draft.custom).filter(([id]) => !secretIds.includes(id)),
    ),
  );
  useEffect(() => {
    writeQuestionDraft(
      key,
      { values, custom },
      params.questions
        .filter((question) => question.isSecret)
        .map((question) => question.id),
    );
  }, [key, values, custom, params.questions]);
  const answer = (id: string) =>
    values[id] === "__custom__" ? (custom[id] ?? "") : (values[id] ?? "");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (params.questions.every((question) => answer(question.id).trim()))
          if (
            respond({
              answers: Object.fromEntries(
                params.questions.map((question) => [
                  question.id,
                  { answers: [answer(question.id)] },
                ]),
              ),
            })
          )
            clearQuestionDraft(key);
      }}
    >
      {params.questions.map((question) => (
        <fieldset
          className="mb-5 border-0 p-0"
          key={question.id}
          disabled={disabled}
        >
          <legend className="font-semibold">{question.header}</legend>
          <p className="mb-3">{question.question}</p>
          {!question.isSecret &&
            question.options?.map((option) => (
              <AnswerOption key={option.label}>
                <input
                  className="mt-1 size-4 shrink-0 accent-accent"
                  required
                  type="radio"
                  name={question.id}
                  value={option.label}
                  checked={values[question.id] === option.label}
                  onChange={() =>
                    setValues({ ...values, [question.id]: option.label })
                  }
                />
                <span>
                  {option.label}
                  <small className="mt-[3px] block text-muted">
                    {option.description}
                  </small>
                </span>
              </AnswerOption>
            ))}
          {question.isOther &&
            !question.isSecret &&
            !!question.options?.length && (
              <AnswerOption>
                <input
                  className="mt-1 size-4 shrink-0 accent-accent"
                  type="radio"
                  name={question.id}
                  checked={values[question.id] === "__custom__"}
                  onChange={() =>
                    setValues({ ...values, [question.id]: "__custom__" })
                  }
                />
                {t("自定义回答")}
              </AnswerOption>
            )}
          {question.isSecret ||
          !question.options?.length ||
          values[question.id] === "__custom__" ? (
            question.isSecret ? (
              <input
                className={settingsInputClass}
                type={question.isSecret ? "password" : "text"}
                required
                autoComplete="off"
                aria-label={question.question}
                value={
                  values[question.id] === "__custom__"
                    ? (custom[question.id] ?? "")
                    : (values[question.id] ?? "")
                }
                onChange={(event) =>
                  values[question.id] === "__custom__"
                    ? setCustom({
                        ...custom,
                        [question.id]: event.target.value,
                      })
                    : setValues({
                        ...values,
                        [question.id]: event.target.value,
                      })
                }
              />
            ) : (
              <textarea
                className={settingsInputClass}
                rows={4}
                required
                autoComplete="off"
                aria-label={question.question}
                value={
                  values[question.id] === "__custom__"
                    ? (custom[question.id] ?? "")
                    : (values[question.id] ?? "")
                }
                onChange={(event) =>
                  values[question.id] === "__custom__"
                    ? setCustom({
                        ...custom,
                        [question.id]: event.target.value,
                      })
                    : setValues({
                        ...values,
                        [question.id]: event.target.value,
                      })
                }
              />
            )
          ) : null}
        </fieldset>
      ))}
      <Button
        type="submit"
        disabled={
          disabled ||
          !params.questions.every((question) => answer(question.id).trim())
        }
      >
        {t("提交回答")}
      </Button>
    </form>
  );
}
function Approval({
  request,
  disabled,
}: {
  request?: RpcRequest;
  disabled: boolean;
}) {
  const i18nLocale = useLocale();
  void i18nLocale;
  const runtime = useRuntime();
  const respond = (result: unknown) => {
    if (!request) return false;
    const sent = runtime.requests.respond(request.id, result);
    return sent;
  };
  if (!request) return null;
  if (request.method === "item/permissions/requestApproval")
    return (
      <ApprovalCard title={t("权限审批")}>
        <PermissionsApproval
          params={request.params}
          disabled={disabled}
          respond={respond}
        />
      </ApprovalCard>
    );
  if (request.method === "mcpServer/elicitation/request")
    return (
      <ApprovalCard title={t("MCP 服务请求")}>
        <ElicitationApproval
          params={request.params}
          disabled={disabled}
          respond={respond}
        />
      </ApprovalCard>
    );
  if (request.method === "item/tool/requestUserInput")
    return (
      <ApprovalCard title={t("需要你的回答")} requestId={String(request.id)}>
        <UserInputForm
          params={request.params}
          disabled={disabled}
          respond={respond}
        />
      </ApprovalCard>
    );
  if (
    request.method !== "item/commandExecution/requestApproval" &&
    request.method !== "item/fileChange/requestApproval"
  )
    return null;
  const params = request.params;
  const choices: Choice[] = [
    { label: t("允许一次"), decision: "accept" },
    { label: t("本会话允许"), decision: "acceptForSession" },
    { label: t("拒绝"), decision: "decline" },
    { label: t("取消执行"), decision: "cancel" },
  ];
  if (request.method === "item/commandExecution/requestApproval") {
    if (request.params.proposedExecpolicyAmendment)
      choices.push({
        label: t("允许此命令规则"),
        decision: {
          acceptWithExecpolicyAmendment: {
            execpolicy_amendment: request.params.proposedExecpolicyAmendment,
          },
        },
      });
    for (const amendment of request.params.proposedNetworkPolicyAmendments ??
      [])
      choices.push({
        label: t("{{value0}}访问 {{value1}}", {
          value0: amendment.action === "allow" ? t("允许") : t("拒绝"),
          value1: amendment.host,
        }),
        decision: {
          applyNetworkPolicyAmendment: { network_policy_amendment: amendment },
        },
      });
  }
  // Newer servers can explicitly narrow the protocol decision set.
  const advertised: unknown = (params as unknown as Record<string, unknown>)
    .availableDecisions;
  const allowed = Array.isArray(advertised)
    ? choices.filter((choice) =>
        advertised.some(
          (decision) =>
            JSON.stringify(decision) === JSON.stringify(choice.decision),
        ),
      )
    : choices;
  return (
    <ApprovalCard
      title={
        <>
          <ShieldCheck size={17} />
          {request.method === "item/commandExecution/requestApproval"
            ? t("命令执行审批")
            : t("文件修改审批")}
        </>
      }
    >
      {params.reason && <p className="mb-3">{params.reason}</p>}
      {request.method === "item/commandExecution/requestApproval" ? (
        <>
          <ScrollArea orientation="both">
            <pre className="my-3 whitespace-pre-wrap rounded-md bg-surface p-3 font-mono text-xs leading-code [overflow-wrap:anywhere]">
              {request.params.command ?? t("请求执行操作")}
            </pre>
          </ScrollArea>
          {request.params.cwd && (
            <p className="mb-3 text-xs text-muted [overflow-wrap:anywhere]">
              {request.params.cwd}
            </p>
          )}
        </>
      ) : (
        request.params.grantRoot && (
          <p className="mb-3">
            {t("写入目录：")}
            {request.params.grantRoot}
          </p>
        )
      )}
      <div className="flex flex-wrap gap-2">
        {allowed.map((choice) => (
          <Button
            key={choice.label}
            disabled={disabled}
            onClick={() => respond({ decision: choice.decision })}
          >
            {choice.label}
          </Button>
        ))}
      </div>
      {!allowed.length && (
        <p role="status" className="mb-3">
          {t("服务端未提供可用审批选项。")}
        </p>
      )}
    </ApprovalCard>
  );
}
export function ApprovalQueue({ threadId }: { threadId: string }) {
  const i18nLocale = useLocale();
  void i18nLocale;
  const runtime = useRuntime();
  const requests = useSyncExternalStore(
    runtime.requests.subscribe,
    runtime.requests.getSnapshot,
  );
  const connection = useSyncExternalStore(
    runtime.connection.subscribe,
    runtime.connection.getSnapshot,
  );
  const pending = requests.pending.filter(
    (request) => requestThreadId(request) === threadId,
  );
  return (
    <div
      className="mx-auto min-w-0 max-w-[840px] px-4 sm:px-6"
      aria-label={t("待处理请求")}
    >
      {requests.error && <ErrorNotice>{requests.error}</ErrorNotice>}
      <QuestionPresence
        entries={pending.map((request) => ({
          id: `${connection.url}-${connection.epoch}-${request.id}`,
          answerFor: `tool:${connection.epoch}:${request.id}`,
          content: (
            <Approval
              request={request}
              disabled={
                connection.status !== "connected" ||
                requests.respondingIds.includes(request.id)
              }
            />
          ),
        }))}
      />
    </div>
  );
}
