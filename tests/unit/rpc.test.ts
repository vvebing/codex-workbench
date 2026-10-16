import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexClient, RpcError, type SocketLike } from "../../src/lib/rpc";

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onerror: SocketLike["onerror"] = null;
  onclose: SocketLike["onclose"] = null;
  sent: Record<string, unknown>[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  receive(message: unknown) {
    this.raw(JSON.stringify(message));
  }
  raw(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }
}
const clients: CodexClient[] = [];
function setup() {
  const sockets: FakeSocket[] = [];
  const client = new CodexClient({
    bridgeUrl: "ws://localhost:3000/bridge",
    connectTimeoutMs: 100,
    requestTimeoutMs: 200,
    webSocketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  clients.push(client);
  const connection = client.connect("ws://127.0.0.1:4500", "secret");
  const socket = sockets[0]!;
  const ready = async () => {
    socket.open();
    socket.receive({ type: "bridge/ready" });
    socket.receive({ id: socket.sent[1]!.id, result: { userAgent: "codex" } });
    await connection;
  };
  return { client, socket, sockets, connection, ready };
}
afterEach(() => {
  clients.splice(0).forEach((client) => client.disconnect());
  vi.useRealTimers();
});

describe("CodexClient", () => {
  it("waits for bridge and initialize response before initialized and application requests", async () => {
    const { client, socket, connection } = setup();
    const statuses: string[] = [];
    client.onStatus((status) => statuses.push(status));
    socket.open();
    expect(socket.sent).toEqual([
      { type: "connect", url: "ws://127.0.0.1:4500/", token: "secret" },
    ]);
    await expect(client.request("thread/list")).rejects.toThrow(
      "Not connected",
    );
    socket.receive({ type: "bridge/ready" });
    expect(socket.sent[1]).toMatchObject({ id: 1, method: "initialize" });
    expect(socket.sent).toHaveLength(2);
    socket.receive({ type: "bridge/ready" });
    expect(socket.sent).toHaveLength(2);
    socket.receive({ id: 1, result: {} });
    await connection;
    expect(socket.sent[2]).toEqual({ method: "initialized", params: {} });
    expect(statuses).toEqual(["connected"]);
  });

  it("correlates out-of-order responses and preserves RPC error code and data", async () => {
    const { client, socket, ready } = setup();
    await ready();
    const first = client.request<{ value: number }>("thread/list");
    const second = client.request("turn/start", { threadId: "t" });
    const rejected = expect(second).rejects.toMatchObject({
      code: -32001,
      data: { retry: true },
    });
    socket.receive({
      id: 3,
      error: { code: -32001, message: "overloaded", data: { retry: true } },
    });
    socket.receive({ id: 2, result: { value: 42 } });
    await expect(first).resolves.toEqual({ value: 42 });
    await rejected;
    expect(socket.sent.filter((m) => m.method === "turn/start")).toHaveLength(
      1,
    );
    expect(new RpcError("error")).toBeInstanceOf(Error);
  });

  it("delivers notifications and bidirectional requests even with colliding IDs", async () => {
    const { client, socket, ready } = setup();
    await ready();
    const notify = vi.fn();
    const request = vi.fn();
    const unsubscribe = client.onNotification(notify);
    client.onRequest(request);
    const pending = client.request("thread/list");
    socket.receive({
      id: 2,
      method: "item/fileChange/requestApproval",
      params: { threadId: "t" },
    });
    expect(request).toHaveBeenCalledOnce();
    client.respond(2, { decision: "decline" });
    expect(socket.sent.at(-1)).toEqual({
      id: 2,
      result: { decision: "decline" },
    });
    socket.receive({
      method: "item/agentMessage/delta",
      params: { delta: "hi" },
    });
    expect(notify).toHaveBeenCalledOnce();
    unsubscribe();
    socket.receive({
      method: "item/agentMessage/delta",
      params: { delta: "bye" },
    });
    expect(notify).toHaveBeenCalledOnce();
    socket.receive({ id: 2, result: {} });
    await pending;
  });

  it("rejects all pending calls on disconnect without replaying them after reconnect", async () => {
    const { client, socket, sockets, ready } = setup();
    await ready();
    const pending = client.request("turn/start");
    const rejected = expect(pending).rejects.toThrow("Disconnected");
    client.disconnect();
    await rejected;
    expect(socket.readyState).toBe(3);
    expect(client.status).toBe("disconnected");
    const reconnect = client.connect("ws://127.0.0.1:4500");
    const next = sockets[1]!;
    next.open();
    next.receive({ type: "bridge/ready" });
    expect(next.sent[1]!.id).toBe(3);
    next.receive({ id: 3, result: {} });
    await reconnect;
    expect(next.sent.some((m) => m.method === "turn/start")).toBe(false);
  });

  it("times out calls and ignores late responses without retries", async () => {
    vi.useFakeTimers();
    const { client, socket, ready } = setup();
    await ready();
    const pending = client.request("turn/start");
    const rejected = expect(pending).rejects.toThrow("outcome is unknown");
    await vi.advanceTimersByTimeAsync(200);
    await rejected;
    socket.receive({ id: 2, result: {} });
    expect(client.status).toBe("connected");
    expect(socket.sent.filter((m) => m.method === "turn/start")).toHaveLength(
      1,
    );
  });

  it("bounds the entire connection handshake", async () => {
    vi.useFakeTimers();
    const { client, connection } = setup();
    const rejected = expect(connection).rejects.toThrow("Connection timed out");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(client.status).toBe("disconnected");
  });

  it("surfaces bridge failures and invalid frames", async () => {
    const { client, socket, connection } = setup();
    const rejected = expect(connection).rejects.toThrow("upstream refused");
    socket.open();
    socket.receive({ type: "bridge/error", message: "upstream refused" });
    await rejected;
    expect(client.status).toBe("disconnected");
    const other = setup();
    await other.ready();
    const pending = other.client.request("thread/list");
    const bad = expect(pending).rejects.toThrow("Invalid JSON");
    other.socket.raw("{broken");
    await bad;
    expect(other.client.status).toBe("disconnected");
  });

  it("does not let failed initialization from an old socket close a replacement socket", async () => {
    const { client, socket, sockets, connection } = setup();
    const oldRejected = expect(connection).rejects.toThrow("Disconnected");
    socket.open();
    socket.receive({ type: "bridge/ready" });
    const replacement = client.connect("ws://127.0.0.1:4501");
    const next = sockets[1]!;
    next.open();
    next.receive({ type: "bridge/ready" });
    next.receive({ id: next.sent[1]!.id, result: {} });
    await oldRejected;
    await replacement;
    expect(client.status).toBe("connected");
  });
});
