import { expect, it, vi } from "vitest";
import { ConnectionStore } from "../../src/features/connection/store";
import { RequestsStore } from "../../src/features/requests/store";
import type { RpcRequest } from "../../src/lib/rpc";

it("publishes a redacted receipt in the same update that removes its question", () => {
  const connection = new ConnectionStore();
  let receive!: (request: RpcRequest) => void;
  vi.spyOn(connection.client, "onRequest").mockImplementation((listener) => {
    receive = listener;
    return () => {};
  });
  vi.spyOn(connection.client, "respond").mockImplementation(() => {});
  const store = new RequestsStore(connection);
  receive({
    id: "question",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread",
      turnId: "turn",
      itemId: "item",
      isBlocking: true,
      autoResolutionMs: null,
      questions: [
        {
          id: "secret",
          header: "Secret",
          question: "Password",
          isSecret: true,
          isOther: false,
          options: null,
        },
      ],
    },
  });
  const frames: { pending: boolean; receipt: boolean }[] = [];
  store.subscribe(() => {
    const state = store.getSnapshot();
    frames.push({
      pending: state.pending.some((request) => request.id === "question"),
      receipt: state.submittedAnswers.some(
        (answer) => answer.id === "question",
      ),
    });
    expect(JSON.stringify(state.submittedAnswers)).not.toContain(
      "private-token",
    );
  });
  expect(
    store.respond("question", {
      answers: { secret: { answers: ["private-token"] } },
    }),
  ).toBe(true);
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.every((frame) => frame.pending !== frame.receipt)).toBe(true);
  expect(frames.at(-1)).toEqual({ pending: false, receipt: true });
});
