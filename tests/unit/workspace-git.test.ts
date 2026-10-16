import { afterEach, describe, expect, it, vi } from "vitest";
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
function fixture() {
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
      request: (method: string, params: { command?: string[] }) =>
        params.command?.includes("rev-parse")
          ? Promise.resolve({ exitCode: 0, stdout: "/repo\n", stderr: "" })
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
  it("clears successful state on disconnect and after a failed refresh", async () => {
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
    expect(store.getSnapshot().value).toBeUndefined();
    await store.refresh();
    expect(store.getSnapshot().value).toBeDefined();
    state.status = "disconnected";
    emit();
    expect(store.getSnapshot().value).toBeUndefined();
    off();
  });
});
