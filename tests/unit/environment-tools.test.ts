import { describe, expect, it, vi } from "vitest";
import { ConnectionStore } from "../../src/features/connection/store";
import {
  EnvironmentToolsStore,
  safeAuthorizationUrl,
} from "../../src/features/settings/environment-tools-store";
import type { RpcNotification } from "../../src/lib/rpc";
function setup() {
  const connection = new ConnectionStore();
  const client = connection.client as unknown as {
    setStatus(status: string): void;
    notifications: Set<(event: RpcNotification) => void>;
  };
  client.setStatus("connected");
  const store = new EnvironmentToolsStore(connection, "/work");
  store.start();
  const request = vi.spyOn(connection.client, "request");
  return {
    connection,
    store,
    request,
    notify: (event: RpcNotification) =>
      client.notifications.forEach((callback) => callback(event)),
  };
}
describe("environment tools", () => {
  it("isolates optional feature failure and paginates MCP", async () => {
    const { store, request } = setup();
    request.mockRejectedValueOnce(Error("unsupported"));
    await store.load("apps");
    request
      .mockResolvedValueOnce({ data: [{ name: "first" }], nextCursor: "next" })
      .mockResolvedValueOnce({ data: [{ name: "second" }], nextCursor: null });
    await store.load("mcp");
    await store.load("mcp", true);
    expect(
      store.getSnapshot().mcp.data?.data.map((server) => server.name),
    ).toEqual(["first", "second"]);
    expect(store.getSnapshot().apps.error).toBe("unsupported");
    expect(request).toHaveBeenLastCalledWith(
      "mcpServerStatus/list",
      expect.objectContaining({ cursor: "next" }),
    );
    store.dispose();
  });
  it("ignores read responses after disconnect", async () => {
    const { store, connection, request } = setup();
    let resolve!: (value: unknown) => void;
    request.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const read = store.load("hooks");
    connection.disconnect();
    resolve({ data: [] });
    await read;
    expect(store.getSnapshot().hooks.data).toBeNull();
    store.dispose();
  });
  it("correlates OAuth completion and refreshes only the explicit login", async () => {
    const { store, request, notify } = setup();
    request.mockResolvedValueOnce({
      authorizationUrl: "https://example.com/oauth",
      loginId: "current",
    });
    await store.login("test");
    notify({
      method: "mcpServer/oauthLogin/completed",
      params: { name: "test", threadId: null, loginId: "old", success: true },
    });
    expect(store.getSnapshot().oauth?.loginId).toBe("current");
    request.mockResolvedValueOnce({ data: [], nextCursor: null });
    notify({
      method: "mcpServer/oauthLogin/completed",
      params: {
        name: "test",
        threadId: null,
        loginId: "current",
        success: true,
      },
    });
    await Promise.resolve();
    expect(store.getSnapshot().oauth).toBeNull();
    expect(store.getSnapshot().message).toBe("MCP 登录成功");
    store.dispose();
  });
  it("handles OAuth completion before the login response", async () => {
    const { store, request, notify } = setup();
    let resolve!: (value: unknown) => void;
    request
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce({ data: [], nextCursor: null });
    const pending = store.login("test");
    notify({
      method: "mcpServer/oauthLogin/completed",
      params: {
        name: "test",
        threadId: null,
        loginId: "current",
        success: true,
      },
    });
    resolve({
      authorizationUrl: "https://example.com/oauth",
      loginId: "current",
    });
    await pending;
    expect(store.getSnapshot().oauth).toBeNull();
    expect(store.getSnapshot().message).toBe("MCP 登录成功");
    store.dispose();
  });
  it("validates allowlisted config writes and absolute extra roots", async () => {
    const { store, request } = setup();
    await store.setRoots(["relative"]);
    expect(request).not.toHaveBeenCalled();
    await store.writeConfig("approval_policy", "invalid");
    expect(request).not.toHaveBeenCalled();
    request
      .mockResolvedValueOnce({ status: "ok", overriddenMetadata: null })
      .mockResolvedValueOnce({ config: {}, origins: {}, layers: null });
    await store.writeConfig("model", "model-1");
    expect(request).toHaveBeenCalledWith("config/value/write", {
      keyPath: "model",
      value: "model-1",
      mergeStrategy: "replace",
    });
    expect(request).toHaveBeenCalledTimes(1);
    store.dispose();
  });
  it("reads only the explicitly selected project directory", async () => {
    const { store, request } = setup();
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValueOnce({ config: {}, origins: {}, layers: null });
    await store.load("config");
    expect(request).toHaveBeenCalledWith("config/read", {
      cwd: "/work",
      includeLayers: false,
    });
    store.dispose();
  });
  it("refreshes skills on change and bounds startup notices", async () => {
    const { store, request, notify } = setup();
    request.mockResolvedValue({ data: [] });
    notify({ method: "skills/changed", params: {} });
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith("skills/list", {
      cwds: ["/work"],
      forceReload: true,
    });
    for (let i = 0; i < 12; i++)
      notify({
        method: "mcpServer/startupStatus/updated",
        params: {
          threadId: null,
          name: `server-${i}`,
          status: "ready",
          error: null,
          failureReason: null,
        },
      });
    expect(store.getSnapshot().startup).toHaveLength(10);
    store.dispose();
  });
  it("rejects executable and credential-bearing authorization URLs", () => {
    expect(safeAuthorizationUrl("javascript:alert(1)")).toBeNull();
    expect(safeAuthorizationUrl("https://secret@example.com/")).toBeNull();
    expect(safeAuthorizationUrl("https://example.com/oauth")).toBe(
      "https://example.com/oauth",
    );
  });
});

it("constructs without listeners and survives StrictMode cleanup/setup without leaking or applying old requests", async () => {
  const connection = new ConnectionStore();
  const client = connection.client as unknown as {
    setStatus(status: string): void;
    notifications: Set<(event: RpcNotification) => void>;
  };
  client.setStatus("connected");
  const baseline = client.notifications.size;
  const store = new EnvironmentToolsStore(connection);
  expect(client.notifications.size).toBe(baseline);
  store.start();
  expect(client.notifications.size).toBe(baseline + 1);
  let resolve!: (result: unknown) => void;
  const request = vi.spyOn(connection.client, "request").mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const old = store.load("apps");
  store.dispose();
  expect(client.notifications.size).toBe(baseline);
  store.start();
  request.mockResolvedValueOnce({ data: [], nextCursor: null });
  await store.load("apps");
  resolve({ data: [{ id: "stale" }], nextCursor: null });
  await old;
  expect(store.getSnapshot().apps.data?.data).toEqual([]);
  expect(store.getSnapshot().apps.busy).toBe(false);
  store.dispose();
  expect(client.notifications.size).toBe(baseline);
});
