import { describe, expect, it, vi } from "vitest";
import {
  ProjectsStore,
  previewAddress,
} from "../../src/features/projects/store";
import { Store } from "../../src/lib/store";
import { RpcError, type RpcNotification } from "../../src/lib/rpc";
import type { ConnectionStore } from "../../src/features/connection/store";

function fixture(storage = new Map<string, string>()) {
  let notify: (message: RpcNotification) => void = () => {};
  let resolve: (value: {
    exitCode: number;
    stdout: string;
    stderr: string;
  }) => void = () => {};
  const pending = new Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>((done) => {
    resolve = done;
  });
  const request = vi.fn(() => pending);
  class Connection extends Store<{
    url: string;
    epoch: number;
    status: string;
  }> {
    client = {
      request,
      onNotification: (listener: typeof notify) => {
        notify = listener;
        return () => {};
      },
    };
    change(patch: Partial<ReturnType<Connection["getSnapshot"]>>) {
      this.update({ ...this.state, ...patch });
    }
  }
  const connection = new Connection({
    url: "ws://fixture:1234",
    epoch: 1,
    status: "connected",
  });
  const persisted = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  };
  const store = new ProjectsStore(
    connection as unknown as ConnectionStore,
    "fixture",
    persisted,
  );
  store.select("/tmp/project-fixture");
  const project = store.getSnapshot().projects[0];
  store.save({
    ...project,
    commands: { test: "printf fixture", build: "", dev: "" },
  });
  return {
    store,
    connection,
    request,
    resolve,
    persisted,
    notify: (message: RpcNotification) => notify(message),
  };
}
describe("project workspace", () => {
  it("persists config without executing and isolates directories, endpoints and environments", () => {
    const { store, connection, request, persisted } = fixture();
    store.save({
      ...store.getSnapshot().projects[0],
      model: "configured-model",
      description: "fixture only",
    });
    store.select("/tmp/other-fixture");
    expect(store.getSnapshot().projects[1].model).toBe("");
    connection.change({ url: "ws://other-fixture:1", epoch: 2 });
    expect(store.getSnapshot().projects).toEqual([]);
    connection.change({ url: "ws://fixture:1234", epoch: 3 });
    expect(store.getSnapshot().projects[0].model).toBe("configured-model");
    const other = new ProjectsStore(
      connection as unknown as ConnectionStore,
      "other",
      persisted,
    );
    expect(other.getSnapshot().projects).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
  it("runs in the explicit current directory even when another project is selected", async () => {
    const { store, request, resolve } = fixture();
    store.select("/tmp/other-project");
    store.save({
      ...store.getProject("/tmp/other-project")!,
      commands: { test: "wrong command", build: "", dev: "" },
    });
    const running = store.run("test", "/tmp/project-fixture/");
    expect(request).toHaveBeenCalledWith(
      "command/exec",
      expect.objectContaining({
        cwd: "/tmp/project-fixture",
        command: ["/bin/sh", "-lc", "printf fixture"],
      }),
    );
    expect(store.getSnapshot().selected).toBe("/tmp/other-project");
    resolve({ exitCode: 0, stdout: "", stderr: "" });
    await running;
  });
  it("upserts edited project configurations without selecting or creating during reads", () => {
    const { store, request } = fixture();
    const originalSelection = store.getSnapshot().selected;
    expect(store.getProject("/tmp/new-current")).toBeUndefined();
    expect(store.getSnapshot().projects).toHaveLength(1);
    store.save({
      ...store.getSnapshot().projects[0],
      cwd: "/tmp/new-current/",
      description: "new defaults",
    });
    expect(store.getProject("/tmp/new-current")?.description).toBe(
      "new defaults",
    );
    expect(store.getSnapshot().selected).toBe(originalSelection);
    store.remove("/tmp/new-current");
    expect(store.getProject("/tmp/new-current")).toBeUndefined();
    expect(store.getSnapshot().projects).toHaveLength(1);
    expect(request).not.toHaveBeenCalled();
  });
  it("applies the project limit to configuration upserts", () => {
    const { store } = fixture();
    for (let index = 1; index < 100; index++)
      store.select(`/tmp/limit-${index}`);
    store.save({
      ...store.getSnapshot().projects[0],
      cwd: "/tmp/overflow-save",
    });
    expect(store.getSnapshot().projects).toHaveLength(100);
    expect(store.getSnapshot().warning).toContain("100");
    expect(store.getProject("/tmp/overflow-save")).toBeUndefined();
  });
  it("streams output, prevents duplicate launch, writes stdin, stops, and records actual exit", async () => {
    const { store, request, notify, resolve } = fixture();
    const running = store.run("test");
    await store.run("test");
    expect(request).toHaveBeenCalledTimes(1);
    const id = store.getSnapshot().runs[0].id;
    notify({
      method: "command/exec/outputDelta",
      params: {
        processId: id,
        stream: "stdout",
        deltaBase64: btoa("fixture output"),
        capReached: false,
      },
    });
    expect(store.getSnapshot().runs[0].output).toBe("fixture output");
    void store.write(id, "hello\n");
    void store.stop(id);
    expect(request.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      "command/exec",
      "command/exec/write",
      "command/exec/terminate",
    ]);
    expect(store.getSnapshot().runs[0].status).toBe("stopping");
    resolve({ exitCode: 7, stdout: "", stderr: "" });
    await running;
    expect(store.getSnapshot().runs[0]).toMatchObject({
      status: "exited",
      exitCode: 7,
    });
  });
  it("retains unknown state on disconnect and ignores a late exit response", async () => {
    const { store, connection, resolve, persisted } = fixture();
    const running = store.run("test");
    connection.change({ status: "disconnected" });
    resolve({ exitCode: 0, stdout: "", stderr: "" });
    await running;
    expect(store.getSnapshot().runs[0].status).toBe("unknown");
    const rebuilt = new ProjectsStore(
      connection as unknown as ConnectionStore,
      "fixture",
      persisted,
    );
    expect(rebuilt.getSnapshot().runs[0].status).toBe("unknown");
    expect(rebuilt.getSnapshot().runs[0].exitCode).toBeUndefined();
  });
  it("never retries an unsupported command as another execution", async () => {
    const { store, request } = fixture();
    request.mockRejectedValueOnce(new RpcError("unsupported", -32601));
    await store.run("test");
    expect(store.getSnapshot().runs[0].status).toBe("unsupported");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("ignores a late stop rejection after a command already exited", async () => {
    const { store, request, resolve } = fixture();
    const running = store.run("test");
    let rejectStop: (error: Error) => void = () => {};
    request.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectStop = reject;
        }),
    );
    const stopping = store.stop(store.getSnapshot().runs[0].id);
    resolve({ exitCode: 0, stdout: "", stderr: "" });
    await running;
    rejectStop(new Error("late terminate failure"));
    await stopping;
    expect(store.getSnapshot().runs[0]).toMatchObject({
      status: "exited",
      exitCode: 0,
    });
  });
  it.each(["stop", "write"] as const)(
    "ignores a late %s rejection after switching away and restoring persisted history",
    async (operation) => {
      const { store, request, connection, resolve } = fixture();
      const running = store.run("test");
      let rejectControl: (error: Error) => void = () => {};
      request.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectControl = reject;
          }),
      );
      const id = store.getSnapshot().runs[0].id;
      const control =
        operation === "stop" ? store.stop(id) : store.write(id, "fixture");
      connection.change({ url: "ws://different:9", epoch: 2 });
      connection.change({ url: "ws://fixture:1234", epoch: 3 });
      const restored = store.getSnapshot().runs[0];
      rejectControl(new Error("old control failure"));
      await control;
      expect(store.getSnapshot().runs[0]).toEqual(restored);
      resolve({ exitCode: 0, stdout: "", stderr: "" });
      await running;
      expect(store.getSnapshot().runs[0]).toEqual(restored);
    },
  );
  it("marks large buffered output truncated and does not classify invalid params as unsupported", async () => {
    const { store, resolve } = fixture();
    const running = store.run("test");
    resolve({ exitCode: 0, stdout: "x".repeat(200001), stderr: "" });
    await running;
    expect(store.getSnapshot().runs[0]).toMatchObject({
      truncated: true,
      status: "exited",
    });
    expect(store.getSnapshot().runs[0].output).toHaveLength(200000);
    const other = fixture();
    other.request.mockRejectedValueOnce(new RpcError("bad params", -32602));
    await other.store.run("test");
    expect(other.store.getSnapshot().runs[0].status).toBe("unknown");
  });
  it("normalizes endpoint and directory identity without mixing projects", () => {
    const { store, connection } = fixture();
    store.select("/tmp/project-fixture///");
    expect(store.getSnapshot().projects).toHaveLength(1);
    expect(store.getProject("/tmp/project-fixture/")?.cwd).toBe(
      "/tmp/project-fixture",
    );
    connection.change({ url: "ws://fixture:1234/", epoch: 2 });
    expect(store.getSnapshot().projects).toHaveLength(1);
  });
  it("keeps UTF-8 decoders separate for interleaved stdout and stderr", async () => {
    const { store, notify, resolve } = fixture();
    const running = store.run("test");
    const processId = store.getSnapshot().runs[0].id;
    const delta = (stream: "stdout" | "stderr", bytes: number[]) =>
      notify({
        method: "command/exec/outputDelta",
        params: {
          processId,
          stream,
          deltaBase64: btoa(String.fromCharCode(...bytes)),
          capReached: false,
        },
      });
    delta("stdout", [0xe4]);
    delta("stderr", [0x45]);
    delta("stdout", [0xb8, 0xad]);
    resolve({ exitCode: 0, stdout: "", stderr: "" });
    await running;
    expect(store.getSnapshot().runs[0].output).toBe("E中");
  });
  it("cannot overwrite a new endpoint's state with an old command result", async () => {
    const { store, connection, resolve } = fixture();
    const running = store.run("test");
    connection.change({ url: "ws://other-fixture:2", epoch: 2 });
    resolve({ exitCode: 0, stdout: "old endpoint", stderr: "" });
    await running;
    expect(store.getSnapshot().runs).toEqual([]);
  });
  it("keeps oversize edits in memory without replacing the last recoverable configuration", () => {
    const { store, connection, persisted } = fixture();
    const saved = store.getSnapshot().projects[0];
    store.save({ ...saved, description: "x".repeat(500_000) });
    expect(store.getSnapshot().projects[0].description).toHaveLength(500_000);
    expect(store.getSnapshot().warning).toContain("容量");
    const rebuilt = new ProjectsStore(
      connection as unknown as ConnectionStore,
      "fixture",
      persisted,
    );
    expect(rebuilt.getSnapshot().projects[0].description).toBe("");
    store.save({ ...saved, description: "smaller" });
    expect(store.getSnapshot().warning).toBeNull();
  });
  it("rejects a 101st project visibly and allows deleting local configuration", () => {
    const { store, connection, persisted, request } = fixture();
    for (let index = 1; index < 100; index++)
      store.select(`/tmp/project-${index}`);
    store.select("/tmp/overflow");
    expect(store.getSnapshot().projects).toHaveLength(100);
    expect(store.getSnapshot().warning).toContain("100");
    store.remove("/tmp/project-99");
    expect(store.getSnapshot().projects).toHaveLength(99);
    expect(store.getSnapshot().warning).toBeNull();
    expect(request).not.toHaveBeenCalled();
    const rebuilt = new ProjectsStore(
      connection as unknown as ConnectionStore,
      "fixture",
      persisted,
    );
    expect(rebuilt.getProject("/tmp/project-99")).toBeUndefined();
  });
  it("blocks removal while a project has a running or unknown command", async () => {
    const { store, connection, resolve } = fixture();
    const running = store.run("test");
    store.remove("/tmp/project-fixture");
    expect(store.getSnapshot().projects).toHaveLength(1);
    connection.change({ status: "disconnected" });
    store.remove("/tmp/project-fixture");
    expect(store.getSnapshot().projects).toHaveLength(1);
    const id = store.getSnapshot().runs[0].id;
    store.acknowledgeUnknown(id);
    store.remove("/tmp/project-fixture");
    expect(store.getSnapshot().projects).toEqual([]);
    resolve({ exitCode: 0, stdout: "", stderr: "" });
    await running;
  });
  it("rejects unsafe preview URLs", () => {
    expect(previewAddress("javascript:alert(1)")).toBeNull();
    const authenticatedUrl = new URL("https://example.com");
    authenticatedUrl.username = "fixture-user";
    authenticatedUrl.password = "fixture-password";
    expect(previewAddress(authenticatedUrl.href)).toBeNull();
    expect(previewAddress("http://localhost:3000")).toBe(
      "http://localhost:3000/",
    );
  });
});
