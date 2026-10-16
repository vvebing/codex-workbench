import { afterEach, expect, it, vi } from "vitest";
import { createRuntime } from "../../src/lib/runtime";
import type { RpcRequest } from "../../src/lib/rpc";

afterEach(() => vi.restoreAllMocks());

function deferred() {
  let resolve!: (id: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

it("keeps submission state outside the composer and preserves newer edits", async () => {
  const runtime = createRuntime();
  const response = deferred();
  const send = vi
    .spyOn(runtime.sessions, "send")
    .mockReturnValue(response.promise);
  runtime.drafts.setText("thread", "submitted");
  const first = runtime.sendDraft("thread");
  expect(runtime.submissions.isSending("thread")).toBe(true);
  runtime.drafts.setText("thread", "next message");
  expect(runtime.sendDraft("thread")).toBe(first);
  expect(send).toHaveBeenCalledTimes(1);
  response.resolve("thread");
  await first;
  expect(runtime.submissions.isSending("thread")).toBe(false);
  expect(runtime.drafts.get("thread").text).toBe("next message");
});

it("registers the promoted ID before draft migration notifies subscribers", async () => {
  const runtime = createRuntime();
  const response = deferred();
  const send = vi
    .spyOn(runtime.sessions, "send")
    .mockReturnValue(response.promise);
  runtime.drafts.setText("local", "submitted");
  const pending = runtime.sendDraft("local");
  runtime.drafts.subscribe(() => {
    if (runtime.drafts.getSnapshot().server)
      expect(runtime.sendDraft("server")).toBe(pending);
  });
  const promote = send.mock.calls[0][3]!;
  promote("server");
  expect(runtime.submissions.isSending("server")).toBe(true);
  response.resolve("server");
  await pending;
  expect(runtime.drafts.get("server").text).toBe("");
  expect(runtime.submissions.getSnapshot()).toEqual({});
  expect(send).toHaveBeenCalledTimes(1);
});

it("an old connection's acknowledgement cannot clear a new submission or draft", async () => {
  const runtime = createRuntime();
  const old = deferred();
  const next = deferred();
  vi.spyOn(runtime.sessions, "send")
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(next.promise);
  runtime.drafts.setText("thread", "first");
  const first = runtime.sendDraft("thread");
  runtime.connection.disconnect();
  expect(runtime.submissions.isSending("thread")).toBe(false);
  runtime.drafts.setText("thread", "second");
  const second = runtime.sendDraft("thread");
  old.resolve("thread");
  await first;
  expect(runtime.submissions.isSending("thread")).toBe(true);
  expect(runtime.drafts.get("thread").text).toBe("second");
  next.resolve("thread");
  await second;
  expect(runtime.drafts.get("thread").text).toBe("");
  expect(runtime.submissions.isSending("thread")).toBe(false);
});

it("releases failed submissions for explicit retry without clearing content", async () => {
  const runtime = createRuntime();
  const response = deferred();
  const send = vi
    .spyOn(runtime.sessions, "send")
    .mockReturnValue(response.promise);
  runtime.drafts.setText("thread", "keep me");
  const pending = runtime.sendDraft("thread");
  response.reject(new Error("writer occupied"));
  await expect(pending).rejects.toThrow("writer occupied");
  expect(runtime.submissions.isSending("thread")).toBe(false);
  expect(runtime.drafts.get("thread").text).toBe("keep me");
  send.mockResolvedValueOnce("thread");
  await runtime.sendDraft("thread");
  expect(send).toHaveBeenCalledTimes(2);
  expect(runtime.drafts.get("thread").text).toBe("");
});

it("blocks submission while the target session awaits approval", async () => {
  const runtime = createRuntime();
  const send = vi.spyOn(runtime.sessions, "send");
  runtime.drafts.setText("thread", "waiting message");
  vi.spyOn(runtime.requests, "forThread").mockImplementation((id) =>
    id === "thread" ? [{} as RpcRequest] : [],
  );
  await expect(runtime.sendDraft("thread")).rejects.toThrow("确认请求");
  expect(send).not.toHaveBeenCalled();
  expect(runtime.drafts.get("thread").text).toBe("waiting message");
  expect(runtime.submissions.getSnapshot()).toEqual({});
});

it("serializes a single snapshot of text, skills and images", async () => {
  const runtime = createRuntime();
  const response = deferred();
  const send = vi
    .spyOn(runtime.sessions, "send")
    .mockReturnValue(response.promise);
  runtime.drafts.setText("thread", "$review message");
  runtime.drafts.addSkill("thread", { name: "review", path: "/skills/review" });
  runtime.drafts.addImage("thread", {
    id: "image",
    name: "image.png",
    url: "data:image/png;base64,test",
  });
  const pending = runtime.sendDraft("thread");
  runtime.drafts.setText("thread", "next");
  runtime.drafts.removeImage("thread", "image");
  expect(send.mock.calls[0][1]).toEqual([
    { type: "text", text: "$review message", text_elements: [] },
    { type: "skill", name: "review", path: "/skills/review" },
    { type: "image", url: "data:image/png;base64,test" },
  ]);
  response.resolve("thread");
  await pending;
  expect(runtime.drafts.get("thread").text).toBe("next");
});
