import {
  PermissionsApproval,
  ElicitationApproval,
} from "./AdditionalApprovals";
import { ScrollArea, Button } from "../../components/ui";
import { useState, useSyncExternalStore, type ReactNode } from "react";

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
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-2.5 rounded-[10px] border border-border bg-elevated p-4 text-[13px]">
      <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}
function AnswerOption({ children }: { children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-[9px] py-2">
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
  respond: (result: unknown) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const answer = (id: string) =>
    values[id] === "__custom__" ? (custom[id] ?? "") : (values[id] ?? "");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (params.questions.every((question) => answer(question.id).trim()))
          respond({
            answers: Object.fromEntries(
              params.questions.map((question) => [
                question.id,
                { answers: [answer(question.id)] },
              ]),
            ),
          });
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
                  className="mt-[3px] accent-accent"
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
                  className="mt-[3px] accent-accent"
                  type="radio"
                  name={question.id}
                  checked={values[question.id] === "__custom__"}
                  onChange={() =>
                    setValues({ ...values, [question.id]: "__custom__" })
                  }
                />
                自定义回答
              </AnswerOption>
            )}
          {question.isSecret ||
          !question.options?.length ||
          values[question.id] === "__custom__" ? (
            <input
              className="box-border w-full rounded-md border border-border bg-elevated p-2.5 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
                  ? setCustom({ ...custom, [question.id]: event.target.value })
                  : setValues({ ...values, [question.id]: event.target.value })
              }
            />
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
        提交回答
      </Button>
    </form>
  );
}
function Approval({
  request,
  disabled,
}: {
  request: RpcRequest;
  disabled: boolean;
}) {
  const runtime = useRuntime();
  const respond = (result: unknown) => {
    runtime.requests.respond(request.id, result);
  };
  if (request.method === "item/permissions/requestApproval")
    return (
      <ApprovalCard title="权限审批">
        <PermissionsApproval
          params={request.params}
          disabled={disabled}
          respond={respond}
        />
      </ApprovalCard>
    );
  if (request.method === "mcpServer/elicitation/request")
    return (
      <ApprovalCard title="MCP 服务请求">
        <ElicitationApproval
          params={request.params}
          disabled={disabled}
          respond={respond}
        />
      </ApprovalCard>
    );
  if (request.method === "item/tool/requestUserInput")
    return (
      <ApprovalCard title="需要你的回答">
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
    { label: "允许一次", decision: "accept" },
    { label: "本会话允许", decision: "acceptForSession" },
    { label: "拒绝", decision: "decline" },
    { label: "取消执行", decision: "cancel" },
  ];
  if (request.method === "item/commandExecution/requestApproval") {
    if (request.params.proposedExecpolicyAmendment)
      choices.push({
        label: "允许此命令规则",
        decision: {
          acceptWithExecpolicyAmendment: {
            execpolicy_amendment: request.params.proposedExecpolicyAmendment,
          },
        },
      });
    for (const amendment of request.params.proposedNetworkPolicyAmendments ??
      [])
      choices.push({
        label: `${amendment.action === "allow" ? "允许" : "拒绝"}访问 ${amendment.host}`,
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
            ? "命令执行审批"
            : "文件修改审批"}
        </>
      }
    >
      {params.reason && <p className="mb-3">{params.reason}</p>}
      {request.method === "item/commandExecution/requestApproval" ? (
        <>
          <ScrollArea orientation="both">
            <pre className="my-3 whitespace-pre-wrap rounded-md bg-surface p-3 font-mono text-xs leading-[1.65] [overflow-wrap:anywhere]">
              {request.params.command ?? "请求执行操作"}
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
          <p className="mb-3">写入目录：{request.params.grantRoot}</p>
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
          服务端未提供可用审批选项。
        </p>
      )}
    </ApprovalCard>
  );
}
export function ApprovalQueue({ threadId }: { threadId: string }) {
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
  if (!pending.length) return null;
  return (
    <div
      className="mx-auto max-w-[840px] px-4 py-2 sm:px-6 sm:py-3"
      aria-label="待处理请求"
    >
      {requests.error && (
        <p role="alert" className="text-danger">
          {requests.error}
        </p>
      )}
      {pending.map((request) => (
        <Approval
          key={`${connection.epoch}-${request.id}`}
          request={request}
          disabled={
            connection.status !== "connected" ||
            requests.respondingIds.includes(request.id)
          }
        />
      ))}
    </div>
  );
}
