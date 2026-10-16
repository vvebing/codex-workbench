import { afterEach, expect, it, vi } from "vitest";
import { createRuntime } from "../../src/lib/runtime";
import { CodexClient, RpcError, type RpcNotification } from "../../src/lib/rpc";
import { placeholderThread } from "../../src/lib/state";
import type { Thread } from "../../src/generated/v2/Thread";
import type { Turn } from "../../src/generated/v2/Turn";
import { emptyDraft } from "../../src/features/composer/drafts";
import { draftInput } from "../../src/features/composer/submission";

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((close) => close());
  vi.restoreAllMocks();
});
const turn = (id: string, status: Turn["status"] = "inProgress"): Turn => ({
  id,
  rootTurnId: null,
  items: [],
  itemsView: "full",
  status,
  error: null,
  startedAt: 1,
  completedAt: status === "inProgress" ? null : 2,
  durationMs: null,
});
async function fixture() {
  const listeners: ((event: RpcNotification) => void)[] = [];
  vi.spyOn(CodexClient.prototype, "onNotification").mockImplementation(
    (listener) => {
      listeners.push(listener);
      return () => {};
    },
  );
  const runtime = createRuntime();
  cleanup.push(() => runtime.connection.disconnect());
  const snapshot = runtime.connection.getSnapshot();
  let epoch = snapshot.epoch;
  vi.spyOn(runtime.connection, "getSnapshot").mockImplementation(() => ({
    ...snapshot,
    epoch,
    status: "connected",
  }));
  const current: Thread = {
    ...placeholderThread("a"),
    cwd: "/test",
    status: { type: "active", activeFlags: [] },
    turns: [turn("working")],
  };
  let nextTurn = 0;
  const request = vi
    .spyOn(runtime.connection.client, "request")
    .mockImplementation((async (method: string) => {
      if (method === "thread/resume" || method === "thread/read")
        return { thread: current };
      if (method === "turn/start") return { turn: turn(`next-${++nextTurn}`) };
      return {};
    }) as never);
  await runtime.sessions.activate("a");
  request.mockClear();
  const notify = (event: RpcNotification) =>
    listeners.forEach((listener) => listener(event));
  const complete = (id = "working", status: Turn["status"] = "completed") => {
    notify({
      method: "turn/completed",
      params: { threadId: "a", turn: turn(id, status) },
    });
    notify({
      method: "thread/status/changed",
      params: { threadId: "a", status: { type: "idle" } },
    });
  };
  const add = async (text: string) => {
    runtime.drafts.setText("a", text);
    await runtime.sendDraft("a", {
      model: "queued-model",
      effort: "high",
      approvalPolicy: "never",
    });
    return runtime.queue.forThread("a").items.at(-1)!;
  };
  return {
    runtime,
    request,
    add,
    complete,
    notify,
    changeEpoch: () => epoch++,
  };
}

it("queues complete snapshots and consumes one turn at a time in the chosen order", async () => {
  const { runtime, request, add, complete } = await fixture();
  runtime.drafts.addImage("a", {
    id: "image",
    name: "test.png",
    url: "data:image/png;base64,test",
  });
  const first = await add("first");
  await add("second");
  const third = await add("third");
  expect(runtime.drafts.get("a").text).toBe("");
  expect(runtime.drafts.get("a").images).toEqual([]);
  expect(first.input).toContainEqual({
    type: "image",
    url: "data:image/png;base64,test",
  });
  expect(
    request.mock.calls.filter(([method]) => method.startsWith("turn/")),
  ).toHaveLength(0);
  await runtime.queue.moveFirst("a", third.id);
  expect(
    runtime.queue.forThread("a").items.map((task) => task.draft.text),
  ).toEqual(["third", "first", "second"]);
  complete();
  await vi.waitFor(() =>
    expect(runtime.queue.forThread("a").items).toHaveLength(2),
  );
  expect(request).toHaveBeenCalledWith("turn/start", {
    threadId: "a",
    model: "queued-model",
    effort: "high",
    approvalPolicy: "never",
    input: third.input,
  });
  expect(
    request.mock.calls.filter(([method]) => method === "turn/start"),
  ).toHaveLength(1);
  complete("next-1");
  await vi.waitFor(() =>
    expect(runtime.queue.forThread("a").items).toHaveLength(1),
  );
  expect(
    request.mock.calls
      .filter(([method]) => method === "turn/start")
      .at(-1)?.[1],
  ).toMatchObject({ input: first.input });
});

