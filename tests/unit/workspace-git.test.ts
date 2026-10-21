import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileWorkspaceStore } from "../../src/features/files/store";
import type { SessionsStore } from "../../src/features/sessions/store";
import type { ConnectionStore } from "../../src/features/connection/store";
import { workspaceGitStore } from "../../src/features/shell/workspace-git";

vi.mock("../../src/features/shell/workspace-watch", () => ({
  watchWorkspace: vi.fn(() => vi.fn()),
}));
vi.mock("../../src/lib/runtime-context", () => ({ useRuntime: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function fixture(roots: Record<string, string> = {}) {
  vi.useFakeTimers();
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const state = { epoch: 1, scope: 1, status: "connected" };
  const request = vi.fn();
  const listeners = new Set<() => void>();
  const connection = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    client: {
      request: (
        method: string,
        params: { command?: string[]; cwd?: string },
      ) =>
        params.command?.includes("rev-parse")
          ? Promise.resolve({
              exitCode: 0,
              stdout: `${roots[params.cwd ?? ""] ?? "/repo"}\n`,
              stderr: "",
            })
          : request(method, params),
      onNotification: vi.fn(() => vi.fn()),
    },
  } as unknown as ConnectionStore;
  return {
    state,
    request,
    connection,
    emit: () => listeners.forEach((listener) => listener()),
  };
}
describe("shared workspace Git status", () => {
  it("shares one query across header and panel; refresh during a read coalesces", async () => {
    const { request, connection } = fixture();
    let finish!: (value: unknown) => void;
    request
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({
        exitCode: 0,
        stdout: "# branch.head main\0",
        stderr: "",
      });
    const header = workspaceGitStore(connection, "/repo", 1, 1);
    const panel = workspaceGitStore(connection, "/repo", 1, 1);
    expect(header).toBe(panel);
    const offHeader = header.subscribe(vi.fn());
    const offPanel = panel.subscribe(vi.fn());
    await header.refresh();
    await panel.refresh();
    expect(request).toHaveBeenCalledTimes(1);
    finish({
      exitCode: 0,
      stdout: "# branch.head main\0? file.ts\0",
      stderr: "",
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(panel.getSnapshot().loading).toBe(false));
    offHeader();
    offPanel();
  });
  it("does not publish a response after connection scope changes", async () => {
    const { request, connection, state } = fixture();
    let finish!: (value: unknown) => void;
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const old = workspaceGitStore(connection, "/repo", 1, 1);
    const off = old.subscribe(vi.fn());
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    state.scope = 2;
    const next = workspaceGitStore(connection, "/repo", 1, 2);
    expect(next).not.toBe(old);
    finish({ exitCode: 0, stdout: "# branch.head stale\0", stderr: "" });
    await Promise.resolve();
    expect(old.getSnapshot().value).toBeUndefined();
    expect(next.getSnapshot().value).toBeUndefined();
    off();
  });
  it("starts reading when a mounted connecting store becomes connected", async () => {
    const { state, request, connection, emit } = fixture();
    state.status = "connecting";
    request.mockResolvedValue({
      exitCode: 0,
      stdout: "# branch.head main\0",
      stderr: "",
    });
    const store = workspaceGitStore(connection, "/repo", 1, 1);
    const off = store.subscribe(vi.fn());
    expect(request).not.toHaveBeenCalled();
    state.status = "connected";
    emit();
    await vi.waitFor(() => expect(store.getSnapshot().loading).toBe(false));
    expect(store.getSnapshot().value?.branch).toBe("main");
    expect(request).toHaveBeenCalledTimes(1);
    off();
  });
  it("retains successful state after a failed refresh and clears on disconnect", async () => {
    const { state, request, connection, emit } = fixture();
    request.mockResolvedValue({
      exitCode: 0,
      stdout: "# branch.head main\0",
      stderr: "",
    });
    const store = workspaceGitStore(connection, "/repo", 1, 1);
    const off = store.subscribe(vi.fn());
    await vi.waitFor(() =>
      expect(store.getSnapshot().value?.repoRoot).toBe("/repo"),
    );
    request.mockRejectedValueOnce(new Error("offline"));
    await store.refresh();
    expect(store.getSnapshot().value?.repoRoot).toBe("/repo");
    expect(store.getSnapshot().failed).toBe(true);
    await store.refresh();
    expect(store.getSnapshot().value).toBeDefined();
    state.status = "disconnected";
    emit();
    expect(store.getSnapshot().value).toBeUndefined();
    off();
  });
  it("deduplicates revision invalidations and retains an unchanged snapshot and root", async () => {
    const { request, connection } = fixture();
    request.mockResolvedValue({
      exitCode: 0,
      stdout: "# branch.head main\0",
      stderr: "",
    });
    const command = vi.spyOn(connection.client, "request");
    const store = workspaceGitStore(connection, "/repo", 1, 1);
    const off = store.subscribe(vi.fn());
    await vi.waitFor(() => expect(store.getSnapshot().loading).toBe(false));
    const snapshot = store.getSnapshot();
    store.observeRevision(1);
    store.observeRevision(1);
    store.observeRevision(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(request).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toBe(snapshot);
    expect(
      command.mock.calls.filter(([, params]) =>
        (params as { command?: string[] }).command?.includes("rev-parse"),
      ),
    ).toHaveLength(1);
    off();
  });
  it("invalidates clean-file baselines when HEAD changes with no changed files", async () => {
    const { request, connection } = fixture();
    request.mockResolvedValue({
      exitCode: 0,
      stdout: "# branch.head main\0# branch.oid aaa\0",
      stderr: "",
    });
    const store = workspaceGitStore(connection, "/repo", 1, 1);
    const off = store.subscribe(vi.fn());
    await vi.waitFor(() => expect(store.getSnapshot().loading).toBe(false));
    expect(store.getSnapshot().head).toBe("aaa");
    const value = store.getSnapshot().value;
    request.mockResolvedValue({
      exitCode: 0,
      stdout: "# branch.head main\0# branch.oid bbb\0",
      stderr: "",
    });
    await store.refresh();
    expect(store.getSnapshot().head).toBe("bbb");
    expect(store.getSnapshot().value).toBe(value);
    expect(store.getSnapshot().value?.files).toEqual([]);
    off();
  });
  it("shares one status read for sibling directories and physical path aliases", async () => {
    const { connection, request } = fixture({
      "/repo/src": "/repo",
      "/repo/tests": "/repo",
      "/alias": "/repo",
    });
    request.mockResolvedValue({
      exitCode: 0,
      stdout: "# branch.head main\0",
      stderr: "",
    });
    const command = vi.spyOn(connection.client, "request");
    const handles = ["/repo/src", "/repo/tests", "/alias"].map((cwd) =>
      workspaceGitStore(connection, cwd, 1, 1),
    );
    const offs = handles.map((handle) => handle.subscribe(vi.fn()));
    await vi.waitFor(() =>
      expect(handles.every((handle) => !handle.getSnapshot().loading)).toBe(
        true,
      ),
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(
      command.mock.calls
        .filter(([, args]) =>
          (args as { command?: string[] }).command?.includes("status"),
        )
        .map(([, args]) => (args as { cwd: string }).cwd),
    ).toEqual(["/repo"]);
    expect(handles[0].getSnapshot()).toBe(handles[1].getSnapshot());
    expect(handles[1].getSnapshot()).toBe(handles[2].getSnapshot());
    offs.forEach((off) => off());
  });
  it("keeps linked worktrees and nested submodules separate", async () => {
    const { connection, request } = fixture({
      "/repo/src": "/repo",
      "/worktrees/other/src": "/worktrees/other",
      "/repo/submodule/src": "/repo/submodule",
    });
    request.mockResolvedValue({
      exitCode: 0,
      stdout: "# branch.head main\0",
      stderr: "",
    });
    const handles = [
      "/repo/src",
      "/worktrees/other/src",
      "/repo/submodule/src",
    ].map((cwd) => workspaceGitStore(connection, cwd, 1, 1));
    const offs = handles.map((handle) => handle.subscribe(vi.fn()));
    await vi.waitFor(() =>
      expect(handles.every((handle) => !handle.getSnapshot().loading)).toBe(
        true,
      ),
    );
    expect(request).toHaveBeenCalledTimes(3);
    expect(
      handles.map((handle) => handle.getSnapshot().value?.repoRoot),
    ).toEqual(["/repo", "/worktrees/other", "/repo/submodule"]);
    offs.forEach((off) => off());
  });
  it("rejects root resolutions from an old connection and deduplicates concurrent resolution", async () => {
    const { connection, request, state, emit } = fixture();
    let finish!: (value: unknown) => void;
    const command = vi.spyOn(connection.client, "request").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as never,
    );
    const first = workspaceGitStore(connection, "/repo/src", 1, 1);
    const off = first.subscribe(vi.fn());
    const offAgain = first.subscribe(vi.fn());
    expect(command).toHaveBeenCalledTimes(1);
    state.epoch++;
    emit();
    finish({ exitCode: 0, stdout: "/repo\n", stderr: "" });
    await Promise.resolve();
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
    expect(first.getSnapshot().value).toBeUndefined();
    off();
    offAgain();
  });
  it("invalidates for another session in the same worktree but excludes a nested submodule", async () => {
    const { connection, request } = fixture({
      "/repo/src": "/repo",
      "/repo/tests": "/repo",
      "/repo/submodule": "/repo/submodule",
    });
    request.mockResolvedValue({
      exitCode: 0,
      stdout: "# branch.head main\0",
      stderr: "",
    });
    const handle = workspaceGitStore(connection, "/repo/src", 1, 1);
    handle.sessions = {
      getSnapshot: () => ({
        threads: {
          sibling: { cwd: "/repo/tests" },
          submodule: { cwd: "/repo/submodule" },
        },
      }),
    } as unknown as SessionsStore;
    const off = handle.subscribe(vi.fn());
    await vi.waitFor(() => expect(handle.getSnapshot().loading).toBe(false));
    const notify = vi.mocked(connection.client.onNotification).mock.calls[0][0];
    notify({
      method: "turn/completed",
      params: { threadId: "sibling" },
    } as never);
    await vi.advanceTimersByTimeAsync(100);
    expect(request).toHaveBeenCalledTimes(2);
    notify({
      method: "turn/diff/updated",
      params: { threadId: "submodule" },
    } as never);
    await vi.advanceTimersByTimeAsync(100);
    expect(request).toHaveBeenCalledTimes(2);
    off();
  });
  it("resubscribes while root discovery is still pending without losing the eventual read", async () => {
    const { connection, request } = fixture();
    request.mockResolvedValue({
      exitCode: 0,
      stdout: "# branch.head main\0",
      stderr: "",
    });
    const original = connection.client.request;
    let finish!: (value: unknown) => void;
    vi.spyOn(connection.client, "request").mockImplementation(((
      ...call: Parameters<typeof original>
    ) =>
      call[0] === "command/exec" && call[1].command.includes("rev-parse")
        ? new Promise((resolve) => {
            finish = (value) => resolve(value as never);
          })
        : original(...call)) as typeof original);
    const handle = workspaceGitStore(connection, "/repo/src", 1, 1);
    const off = handle.subscribe(vi.fn());
    off();
    const offAgain = handle.subscribe(vi.fn());
    finish({ exitCode: 0, stdout: "/repo\n", stderr: "" });
    await vi.waitFor(() => expect(handle.getSnapshot().loading).toBe(false));
    expect(request).toHaveBeenCalledTimes(1);
    offAgain();
  });
  it("resolves alias mutation paths to their worktree and excludes submodule mutations", async () => {
    const { connection, request } = fixture({
      "/repo/src": "/repo",
      "/alias": "/repo\nsrc/",
      "/repo/submodule": "/repo/submodule",
    });
    request.mockResolvedValue({
      exitCode: 0,
      stdout: "# branch.head main\0",
      stderr: "",
    });
    let changedPaths = ["/alias/a.ts", "/alias/b.ts"];
    const handle = workspaceGitStore(connection, "/repo/src", 1, 1);
    handle.files = {
      getSnapshot: () => ({ revision: 0, changedPaths }),
      subscribe: () => () => {},
    } as unknown as FileWorkspaceStore;
    const command = vi.spyOn(connection.client, "request");
    const off = handle.subscribe(vi.fn());
    await vi.waitFor(() => expect(handle.getSnapshot().loading).toBe(false));
    handle.observeRevision(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(request).toHaveBeenCalledTimes(2);
    expect(
      command.mock.calls.filter(
        ([, args]) => (args as { cwd?: string }).cwd === "/alias",
      ),
    ).toHaveLength(1);
    changedPaths = ["/repo/submodule/a.ts"];
    handle.observeRevision(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(request).toHaveBeenCalledTimes(2);
    off();
  });
  it("caches root failures briefly and permits immediate manual retry", async () => {
    const { connection } = fixture();
    const command = vi.spyOn(connection.client, "request").mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "not a repository",
    } as never);
    const handle = workspaceGitStore(connection, "/not-repo", 1, 1);
    const off = handle.subscribe(vi.fn());
    await vi.waitFor(() => expect(handle.getSnapshot().failed).toBe(true));
    off();
    const offAgain = handle.subscribe(vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    expect(command).toHaveBeenCalledTimes(1);
    await handle.refresh();
    expect(command).toHaveBeenCalledTimes(2);
    offAgain();
  });
});
