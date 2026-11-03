import { describe, expect, it, vi } from "vitest";
import {
  ThreadHooksStore,
  hookEventLabel,
} from "../../src/features/conversation/thread-hooks-store";
import type { ConnectionStore } from "../../src/features/connection/store";
import type { RpcNotification } from "../../src/lib/rpc";
import type { HookRunSummary } from "../../src/generated/v2/HookRunSummary";

function setup() {
  let epoch = 1;
  let listener: ((event: RpcNotification) => void) | undefined;
  const request = vi.fn().mockResolvedValue({ data: [] });
  const connection = {
    getSnapshot: () => ({ epoch, status: "connected" }),
    client: {
      request,
      onNotification: (callback: typeof listener) => {
        listener = callback;
        return () => {
          listener = undefined;
        };
      },
    },
  } as unknown as ConnectionStore;
  const store = new ThreadHooksStore("thread", 1, connection);
  return {
    store,
    request,
    notify: (event: RpcNotification) => listener?.(event),
    disconnect: () => {
      epoch++;
    },
  };
}
const run = (status: HookRunSummary["status"]): HookRunSummary => ({
  id: "run",
  eventName: "preModelRequest",
  handlerType: "command",
  executionMode: "sync",
  scope: "turn",
  sourcePath: "/hooks/model.sh",
  source: "user",
  displayOrder: 0n,
  status,
  statusMessage: null,
  startedAt: 1000n,
  completedAt: null,
  durationMs: null,
  entries: [],
});

describe("thread Hooks", () => {
  it("only loads after activation and sends a thread query without cwd", async () => {
    const f = setup();
    await f.store.load();
    expect(f.request).not.toHaveBeenCalled();
    const stop = f.store.start();
    await f.store.load();
    expect(f.request).toHaveBeenCalledWith("hooks/list", {
      threadId: "thread",
    });
    expect(f.store.getSnapshot().data).toEqual({ data: [] });
    stop();
  });
  it("ignores results from an old environment or a closed panel", async () => {
    for (const close of [false, true]) {
      const f = setup();
      const stop = f.store.start();
      let resolve!: (value: { data: [] }) => void;
      f.request.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      const load = f.store.load();
      if (close) stop();
      else f.disconnect();
      resolve({ data: [] });
      await load;
      expect(f.store.getSnapshot().data).toBeNull();
      if (!close) stop();
    }
  });
  it("keeps only this thread's latest lifecycle and ignores a late start", () => {
    const f = setup();
    const stop = f.store.start();
    f.notify({
      method: "hook/started",
      params: { threadId: "other", turnId: null, run: run("running") },
    });
    expect(f.store.getSnapshot().runs).toHaveLength(0);
    f.notify({
      method: "hook/completed",
      params: { threadId: "thread", turnId: "turn", run: run("completed") },
    });
    f.notify({
      method: "hook/started",
      params: { threadId: "thread", turnId: "turn", run: run("running") },
    });
    expect(f.store.getSnapshot().runs).toHaveLength(1);
    expect(f.store.getSnapshot().runs[0].status).toBe("completed");
    stop();
  });
  it("surfaces unsupported and failed loads without dropping a prior catalog", async () => {
    const f = setup();
    const stop = f.store.start();
    await f.store.load();
    f.request.mockRejectedValue(
      Object.assign(new Error("unknown"), { code: -32601 }),
    );
    await f.store.load();
    expect(f.store.getSnapshot().error).toContain("不支持");
    expect(f.store.getSnapshot().data).toEqual({ data: [] });
    f.request.mockRejectedValue(new Error("thread is not loaded"));
    await f.store.load();
    expect(f.store.getSnapshot().error).toBe("thread is not loaded");
    stop();
  });
  it("labels model request boundaries explicitly", () => {
    expect(hookEventLabel("preModelRequest")).toBe("模型请求前");
    expect(hookEventLabel("postModelRequest")).toBe("模型请求后");
  });
});
