import { expect, it, vi } from "vitest";
import { ConnectionStore } from "../../src/features/connection/store";
import {
  RequestsStore,
  validApprovalResponse,
} from "../../src/features/requests/store";
import type { RpcNotification, RpcRequest } from "../../src/lib/rpc";

const question: RpcRequest = {
  id: 7,
  method: "item/tool/requestUserInput",
  params: {
    threadId: "a",
    turnId: "turn",
    itemId: "item",
    isBlocking: true,
    autoResolutionMs: null,
    questions: [
      {
        id: "normal",
        header: "环境",
        question: "选择环境",
        isOther: true,
        isSecret: false,
        options: null,
      },
      {
        id: "secret",
        header: "令牌",
        question: "输入令牌",
        isOther: false,
        isSecret: true,
        options: null,
      },
    ],
  },
};
const answer = {
  answers: {
    normal: { answers: ["开发"] },
    secret: { answers: ["private-token"] },
  },
};
function setup() {
  const connection = new ConnectionStore();
  let receive!: (request: RpcRequest) => void;
  let notify!: (event: RpcNotification) => void;
  vi.spyOn(connection.client, "onRequest").mockImplementation((listener) => {
    receive = listener;
    return () => {};
  });
  vi.spyOn(connection.client, "onNotification").mockImplementation(
    (listener) => {
      notify = listener;
      return () => {};
    },
  );
  const respond = vi
    .spyOn(connection.client, "respond")
    .mockImplementation(() => {});
  const requests = new RequestsStore(connection);
  receive(question);
  return { connection, requests, respond, receive, notify };
}
it("validates complete question answers before sending", () => {
  expect(validApprovalResponse(question, answer)).toBe(true);
  for (const value of [
    {},
    { answers: {} },
    { answers: { ...answer.answers, extra: { answers: ["x"] } } },
    { answers: { ...answer.answers, normal: { answers: [" "] } } },
  ]) {
    expect(validApprovalResponse(question, value)).toBe(false);
  }
});
it("retains a redacted submitted summary until resolved and explicitly dismissed", () => {
  const { requests, respond, notify } = setup();
  expect(requests.respond(7, answer)).toBe(true);
  expect(respond).toHaveBeenCalledWith(7, answer);
  expect(requests.forThread("a")).toHaveLength(0);
  const summary = requests.getSnapshot().submittedAnswers[0];
  expect(summary.status).toBe("submitted");
  expect(JSON.stringify(summary)).not.toContain("private-token");
  expect(summary.answers[0].answer).toBe("开发");
  notify({
    method: "serverRequest/resolved",
    params: { threadId: "a", requestId: 7 },
  });
  expect(requests.getSnapshot().submittedAnswers[0].status).toBe("resolved");
  requests.dismissAnswer(7, summary.epoch);
  expect(requests.getSnapshot().submittedAnswers).toEqual([]);
});
it("preserves an unanswered form on send failure", () => {
  const { requests, respond } = setup();
  respond.mockImplementation(() => {
    throw new Error("socket unavailable");
  });
  expect(requests.respond(7, answer)).toBe(false);
  expect(requests.getSnapshot().submittedAnswers).toEqual([]);
  expect(requests.forThread("a")).toHaveLength(1);
  expect(requests.getSnapshot().error).toBe("socket unavailable");
});
it("marks interrupted submissions uncertain and isolates reused request IDs", () => {
  const { connection, requests, receive, notify } = setup();
  requests.respond(7, answer);
  connection.disconnect();
  expect(requests.getSnapshot().submittedAnswers[0].status).toBe("uncertain");
  receive(question);
  requests.respond(7, answer);
  notify({
    method: "serverRequest/resolved",
    params: { threadId: "a", requestId: 7 },
  });
  expect(
    requests.getSnapshot().submittedAnswers.map((entry) => entry.status),
  ).toEqual(["uncertain", "resolved"]);
});
