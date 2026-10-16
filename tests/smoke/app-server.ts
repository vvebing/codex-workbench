import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import type { SocketLike } from "../../src/lib/rpc";
import { ConnectionStore } from "../../src/features/connection/store";
import type { Thread } from "../../src/generated/v2/Thread";
import { readHistory } from "../../src/features/sessions/history";
import { createAgentObserver } from "../../src/features/conversation/agent-observer";

// Exercise the production RPC client against a real local app-server without
// inference. The adapter substitutes stdio for the browser relay transport.
const methods: string[] = [];
function stdioTransport(): SocketLike {
  const child = spawn("codex", ["app-server"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  const socket: SocketLike = {
    readyState: 0,
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send(data) {
      const message = JSON.parse(data) as { type?: string; method?: string };
      if (message.type === "connect") {
        queueMicrotask(() =>
          socket.onmessage?.({
            data: JSON.stringify({ type: "bridge/ready" }),
          } as MessageEvent),
        );
      } else {
        if (message.method) methods.push(message.method);
        child.stdin.write(`${data}\n`);
      }
    },
    close() {
      socket.readyState = 3;
      lines.close();
      child.stdin.end();
      child.kill();
    },
  };
  child.once("error", () => socket.onerror?.(new Event("error")));
  child.once("exit", () => {
    if (socket.readyState !== 3)
      socket.onclose?.({ reason: "Local app-server exited" } as CloseEvent);
  });
  lines.on("line", (data) => socket.onmessage?.({ data } as MessageEvent));
  queueMicrotask(() => {
    socket.readyState = 1;
    socket.onopen?.(new Event("open"));
  });
  return socket;
}
const connection = new ConnectionStore({
  bridgeUrl: "stdio-test",
  webSocketFactory: stdioTransport,
  requestTimeoutMs: 10000,
});
let unsubscribe = () => {};
try {
  await connection.connect("ws://127.0.0.1:1");
  const { thread } = await connection.client.request<{ thread: Thread }>(
    "thread/start",
    {
      ephemeral: true,
      sandbox: "read-only",
      approvalPolicy: "never",
      cwd: process.cwd(),
      config: { mcp_servers: {} },
    },
  );
  assert.equal(thread.ephemeral, true);
  const history = await readHistory(
    connection.client,
    thread.id,
    undefined,
    () => connection.getSnapshot().status === "connected",
  );
  assert.equal(history.id, thread.id);
  assert.equal(history.ephemeral, true);
  assert.deepEqual(history.turns, []);
  const observer = createAgentObserver(connection, thread.id);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Observer initialization timed out")),
      10000,
    );
    unsubscribe = observer.subscribe(() => {
      const state = observer.getSnapshot();
      if (state.error) {
        clearTimeout(timer);
        reject(new Error(state.error));
      } else if (state.thread && !state.loading) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  assert.equal(observer.getSnapshot().historyUnavailable, true);
  assert.equal(observer.getSnapshot().thread?.id, thread.id);
  assert(!methods.includes("thread/resume"));
  assert(!methods.includes("turn/start"));
  assert(!methods.includes("thread/turns/list"));
  const result = {
    cliVersion: execFileSync("codex", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim(),
    checks: {
      initialization: true,
      ephemeralMetadata: true,
      productionHistoryReader: true,
      productionObserver: true,
      ephemeralMetadataOnlyHistory: true,
      noInference: true,
      noExistingThreadResumed: true,
    },
    methods: [...new Set(methods)],
    limitation:
      "Ephemeral threads do not support includeTurns or persisted pagination; live notifications remain available when delivered by app-server.",
  };
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/app-server-smoke.json",
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  unsubscribe();
  connection.disconnect();
}