it("edits in place without overwriting a separate composer draft and blocks dispatch while editing", async () => {
  const { runtime, request, add, complete } = await fixture();
  const task = await add("original");
  runtime.drafts.setText("a", "keep composer");
  await runtime.queue.beginEdit("a", task.id);
  complete();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(
    request.mock.calls.filter(([method]) => method === "turn/start"),
  ).toHaveLength(0);
  const draft = { ...emptyDraft(), text: "edited" };
  await runtime.queue.finishEdit("a", task.id, draft, draftInput(draft));
  await vi.waitFor(() =>
    expect(runtime.queue.forThread("a").items).toHaveLength(0),
  );
  expect(runtime.drafts.get("a").text).toBe("keep composer");
  expect(request).toHaveBeenCalledWith(
    "turn/start",
    expect.objectContaining({ input: draftInput(draft) }),
  );
});

it("explicit steering changes the active turn and leaves other queued tasks intact", async () => {
  const { runtime, request, add } = await fixture();
  const first = await add("first");
  const second = await add("second");
  await runtime.queue.steer("a", second.id);
  expect(request).toHaveBeenCalledWith("turn/steer", {
    threadId: "a",
    expectedTurnId: "working",
    input: second.input,
  });
  expect(runtime.queue.forThread("a").items.map((task) => task.id)).toEqual([
    first.id,
  ]);
  runtime.drafts.setText("a", "shortcut guidance");
  await runtime.sendDraft("a", {}, "steer");
  expect(request).toHaveBeenLastCalledWith(
    "turn/steer",
    expect.objectContaining({ expectedTurnId: "working" }),
  );
  expect(runtime.queue.forThread("a").items).toHaveLength(1);
});

it("does not steer a replacement turn when the captured active turn has finished", async () => {
  const { runtime, request, add, complete, notify } = await fixture();
  const task = await add("keep queued");
  await runtime.queue.pause("a");
  const steering = runtime.queue.steer("a", task.id);
  complete();
  notify({
    method: "turn/started",
    params: { threadId: "a", turn: turn("replacement") },
  });
  await steering;
  expect(
    request.mock.calls.filter(([method]) => method === "turn/steer"),
  ).toHaveLength(0);
  expect(runtime.queue.forThread("a").items).toHaveLength(1);
});

it("pauses on interruption and failure; only an explicit resume restarts queued work", async () => {
  const { runtime, request, add, complete } = await fixture();
  await add("next");
  complete("working", "interrupted");
  await vi.waitFor(() =>
    expect(runtime.queue.forThread("a").paused).toBeTruthy(),
  );
  expect(
    request.mock.calls.filter(([method]) => method === "turn/start"),
  ).toHaveLength(0);
  await runtime.queue.resume("a");
  await vi.waitFor(() =>
    expect(runtime.queue.forThread("a").items).toHaveLength(0),
  );
});

