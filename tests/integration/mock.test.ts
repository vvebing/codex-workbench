import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { WebSocket } from "ws";
import { createMockServer } from "../fixtures/app-server.js";
async function fixture(
  delay: number | ((method: string, id: string | number) => number) = 0,
) {
  const server = createMockServer({
    streamIntervalMs: 1,
    responseDelayMs: delay,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);
  await once(ws, "open");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Exercise runtime JSON-RPC envelopes including advertised protocol extensions.
  const messages: any[] = [];
  const waiters = new Set<() => void>();
  ws.on("message", (raw) => {
    messages.push(JSON.parse(raw.toString()));
    for (const wake of waiters) wake();
  });
  let serial = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Exercise runtime JSON-RPC envelopes including advertised protocol extensions.
  const wait = async (predicate: (msg: any) => boolean) => {
    const deadline = Date.now() + 4000;
    while (true) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0];
      if (Date.now() > deadline) throw Error("Message timed out");
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          waiters.delete(wake);
          resolve();
        };
        const timer = setTimeout(wake, 20);
        waiters.add(wake);
      });
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Exercise runtime JSON-RPC envelopes including advertised protocol extensions.
  const call = async (method: string, params: any = {}) => {
    const id = ++serial;
    ws.send(JSON.stringify({ id, method, params }));
    return wait((msg) => msg.id === id);
  };
  const init = async () => {
    assert.ok(
      (
        await call("initialize", {
          clientInfo: { name: "mock-test", version: "1" },
        })
      ).result,
    );
    ws.send(JSON.stringify({ method: "initialized" }));
  };
  const close = async () => {
    ws.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { ws, call, wait, init, close };
}
test("requires handshake, pages all 90 fictional threads with cwd filtering", async () => {
  const f = await fixture();
  try {
    assert.ok((await f.call("thread/list")).error);
    await f.init();
    const seen = new Set<string>();
    let cursor: null | string = null;
    do {
      const response = await f.call("thread/list", { limit: 13, cursor });
      for (const t of response.result.data) {
        assert.equal(t.turns.length, 0);
        assert.ok(!seen.has(t.id));
        seen.add(t.id);
      }
      cursor = response.result.nextCursor;
    } while (cursor);
    assert.equal(seen.size, 90);
    const filtered = await f.call("thread/list", {
      cwd: "/demo/design-system",
      limit: 100,
    });
    assert.equal(filtered.result.data.length, 30);
    assert.ok(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Exercise runtime JSON-RPC envelopes including advertised protocol extensions.
      filtered.result.data.every((t: any) => t.cwd === "/demo/design-system"),
    );
  } finally {
    await f.close();
  }
});
test("resume, rename, fork through selected turn, archive and full streaming", async () => {
  const f = await fixture();
  try {
    await f.init();
    const t = (await f.call("thread/resume", { threadId: "mock-thread-001" }))
      .result.thread;
    assert.equal(t.turns.length, 2);
    await f.call("thread/name/set", { threadId: t.id, name: "自定义标题" });
    const fork = (
      await f.call("thread/fork", { threadId: t.id, lastTurnId: t.turns[0].id })
    ).result.thread;
    assert.equal(fork.turns.length, 1);
    assert.equal(fork.forkedFromId, t.id);
    await f.call("thread/archive", { threadId: fork.id });
    assert.ok(
      (await f.call("thread/list", { archived: true })).result.data.some(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Exercise runtime JSON-RPC envelopes including advertised protocol extensions.
        (x: any) => x.id === fork.id,
      ),
    );
    const started = await f.call("turn/start", {
      threadId: t.id,
      input: [{ type: "text", text: "实施修改", text_elements: [] }],
    });
    const completed = await f.wait(
      (x) =>
        x.method === "turn/completed" &&
        x.params.turn.id === started.result.turn.id,
    );
    assert.equal(completed.params.turn.status, "completed");
    assert.ok(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Exercise runtime JSON-RPC envelopes including advertised protocol extensions.
      completed.params.turn.items.some((x: any) => x.type === "fileChange"),
    );
    assert.ok(
      completed.params.turn.items.some(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Exercise runtime JSON-RPC envelopes including advertised protocol extensions.
        (x: any) => x.type === "agentMessage" && x.text.includes("| 检查项 |"),
      ),
    );
  } finally {
    await f.close();
  }
});
test("approval validates offered decisions; user question includes custom and secret answers", async () => {
  const f = await fixture();
  try {
    await f.init();
    await f.call("turn/start", {
      threadId: "mock-thread-001",
      input: [{ type: "text", text: "审批" }],
    });
    const approval = await f.wait(
      (x) => x.id && x.method === "item/commandExecution/requestApproval",
    );
    assert.deepEqual(approval.params.availableDecisions, [
      "accept",
      "decline",
      "cancel",
    ]);
    f.ws.send(
      JSON.stringify({
        id: approval.id,
        result: { decision: "acceptForSession" },
      }),
    );
    assert.ok((await f.wait((x) => x.id === approval.id)).error);
    f.ws.send(
      JSON.stringify({ id: approval.id, result: { decision: "accept" } }),
    );
    await f.wait((x) => x.method === "turn/completed");
    await f.call("turn/start", {
      threadId: "mock-thread-001",
      input: [{ type: "text", text: "问题" }],
    });
    const question = await f.wait(
      (x) => x.method === "item/tool/requestUserInput",
    );
    assert.ok(question.params.questions[0].isOther);
    assert.ok(question.params.questions[1].isSecret);
    f.ws.send(
      JSON.stringify({
        id: question.id,
        result: {
          answers: {
            layout: { answers: ["自定义"] },
            demoSecret: { answers: ["fictional"] },
          },
        },
      }),
    );
    await f.wait((x) => x.method === "turn/completed");
  } finally {
    await f.close();
  }
});
test("steer and interrupt, simulated failure and disconnect", async () => {
  const f = await fixture();
  try {
    await f.init();
    const start = await f.call("turn/start", {
      threadId: "mock-thread-002",
      input: [{ type: "text", text: "慢" }],
    });
    assert.equal(
      (
        await f.call("turn/steer", {
          threadId: "mock-thread-002",
          expectedTurnId: start.result.turn.id,
          input: [{ type: "text", text: "补充" }],
        })
      ).result.turnId,
      start.result.turn.id,
    );
    await f.call("turn/interrupt", {
      threadId: "mock-thread-002",
      turnId: start.result.turn.id,
    });
    assert.equal(
      (await f.wait((x) => x.method === "turn/completed")).params.turn.status,
      "interrupted",
    );
    await f.call("turn/start", {
      threadId: "mock-thread-002",
      input: [{ type: "text", text: "失败" }],
    });
    assert.equal(
      (await f.wait((x) => x.method === "turn/completed")).params.turn.status,
      "failed",
    );
    const closed = once(f.ws, "close");
    await f.call("turn/start", {
      threadId: "mock-thread-002",
      input: [{ type: "text", text: "断线" }],
    });
    assert.equal((await closed)[0], 1011);
  } finally {
    await f.close();
  }
});
test("responses can arrive out of request order", async () => {
  const f = await fixture((method) => (method === "model/list" ? 60 : 0));
  try {
    await f.init();
    const arrival: string[] = [];
    await Promise.all([
      f.call("model/list").then((x) => {
        arrival.push("model");
        assert.ok(x.result.data.length);
      }),
      f.call("account/read").then((x) => {
        arrival.push("account");
        assert.equal(x.result.account.email, "demo@example.invalid");
      }),
    ]);
    assert.deepEqual(arrival, ["account", "model"]);
  } finally {
    await f.close();
  }
});
