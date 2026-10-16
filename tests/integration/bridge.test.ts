import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { request } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { createWorkbenchServer } from "../../server/http.js";

async function fixture(
  options: Parameters<typeof createWorkbenchServer>[0] = {},
) {
  const bridge = createWorkbenchServer(options);
  bridge.listen(0, "127.0.0.1");
  await once(bridge, "listening");
  const address = bridge.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    bridge,
    origin,
    url: `ws://127.0.0.1:${address.port}/bridge`,
    close: () => new Promise<void>((resolve) => bridge.close(() => resolve())),
  };
}
function nextMessage(ws: WebSocket) {
  return once(ws, "message").then(([data]) => data.toString());
}

test("relay strips Origin, authenticates upstream, and preserves bidirectional RPC frames", async () => {
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(upstream, "listening");
  const address = upstream.address();
  assert.ok(address && typeof address === "object");
  const relay = await fixture();
  const client = new WebSocket(relay.url, { origin: relay.origin });
  try {
    await once(client, "open");
    const accepted = once(upstream, "connection");
    const ready = nextMessage(client);
    client.send(
      JSON.stringify({
        type: "connect",
        url: `ws://127.0.0.1:${address.port}`,
        token: "test-secret",
      }),
    );
    const [remote, req] = await accepted;
    assert.equal(req.headers.origin, undefined);
    assert.equal(req.headers.authorization, "Bearer test-secret");
    assert.deepEqual(JSON.parse(await ready), { type: "bridge/ready" });
    const request =
      '{ "id":17, "method":"turn/start", "params":{"threadId":"t"} }';
    const received = nextMessage(remote);
    client.send(request);
    assert.equal(await received, request);
    const approval =
      '{"id":"approve-1","method":"item/commandExecution/requestApproval","params":{}}';
    const response = nextMessage(client);
    remote.send(approval);
    assert.equal(await response, approval);
    const reply = nextMessage(remote);
    client.send('{"id":"approve-1","result":{"decision":"decline"}}');
    assert.equal(
      await reply,
      '{"id":"approve-1","result":{"decision":"decline"}}',
    );
    const disconnected = nextMessage(client);
    remote.close();
    assert.equal(JSON.parse(await disconnected).type, "bridge/error");
  } finally {
    client.terminate();
    await relay.close();
    for (const remote of upstream.clients) remote.terminate();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test("rejects missing/foreign Origin and forged Host before opening relay", async () => {
  const relay = await fixture();
  try {
    for (const headers of [
      {},
      { Origin: "https://evil.example" },
      { Origin: relay.origin, Host: "evil.example" },
    ]) {
      const client = new WebSocket(relay.url, { headers });
      const error = await new Promise<Error>((resolve) =>
        client.on("error", resolve),
      );
      assert.match(error.message, /403/);
      client.terminate();
    }
  } finally {
    await relay.close();
  }
});

test("rejects invalid upstream configuration without exposing credentials", async () => {
  const relay = await fixture();
  try {
    const client = new WebSocket(relay.url, { origin: relay.origin });
    await once(client, "open");
    const message = nextMessage(client);
    client.send(
      JSON.stringify({
        type: "connect",
        url: "https://example.com",
        token: "never-echo",
      }),
    );
    const error = JSON.parse(await message);
    assert.equal(error.type, "bridge/error");
    assert.match(error.message, /ws:\/\//);
    assert.ok(!error.message.includes("never-echo"));
    client.terminate();
  } finally {
    await relay.close();
  }
});

test("serves built UI and refuses HTTP DNS rebinding host", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-web-bridge-"));
  await writeFile(join(directory, "index.html"), "<main>Codex</main>");
  await mkdir(join(directory, "assets"));
  await writeFile(join(directory, "assets/app-Abcd1234.js"), "export {};");
  const relay = await fixture({ staticDir: directory });
  try {
    const response = await fetch(`${relay.origin}/thread/example`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(
      response.headers.get("content-security-policy"),
      "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
    );
    assert.equal(
      response.headers.get("cross-origin-resource-policy"),
      "same-origin",
    );
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.equal(await response.text(), "<main>Codex</main>");
    const asset = await fetch(`${relay.origin}/assets/app-Abcd1234.js`);
    assert.equal(
      asset.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
    assert.equal(await asset.text(), "export {};");
    assert.equal((await fetch(`${relay.origin}/missing.js`)).status, 404);
    const rejected = await new Promise<number | undefined>(
      (resolve, reject) => {
        const req = request(
          relay.origin,
          { headers: { Host: "evil.example" } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    assert.equal(rejected, 403);
  } finally {
    await relay.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects unknown WebSocket endpoints without leaving connections open", async () => {
  const relay = await fixture();
  try {
    for (const endpoint of ["/environment-control", "/unknown"]) {
      const client = new WebSocket(relay.url.replace("/bridge", endpoint), {
        origin: relay.origin,
      });
      try {
        const [error] = await once(client, "error", {
          signal: AbortSignal.timeout(1000),
        });
        assert.match(error.message, /404/);
      } finally {
        client.terminate();
      }
    }
  } finally {
    await relay.close();
  }
});

test("terminal output endpoint returns process output without caching or accepting foreign hosts", async () => {
  const snapshot = {
    status: "running" as const,
    output: "$ codex app-server\nready\n",
  };
  const relay = await fixture({ appServerOutput: () => snapshot });
  try {
    const response = await fetch(`${relay.origin}/app-server-output`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), snapshot);
    await new Promise<void>((resolve, reject) => {
      const req = request(
        `${relay.origin}/app-server-output`,
        { headers: { Host: "foreign.example" } },
        (res) => {
          assert.equal(res.statusCode, 403);
          res.resume();
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end();
    });
  } finally {
    await relay.close();
  }
});