it("retains uncertain writes and refuses implicit retries", async () => {
  const { runtime, request, add, complete } = await fixture();
  const task = await add("possibly accepted");
  request.mockImplementation((async (method: string) => {
    if (method === "turn/start") throw new Error("Request timed out");
    return {};
  }) as never);
  complete();
  await vi.waitFor(() =>
    expect(runtime.queue.forThread("a").items[0].status).toBe("uncertain"),
  );
  await expect(runtime.queue.resume("a")).rejects.toThrow("核实");
  expect(
    request.mock.calls.filter(([method]) => method === "turn/start"),
  ).toHaveLength(1);
  await runtime.queue.retry("a", task.id);
  expect(runtime.queue.forThread("a").items[0].status).toBe("queued");
  expect(runtime.queue.forThread("a").paused).toBeTruthy();
});

it("a definite RPC rejection remains queued and paused rather than losing the task", async () => {
  const { runtime, request, add, complete } = await fixture();
  await add("rejected");
  request.mockImplementation((async (method: string) => {
    if (method === "turn/start")
      throw new RpcError("writer is occupied", -32600);
    return {};
  }) as never);
  complete();
  await vi.waitFor(() =>
    expect(runtime.queue.forThread("a").paused).toContain("occupied"),
  );
  expect(runtime.queue.forThread("a").items[0].status).toBe("queued");
});

it("does not dispatch while confirmation requests are pending", async () => {
  const { runtime, request, add, complete } = await fixture();
  await add("waiting");
  vi.spyOn(runtime.requests, "forThread").mockReturnValue([{} as never]);
  complete();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(
    request.mock.calls.filter(([method]) => method === "turn/start"),
  ).toHaveLength(0);
  await runtime.queue.remove("a", runtime.queue.forThread("a").items[0].id);
  expect(runtime.queue.forThread("a").items).toEqual([]);
});

it("a turn completing before acknowledgement cannot cause the next task to be skipped", async () => {
  const { runtime, request, add, complete } = await fixture();
  await add("first");
  await add("second");
  let resolve!: (value: { turn: Turn }) => void;
  const acknowledgement = new Promise<{ turn: Turn }>((done) => {
    resolve = done;
  });
  request.mockImplementation((async (method: string) => {
    if (method === "turn/start") return acknowledgement;
    return {};
  }) as never);
  complete();
  await vi.waitFor(() =>
    expect(runtime.queue.forThread("a").items[0].status).toBe("sending"),
  );
  complete("quick-turn");
  request.mockImplementation((async (method: string) => {
    if (method === "turn/start") return { turn: turn("second-turn") };
    return {};
  }) as never);
  resolve({ turn: turn("quick-turn", "completed") });
  await vi.waitFor(() =>
    expect(runtime.queue.forThread("a").items).toHaveLength(0),
  );
  expect(
    request.mock.calls.filter(([method]) => method === "turn/start"),
  ).toHaveLength(2);
});

it("a connection change after acceptance preserves the task as uncertain", async () => {
  const { runtime, request, add, complete, changeEpoch } = await fixture();
  await add("uncertain after reconnect");
  request.mockImplementation((async (method: string) => {
    if (method === "turn/start") {
      changeEpoch();
      return { turn: turn("accepted") };
    }
    return {};
  }) as never);
  complete();
  await vi.waitFor(() =>
    expect(runtime.queue.forThread("a").items[0].status).toBe("uncertain"),
  );
  expect(runtime.queue.forThread("a").paused).toContain("核实");
});

it("an occupied writer cannot enqueue a task or clear its composer draft", async () => {
  const { runtime, request, notify } = await fixture();
  notify({ method: "thread/closed", params: { threadId: "a" } });
  request.mockImplementation((async (method: string) => {
    if (method === "thread/resume")
      throw new RpcError("thread a already has an active writer", -32600);
    return {};
  }) as never);
  runtime.drafts.setText("a", "keep this draft");
  await expect(runtime.sendDraft("a")).rejects.toThrow("其他客户端控制");
  expect(runtime.queue.forThread("a").items).toHaveLength(0);
  expect(runtime.drafts.get("a").text).toBe("keep this draft");
  expect(
    request.mock.calls.filter(([method]) => method.startsWith("turn/")),
  ).toHaveLength(0);
});
