import {
  permissionSubset,
  validFormContent,
  safeElicitationUrl,
  record,
} from "../approvals/validation";
import type { RpcRequest, RpcId } from "../../lib/rpc";
import { Store, errorMessage } from "../../lib/store";
import type { ConnectionStore } from "../connection/store";
export interface RequestsState {
  pending: RpcRequest[];
  respondingIds: RpcId[];
  error: string | null;
  submittedAnswers: SubmittedAnswer[];
}
export interface SubmittedAnswer {
  id: RpcId;
  epoch: number;
  threadId: string;
  turnId?: string;
  afterItemId?: string;
  answers: { question: string; answer: string }[];
  status: "submitted" | "resolved" | "uncertain";
}
export function requestThreadId(request: RpcRequest): string | undefined {
  return "threadId" in request.params
    ? String(request.params.threadId)
    : undefined;
}
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return (
      a.length === b.length && a.every((value, index) => same(value, b[index]))
    );
  if (record(a) && record(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && same(a[key], b[key]))
    );
  }
  return false;
}
export function validApprovalResponse(
  request: RpcRequest,
  result: unknown,
): boolean {
  if (request.method === "item/tool/requestUserInput") {
    if (!record(result) || !record(result.answers)) return false;
    const answers = result.answers;
    return (
      Object.keys(answers).length === request.params.questions.length &&
      request.params.questions.every((question) => {
        const value = answers[question.id];
        return (
          record(value) &&
          Array.isArray(value.answers) &&
          value.answers.length > 0 &&
          value.answers.every(
            (answer) => typeof answer === "string" && answer.trim().length > 0,
          )
        );
      })
    );
  }
  if (request.method === "item/permissions/requestApproval")
    return (
      record(result) &&
      ["turn", "session"].includes(String(result.scope)) &&
      (result.strictAutoReview === undefined ||
        typeof result.strictAutoReview === "boolean") &&
      permissionSubset(result.permissions, request.params.permissions)
    );
  if (request.method === "mcpServer/elicitation/request") {
    if (!record(result) || result._meta !== null) return false;
    if (result.action === "decline" || result.action === "cancel")
      return result.content === null;
    if (result.action !== "accept") return false;
    return request.params.mode === "url"
      ? !!safeElicitationUrl(request.params.url) && result.content === null
      : request.params.mode === "form" &&
          validFormContent(request.params.requestedSchema, result.content);
  }
  if (
    request.method !== "item/commandExecution/requestApproval" &&
    request.method !== "item/fileChange/requestApproval"
  )
    return true;
  if (!record(result) || !("decision" in result)) return false;
  const decision = result.decision;
  const params = request.params as unknown as Record<string, unknown>;
  const advertised = params.availableDecisions;
  if (
    Array.isArray(advertised) &&
    !advertised.some((value) => same(value, decision))
  )
    return false;
  if (typeof decision === "string")
    return ["accept", "acceptForSession", "decline", "cancel"].includes(
      decision,
    );
  if (
    request.method !== "item/commandExecution/requestApproval" ||
    !record(decision) ||
    Object.keys(decision).length !== 1
  )
    return false;
  if (record(decision.acceptWithExecpolicyAmendment))
    return (
      params.proposedExecpolicyAmendment != null &&
      same(decision.acceptWithExecpolicyAmendment, {
        execpolicy_amendment: params.proposedExecpolicyAmendment,
      })
    );
  if (record(decision.applyNetworkPolicyAmendment))
    return (
      Array.isArray(params.proposedNetworkPolicyAmendments) &&
      params.proposedNetworkPolicyAmendments.some((value) =>
        same(decision.applyNetworkPolicyAmendment, {
          network_policy_amendment: value,
        }),
      )
    );
  return false;
}
export class RequestsStore extends Store<RequestsState> {
  private answered = new Set<RpcId>();
  constructor(
    private connection: ConnectionStore,
    private answerAnchor?: (
      threadId: string,
      turnId: string,
    ) => string | undefined,
  ) {
    super({
      pending: [],
      respondingIds: [],
      error: null,
      submittedAnswers: [],
    });
    let epoch = connection.getSnapshot().epoch;
    let scope = connection.getSnapshot().scope;
    connection.subscribe(() => {
      const next = connection.getSnapshot().epoch;
      const nextScope = connection.getSnapshot().scope;
      if (nextScope !== scope) {
        scope = nextScope;
        this.update({ ...this.state, submittedAnswers: [] });
      }
      if (next !== epoch) {
        epoch = next;
        this.answered.clear();
        this.update({
          pending: [],
          respondingIds: [],
          error: null,
          submittedAnswers: this.state.submittedAnswers.map((answer) =>
            answer.status === "submitted"
              ? { ...answer, status: "uncertain" }
              : answer,
          ),
        });
      }
    });
    connection.client.onRequest((request) => {
      if (this.answered.has(request.id)) return;
      if (
        ![
          "item/commandExecution/requestApproval",
          "item/fileChange/requestApproval",
          "item/tool/requestUserInput",
          "item/permissions/requestApproval",
          "mcpServer/elicitation/request",
        ].includes(request.method)
      ) {
        connection.client.respondError(
          request.id,
          -32601,
          "Unsupported client request",
        );
        return;
      }
      if (!this.state.pending.some((old) => old.id === request.id))
        this.update({
          ...this.state,
          pending: [...this.state.pending, request],
        });
    });
    connection.client.onNotification((event) => {
      if (event.method === "serverRequest/resolved") {
        this.answered.add(event.params.requestId);
        this.update({
          ...this.state,
          submittedAnswers: this.state.submittedAnswers.map((answer) =>
            answer.id === event.params.requestId &&
            answer.threadId === event.params.threadId &&
            answer.epoch === epoch
              ? { ...answer, status: "resolved" }
              : answer,
          ),
        });
        this.remove(event.params.requestId);
      }
    });
  }
  dismissAnswer(id: RpcId, epoch: number): void {
    this.update({
      ...this.state,
      submittedAnswers: this.state.submittedAnswers.filter(
        (answer) => answer.id !== id || answer.epoch !== epoch,
      ),
    });
  }
  forThread(threadId: string): RpcRequest[] {
    return this.state.pending.filter(
      (request) => requestThreadId(request) === threadId,
    );
  }
  private remove(id: RpcId): void {
    this.update({
      ...this.state,
      pending: this.state.pending.filter((request) => request.id !== id),
      respondingIds: this.state.respondingIds.filter((value) => value !== id),
    });
  }
  respond(id: RpcId, result: unknown): boolean {
    const request = this.state.pending.find((request) => request.id === id);
    if (!request || !validApprovalResponse(request, result)) {
      this.update({
        ...this.state,
        error: "回答不完整或不符合当前请求，请检查后重试。",
      });
      return false;
    }
    const afterItemId =
      request.method === "item/tool/requestUserInput"
        ? this.answerAnchor?.(request.params.threadId, request.params.turnId)
        : undefined;
    return this.reply(
      id,
      () => this.connection.client.respond(id, result),
      () => {
        if (request.method === "item/tool/requestUserInput") {
          const answers = (
            result as { answers: Record<string, { answers: string[] }> }
          ).answers;
          this.update({
            ...this.state,
            pending: this.state.pending.filter((entry) => entry.id !== id),
            respondingIds: this.state.respondingIds.filter(
              (entry) => entry !== id,
            ),
            submittedAnswers: [
              ...this.state.submittedAnswers,
              {
                id,
                epoch: this.connection.getSnapshot().epoch,
                threadId: request.params.threadId,
                turnId: request.params.turnId,
                afterItemId,
                status: "submitted",
                answers: request.params.questions.map((question) => ({
                  question: question.question,
                  answer: question.isSecret
                    ? "（私密回答已隐藏）"
                    : answers[question.id].answers.join("\n"),
                })),
              },
            ],
          });
        }
      },
    );
  }
  reject(id: RpcId, message = "Declined by user"): boolean {
    return this.reply(id, () =>
      this.connection.client.respondError(id, -32000, message),
    );
  }
  private reply(
    id: RpcId,
    send: () => void,
    recordAnswer?: () => void,
  ): boolean {
    if (
      !this.state.pending.some((request) => request.id === id) ||
      this.state.respondingIds.includes(id)
    )
      return false;
    this.update({
      ...this.state,
      respondingIds: [...this.state.respondingIds, id],
      error: null,
    });
    try {
      send();
      this.answered.add(id);
      // Record the receipt before removing the request so subscribers never see
      // a frame with neither the question nor its submitted answer.
      recordAnswer?.();
      this.remove(id);
      return true;
    } catch (error) {
      this.update({
        ...this.state,
        respondingIds: this.state.respondingIds.filter((value) => value !== id),
        error: errorMessage(error),
      });
      return false;
    }
  }
}
