import { afterEach, describe, expect, it, vi } from "vitest";
import { watchWorkspace } from "../../src/features/shell/workspace-watch";
import type { ConnectionStore } from "../../src/features/connection/store";
import type { RpcNotification } from "../../src/lib/rpc";

function setup(pending = false, unsupported = false) {
  let epoch = 1;
  let scope = 1;
  let callback: ((event: RpcNotification) => void) | undefined;
  let resolve!: (value: unknown) => void;
  const off = vi.fn(() => {
    callback = undefined;
  });
  const request = vi.fn((method: string) =>
    method === "fs/watch"
      ? unsupported
        ? Promise.reject(new Error("Method not found"))
        : pending
          ? new Promise((done) => {
              resolve = done;
            })
          : Promise.resolve({ path: "/work" })
      : Promise.resolve({}),
  );
  const connection = {
    client: {
      request,
      onNotification: (listener: typeof callback) => {
        callback = listener;
        return off;
      },
    },
    getSnapshot: () => ({ status: "connected", epoch, scope }),
  } as unknown as Pick<ConnectionStore, "client" | "getSnapshot">;
  const changed = vi.fn();
  const stop = watchWorkspace(
    connection,
    "/work",
    changed,
    "workspace-watch",
    250,
  );
  return {
    request,
    off,
    changed,
    stop,
    resolve: () => resolve({ path: "/work" }),
    emit: (watchId = "workspace-watch") =>
      callback?.({
        method: "fs/changed",
        params: { watchId, changedPaths: ["/work/file.ts"] },
      }),
    reconnect: () => {
      epoch++;
    },
    changeScope: () => {
      scope++;
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
});
describe("workspace filesystem invalidation", () => {
  it("registers the requested absolute workspace and debounces only matching events", async () => {
    vi.useFakeTimers();
    const { request, changed, emit, stop } = setup();
    expect(request).toHaveBeenCalledWith("fs/watch", {
      watchId: "workspace-watch",
      path: "/work",
    });
    emit("someone-else");
    await vi.advanceTimersByTimeAsync(300);
    expect(changed).not.toHaveBeenCalled();
    emit();
    await vi.advanceTimersByTimeAsync(150);
    emit();
    await vi.advanceTimersByTimeAsync(249);
    expect(changed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
  });
  it("unsubscribes, cancels pending debounce, and releases the watch on cleanup", async () => {
    vi.useFakeTimers();
    const { request, off, changed, emit, stop } = setup();
    await Promise.resolve();
    emit();
    stop();
    stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(changed).not.toHaveBeenCalled();
    expect(off).toHaveBeenCalledTimes(1);
    expect(
      request.mock.calls.filter(([method]) => method === "fs/unwatch"),
    ).toHaveLength(1);
    expect(request).toHaveBeenCalledWith("fs/unwatch", {
      watchId: "workspace-watch",
    });
  });
  it("releases registrations that finish after unmount without leaking a watch", async () => {
    const { request, stop, resolve } = setup(true);
    stop();
    expect(
      request.mock.calls.filter(([method]) => method === "fs/unwatch"),
    ).toHaveLength(1);
    resolve();
    await Promise.resolve();
    expect(
      request.mock.calls.filter(([method]) => method === "fs/unwatch"),
    ).toHaveLength(2);
  });
  it("never sends old watch cleanup on a replacement connection", async () => {
    vi.useFakeTimers();
    const { request, changed, emit, reconnect, stop, resolve } = setup(true);
    emit();
    reconnect();
    resolve();
    stop();
    await vi.advanceTimersByTimeAsync(300);
    expect(changed).not.toHaveBeenCalled();
    expect(
      request.mock.calls.filter(([method]) => method === "fs/unwatch"),
    ).toHaveLength(0);
  });
  it("suppresses stale scope events but can release watches on the same connection", async () => {
    vi.useFakeTimers();
    const { request, changed, emit, changeScope, stop } = setup();
    await Promise.resolve();
    emit();
    changeScope();
    await vi.advanceTimersByTimeAsync(300);
    expect(changed).not.toHaveBeenCalled();
    stop();
    expect(request).toHaveBeenCalledWith("fs/unwatch", {
      watchId: "workspace-watch",
    });
  });
  it("handles unsupported watch endpoints without an unhandled rejection", async () => {
    const { request, changed, stop } = setup(false, true);
    await Promise.resolve();
    await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("fs/unwatch", {
      watchId: "workspace-watch",
    });
    stop();
  });
});
