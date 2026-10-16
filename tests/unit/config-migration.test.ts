import { describe, expect, it, vi } from "vitest";
import { ConnectionStore } from "../../src/features/connection/store";
import { ConfigMigrationStore } from "../../src/features/settings/config-migration-store";
import type { RpcNotification } from "../../src/lib/rpc";
function setup() {
  const connection = new ConnectionStore();
  const client = connection.client as unknown as {
    setStatus(status: string): void;
    notifications: Set<(event: RpcNotification) => void>;
  };
  client.setStatus("connected");
  const store = new ConfigMigrationStore(connection, "/work");
  store.start();
  const request = vi.spyOn(connection.client, "request");
  return {
    store,
    connection,
    request,
    notify: (event: RpcNotification) =>
      client.notifications.forEach((callback) => callback(event)),
  };
}
const item = {
  itemType: "CONFIG",
  description: "Project configuration",
  cwd: "/work",
  details: null,
};
describe("config migration", () => {
  it("does not detect home by default or import unselected items", async () => {
    const { store, request } = setup();
    request.mockResolvedValue({ items: [item], connectors: [] });
    await store.detect();
    expect(request).toHaveBeenCalledWith("externalAgentConfig/detect", {
      includeHome: false,
      cwds: ["/work"],
      maxSessions: 100,
    });
    await store.importSelected();
    expect(request).toHaveBeenCalledTimes(1);
    store.select(0, true);
    request.mockResolvedValueOnce({ importId: "new" });
    await store.importSelected();
    expect(request).toHaveBeenLastCalledWith("externalAgentConfig/import", {
      migrationItems: [item],
      source: "codex-workbench",
    });
    store.dispose();
  });
  it("correlates early completion to response and ignores foreign imports", async () => {
    const { store, request, notify } = setup();
    request.mockResolvedValueOnce({ items: [item], connectors: [] });
    await store.detect();
    store.select(0, true);
    let resolve!: (value: unknown) => void;
    request
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce({ data: [], connectors: [] });
    const pending = store.importSelected();
    notify({
      method: "externalAgentConfig/import/completed",
      params: { importId: "foreign", itemTypeResults: [] },
    });
    notify({
      method: "externalAgentConfig/import/progress",
      params: {
        importId: "mine",
        itemTypeResults: [{ itemType: "CONFIG", successes: [], failures: [] }],
      },
    });
    notify({
      method: "externalAgentConfig/import/completed",
      params: {
        importId: "mine",
        itemTypeResults: [{ itemType: "SKILLS", successes: [], failures: [] }],
      },
    });
    expect(store.getSnapshot().completed).toBe(false);
    resolve({ importId: "mine" });
    await pending;
    expect(store.getSnapshot()).toMatchObject({
      importId: "mine",
      importing: false,
      completed: true,
    });
    expect(
      store.getSnapshot().results.map((result) => result.itemType),
    ).toEqual(["CONFIG", "SKILLS"]);
    expect(request).toHaveBeenLastCalledWith(
      "externalAgentConfig/import/readHistories",
    );
    store.dispose();
  });
  it("ignores stale detection after disconnect and keeps history errors isolated", async () => {
    const { store, request, connection } = setup();
    request.mockRejectedValueOnce(Error("history unavailable"));
    await store.readHistories();
    expect(store.getSnapshot().historyError).toBe("history unavailable");
    expect(store.getSnapshot().detectError).toBeNull();
    let resolve!: (value: unknown) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = store.detect();
    connection.disconnect();
    resolve({ items: [item], connectors: [] });
    await pending;
    expect(store.getSnapshot().detected).toBeNull();
    store.dispose();
  });
});

it("constructs without subscriptions and replays cleanup/setup while ignoring old detection", async () => {
  const connection = new ConnectionStore();
  const client = connection.client as unknown as {
    setStatus(status: string): void;
    notifications: Set<(event: RpcNotification) => void>;
  };
  client.setStatus("connected");
  const baseline = client.notifications.size;
  const store = new ConfigMigrationStore(connection);
  expect(client.notifications.size).toBe(baseline);
  store.start();
  expect(client.notifications.size).toBe(baseline + 1);
  let resolve!: (result: unknown) => void;
  const request = vi.spyOn(connection.client, "request").mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const old = store.detect();
  store.dispose();
  expect(client.notifications.size).toBe(baseline);
  store.start();
  request.mockResolvedValueOnce({ items: [], connectors: [] });
  await store.detect();
  resolve({ items: [item], connectors: [] });
  await old;
  expect(store.getSnapshot().detected?.items).toEqual([]);
  expect(store.getSnapshot().detecting).toBe(false);
  store.dispose();
  expect(client.notifications.size).toBe(baseline);
});
