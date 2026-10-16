import { afterEach, expect, it, vi } from "vitest";
import {
  EnvironmentsStore,
  type EnvironmentProfile,
} from "../../src/features/connection/environments";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
const profiles: EnvironmentProfile[] = [
  {
    id: "local",
    name: "本机",
    kind: "local",
    url: "ws://127.0.0.1:4500",
  },
  {
    id: "dev",
    name: "开发机",
    kind: "remote",
    url: "ws://127.0.0.1:14500",
  },
];
it("switches and edits environments without disconnecting another runtime or mixing equal thread IDs", () => {
  const store = new EnvironmentsStore(profiles);
  const [local, remote] = store.getSnapshot().entries;
  const disconnect = vi.spyOn(local.runtime.connection, "disconnect");
  local.runtime.drafts.setText("same", "local draft");
  remote.runtime.drafts.setText("same", "remote draft");
  store.select("dev");
  expect(disconnect).not.toHaveBeenCalled();
  expect(store.active().runtime.drafts.get("same").text).toBe("remote draft");
  store.save({ ...profiles[1], url: "ws://127.0.0.1:15500" });
  expect(store.active().runtime).toBe(remote.runtime);
  expect(store.active().runtime.drafts.get("same").text).toBe("remote draft");
  store.select("local");
  expect(store.active().runtime.drafts.get("same").text).toBe("local draft");
  store.remove("dev");
  expect(store.getSnapshot().entries).toHaveLength(1);
  expect(disconnect).not.toHaveBeenCalled();
});
it("does not reset session scope on reconnect to the same endpoint", async () => {
  const store = new EnvironmentsStore(profiles);
  const connection = store.active().runtime.connection;
  vi.spyOn(connection.client, "connect").mockResolvedValue();
  vi.spyOn(connection.client, "request").mockResolvedValue({
    data: [],
    nextCursor: null,
    account: null,
  });
  await connection.connect(profiles[0].url);
  const scope = connection.getSnapshot().scope;
  await connection.connect(profiles[0].url);
  expect(connection.getSnapshot().scope).toBe(scope);
  await connection.connect(profiles[1].url);
  expect(connection.getSnapshot().scope).toBe(scope + 1);
});
it("saving connection preferences does not activate another environment or disconnect an equivalent URL", () => {
  const store = new EnvironmentsStore(profiles);
  const [local, remote] = store.getSnapshot().entries;
  const disconnect = vi.spyOn(local.runtime.connection, "disconnect");
  store.save({ ...profiles[0], url: profiles[0].url + "/" }, false);
  expect(disconnect).not.toHaveBeenCalled();
  store.save({ ...profiles[1], name: "renamed host" }, false);
  expect(store.active().id).toBe("local");
  expect(store.getSnapshot().entries[1].runtime).toBe(remote.runtime);
});

it("restores saved connections once and respects explicitly disconnected profiles", async () => {
  const store = new EnvironmentsStore([
    { ...profiles[0], autoConnect: false },
    { ...profiles[1], autoConnect: true },
  ]);
  const [local, remote] = store.getSnapshot().entries;
  const localConnect = vi.spyOn(local.runtime, "connect").mockResolvedValue();
  const remoteConnect = vi
    .spyOn(remote.runtime, "connect")
    .mockRejectedValue(new Error("offline"));
  store.restoreConnections();
  store.restoreConnections();
  await Promise.resolve();
  expect(localConnect).not.toHaveBeenCalled();
  expect(remoteConnect).toHaveBeenCalledExactlyOnceWith(remote.url);
});
it("persists connection intent and restores the selected environment", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  try {
    const store = new EnvironmentsStore(profiles);
    const remote = store.getSnapshot().entries[1];
    vi.spyOn(remote.runtime.connection.client, "connect").mockRejectedValue(
      new Error("offline"),
    );
    await expect(remote.runtime.connect(remote.url)).rejects.toThrow("offline");
    store.select(remote.id);
    expect(JSON.parse(values.get("codex-environments")!)[1].autoConnect).toBe(
      true,
    );
    store.save(profiles[1], false);
    expect(store.getSnapshot().entries[1].autoConnect).toBe(true);
    expect(new EnvironmentsStore().active().id).toBe(remote.id);
    remote.runtime.connection.disconnect();
    expect(JSON.parse(values.get("codex-environments")!)[1].autoConnect).toBe(
      false,
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
