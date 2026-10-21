import { afterEach, expect, it, vi } from "vitest";
import { createRuntime } from "../../src/lib/runtime";
import { TurnBusyError } from "../../src/features/sessions/store";
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
  expect(runtime.drafts.get("thread").text).toBe("");
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
  expect(runtime.drafts.get("thread").text).toBe("");
  next.resolve("thread");
  await second;
  expect(runtime.drafts.get("thread").text).toBe("");
  expect(runtime.submissions.isSending("thread")).toBe(false);
});

it("keeps failed content in its delivery record and preserves the next draft", async () => {
  const runtime = createRuntime();
  const response = deferred();
  const send = vi
    .spyOn(runtime.sessions, "send")
    .mockReturnValue(response.promise);
  runtime.drafts.setText("thread", "keep me");
  const pending = runtime.sendDraft("thread");
  expect(runtime.drafts.get("thread").text).toBe("");
  runtime.drafts.setText("thread", "next draft");
  response.reject(new Error("writer occupied"));
  await expect(pending).rejects.toThrow("writer occupied");
  expect(runtime.submissions.isSending("thread")).toBe(false);
  expect(runtime.drafts.get("thread").text).toBe("next draft");
  const [message] = runtime.submissions.messages.forThread("thread");
  expect(message.status).toBe("uncertain");
  expect(message.input).toEqual([
    { type: "text", text: "keep me", text_elements: [] },
  ]);
  expect(send).toHaveBeenCalledTimes(1);
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

it("renders a local delivery record immediately and sends its correlation ID", async () => {
  const runtime = createRuntime();
  const response = deferred();
  const send = vi
    .spyOn(runtime.sessions, "send")
    .mockReturnValue(response.promise);
  runtime.drafts.setText("thread", "hello");
  const pending = runtime.sendDraft("thread");
  const [local] = runtime.submissions.messages.forThread("thread");
  expect(local.status).toBe("sending");
  expect(send.mock.calls[0][2]?.clientUserMessageId).toBe(local.id);
  response.resolve("thread");
  await pending;
  expect(runtime.submissions.messages.forThread("thread")[0].status).toBe(
    "accepted",
  );
});

it("keeps uncertain delivery visible across disconnect without replaying it", async () => {
  const runtime = createRuntime();
  const response = deferred();
  const send = vi
    .spyOn(runtime.sessions, "send")
    .mockReturnValue(response.promise);
  runtime.drafts.setText("thread", "hello");
  const pending = runtime.sendDraft("thread");
  runtime.connection.disconnect();
  expect(runtime.submissions.messages.forThread("thread")[0].status).toBe(
    "uncertain",
  );
  response.resolve("thread");
  await pending;
  expect(runtime.submissions.messages.forThread("thread")[0].status).toBe(
    "uncertain",
  );
  expect(send).toHaveBeenCalledTimes(1);
});

it("clears delivery records when connection scope changes after its epoch already changed", async () => {
  const runtime = createRuntime();
  const response = deferred();
  vi.spyOn(runtime.sessions, "send").mockReturnValue(response.promise);
  vi.spyOn(runtime.connection.client, "connect").mockRejectedValue(
    new Error("offline"),
  );
  runtime.drafts.setText("thread", "old server message");
  const pending = runtime.sendDraft("thread");
  await expect(
    runtime.connection.connect("ws://other.example/bridge"),
  ).rejects.toThrow("offline");
  expect(runtime.submissions.messages.getSnapshot()).toEqual([]);
  response.resolve("thread");
  await pending;
  expect(runtime.submissions.messages.getSnapshot()).toEqual([]);
});

it("locks submission before clearing the editor notifies draft subscribers", async () => {
  const runtime = createRuntime();
  const response = deferred();
  const send = vi
    .spyOn(runtime.sessions, "send")
    .mockReturnValue(response.promise);
  runtime.drafts.setText("thread", "submitted");
  const reentrant: Promise<void>[] = [];
  const unsubscribe = runtime.drafts.subscribe(() => {
    reentrant.push(runtime.sendDraft("thread"));
  });
  const pending = runtime.sendDraft("thread");
  unsubscribe();
  expect(reentrant).toEqual([pending]);
  expect(send).toHaveBeenCalledTimes(1);
  response.resolve("thread");
  await pending;
});

it("restores failed rich content and attachments alongside a newer draft without sending", async () => {
  const runtime = createRuntime();
  const response = deferred();
  const send = vi
    .spyOn(runtime.sessions, "send")
    .mockReturnValue(response.promise);
  runtime.drafts.setText("thread", "submitted");
  runtime.drafts.addApp("thread", { id: "notes", name: "Notes" });
  runtime.drafts.addImage("thread", {
    id: "img",
    name: "image.png",
    url: "data:image/png;base64,test",
  });
  const original = runtime.drafts.get("thread");
  const pending = runtime.sendDraft("thread");
  expect(runtime.drafts.get("thread").images).toEqual([]);
  runtime.drafts.setText("thread", "next draft");
  response.reject(new Error("offline"));
  await expect(pending).rejects.toThrow("offline");
  const [message] = runtime.submissions.messages.forThread("thread");
  runtime.submissions.restoreMessage(message.id);
  const restored = runtime.drafts.get("thread");
  expect(restored.text).toBe(original.text + "\n\nnext draft");
  expect(restored.document?.content).toEqual(
    expect.arrayContaining(original.document!.content!),
  );
  expect(restored.images).toEqual(original.images);
  expect(restored.restored?.preserved).toBe(true);
  expect(runtime.submissions.messages.forThread("thread")).toEqual([]);
  expect(send).toHaveBeenCalledTimes(1);
});

it("retains a recoverable record if a busy-turn fallback cannot enter the queue", async () => {
  const runtime = createRuntime();
  vi.spyOn(runtime.sessions, "send").mockRejectedValue(new TurnBusyError());
  const queueing = deferred();
  vi.spyOn(runtime.queue, "add").mockReturnValue(
    queueing.promise.then(() => {}),
  );
  runtime.drafts.setText("thread", "submitted");
  const pending = runtime.sendDraft("thread");
  expect(runtime.drafts.get("thread").text).toBe("");
  await vi.waitFor(() => expect(runtime.queue.add).toHaveBeenCalledOnce());
  runtime.drafts.setText("thread", "next draft");
  queueing.reject(new Error("queue storage failed"));
  await expect(pending).rejects.toThrow("queue storage failed");
  expect(runtime.submissions.messages.forThread("thread")[0].draft?.text).toBe(
    "submitted",
  );
  expect(runtime.drafts.get("thread").text).toBe("next draft");
});
