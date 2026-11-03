import { expect, it, vi } from "vitest";
import type { ConnectionStore } from "../../src/features/connection/store";
import { RpcError } from "../../src/lib/rpc";
import {
  diagnosticPath,
  ThreadInsightsStore,
  threadInsightsFor,
} from "../../src/features/conversation/thread-insights-store";
import {
  formatUsageMicros,
  formatUsageCount,
} from "../../src/features/conversation/usage-format";

function setup(handler: (method: string, params: unknown) => Promise<unknown>) {
  let state = {
    status: "connected",
    epoch: 1,
    scope: 1,
    accountDetails: {
      account: { type: "chatgpt", email: "one@example.invalid" },
    },
  };
  const listeners = new Set<() => void>();
  const request = vi.fn(handler);
  const connection = {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    client: { request },
  } as unknown as ConnectionStore;
  const store = new ThreadInsightsStore("t", connection);
  const stop = store.start();
  return {
    store,
    request,
    stop,
    connection,
    disconnect: () => {
      state = { ...state, epoch: state.epoch + 1, status: "disconnected" };
      listeners.forEach((listener) => listener());
    },
    reconnect: () => {
      state = { ...state, status: "connected" };
      listeners.forEach((listener) => listener());
    },
    changeAccount: () => {
      state = {
        ...state,
        accountDetails: {
          account: { type: "chatgpt", email: "two@example.invalid" },
        },
      };
      listeners.forEach((listener) => listener());
    },
  };
}

it("distinguishes unknown, zero and exact micro-unit amounts without unsafe rounding", () => {
  expect(formatUsageMicros(null, true)).toBe("暂未提供");
  expect(formatUsageMicros(undefined, true)).toBe("暂未提供");
  expect(formatUsageMicros(0, true)).toBe("USD 0.00");
  expect(formatUsageMicros(123456n, true)).toBe("USD 0.123456");
  expect(formatUsageMicros(9007199254740993n, true)).toBe(
    "USD 9,007,199,254.740993",
  );
  expect(formatUsageMicros(Number.MAX_SAFE_INTEGER + 1)).toBe("暂未提供");
  expect(formatUsageCount("1234567")).toBe("1,234,567");
});

it("accepts native absolute ZIP paths and rejects relative or malformed paths", () => {
  for (const path of [
    "/tmp/report.zip",
    "C:\\Temp\\report.zip",
    "\\\\server\\share\\report.zip",
  ])
    expect(diagnosticPath(path)).toBe(path);
  for (const path of [
    "report.zip",
    "/tmp/report.txt",
    "file:///tmp/report.zip",
    "/tmp/report\0.zip",
  ])
    expect(() => diagnosticPath(path)).toThrow();
});

it("reads thread-scoped usage only on demand and rejects a mismatched thread response", async () => {
  const f = setup(async () => ({ threadUsage: { threadId: "other" } }));
  expect(f.request).not.toHaveBeenCalled();
  await f.store.loadUsage();
  expect(f.request).toHaveBeenCalledWith("account/usage/read", {
    threadId: "t",
  });
  expect(f.store.getSnapshot().usage).toBeNull();
  expect(f.store.getSnapshot().usageError).toContain("不属于当前会话");
  f.stop();
});

it("keeps unknown thread billing absent and clears stale usage after disconnect", async () => {
  const f = setup(async () => ({}));
  await f.store.loadUsage();
  expect(f.store.getSnapshot().usageLoaded).toBe(true);
  expect(f.store.getSnapshot().usage).toBeNull();
  f.disconnect();
  expect(f.store.getSnapshot().usageLoaded).toBe(false);
  f.stop();
});

it("saves explicitly with logs opt-in, prevents duplicate writes and downloads independently", async () => {
  const f = setup(async (method) =>
    method === "feedback/save"
      ? { savedPath: "/tmp/report.zip", threadId: "t", promptHash: null }
      : { dataBase64: "UEs=" },
  );
  await f.store.save("/tmp/report.zip", false, " investigate ");
  expect(f.request).toHaveBeenCalledWith("feedback/save", {
    savePath: "/tmp/report.zip",
    classification: "bug",
    reason: "investigate",
    threadId: "t",
    includeLogs: false,
  });
  expect(f.request).toHaveBeenCalledTimes(1);
  await f.store.save("/tmp/report.zip", true, "");
  expect(f.request).toHaveBeenCalledTimes(1);
  expect(await f.store.download()).toEqual({
    dataBase64: "UEs=",
    name: "report.zip",
  });
  expect(f.request).toHaveBeenLastCalledWith("fs/readFile", {
    path: "/tmp/report.zip",
  });
  f.stop();
});

it("preserves the attempted path after disconnection and never replays the write", async () => {
  let finish!: (value: unknown) => void;
  const f = setup((method) =>
    method === "feedback/save"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ dataBase64: "UEs=" }),
  );
  const saving = f.store.save("/tmp/pending.zip", true, "");
  f.disconnect();
  expect(f.store.getSnapshot()).toMatchObject({
    attemptedPath: "/tmp/pending.zip",
    uncertain: true,
    saveBusy: false,
  });
  f.reconnect();
  finish({ savedPath: "/tmp/pending.zip" });
  await saving;
  expect(f.store.getSnapshot().uncertain).toBe(true);
  expect(f.request).toHaveBeenCalledTimes(1);
  await f.store.download();
  expect(f.store.getSnapshot()).toMatchObject({
    savedPath: "/tmp/pending.zip",
    uncertain: false,
  });
  expect(
    f.request.mock.calls.filter(([method]) => method === "feedback/save"),
  ).toHaveLength(1);
  f.stop();
});

it("distinguishes a definite RPC rejection from an unconfirmed transport failure", async () => {
  const f = setup(async () => {
    throw new RpcError("Not available", -32601);
  });
  await f.store.save("/tmp/rejected.zip", false, "");
  expect(f.store.getSnapshot().uncertain).toBe(false);
  f.stop();
  const g = setup(async () => {
    throw new Error("Timed out");
  });
  await g.store.save("/tmp/pending.zip", false, "");
  await g.store.save("/tmp/pending.zip", false, "");
  expect(g.store.getSnapshot().uncertain).toBe(true);
  expect(g.request).toHaveBeenCalledTimes(1);
  g.stop();
});

it("retains the host path when the browser download limit is exceeded", async () => {
  const f = setup(async (method) =>
    method === "feedback/save"
      ? { savedPath: "/tmp/large.zip" }
      : { dataBase64: "A".repeat(12 * 1024 * 1024) },
  );
  await f.store.save("/tmp/large.zip", false, "");
  expect(await f.store.download()).toBeNull();
  expect(f.store.getSnapshot().savedPath).toBe("/tmp/large.zip");
  expect(f.store.getSnapshot().downloadError).toContain("8 MB");
  f.stop();
});

it("preserves pending exports across project-panel remounts and isolates other threads", async () => {
  const f = setup(async () => {
    throw new Error("Timed out");
  });
  const store = threadInsightsFor(f.connection, "t");
  const stop = store.start();
  await store.save("/tmp/persist.zip", false, "");
  stop();
  f.disconnect();
  f.reconnect();
  const remounted = threadInsightsFor(f.connection, "t");
  expect(remounted).toBe(store);
  const stopAgain = remounted.start();
  expect(remounted.getSnapshot()).toMatchObject({
    attemptedPath: "/tmp/persist.zip",
    uncertain: true,
  });
  expect(
    threadInsightsFor(f.connection, "other").getSnapshot().attemptedPath,
  ).toBeNull();
  stopAgain();
  f.stop();
});

it("prevents an older download from racing a new diagnostic write", async () => {
  let finish!: (value: unknown) => void;
  const f = setup((method) =>
    method === "feedback/save"
      ? Promise.resolve({ savedPath: "/tmp/a.zip" })
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  await f.store.save("/tmp/a.zip", false, "");
  const downloading = f.store.download();
  await f.store.save("/tmp/b.zip", false, "");
  expect(
    f.request.mock.calls.filter(([method]) => method === "feedback/save"),
  ).toHaveLength(1);
  finish({ dataBase64: "UEs=" });
  await downloading;
  expect(f.store.getSnapshot().savedPath).toBe("/tmp/a.zip");
  f.stop();
});

it("invalidates in-flight costs after account changes while preserving diagnostic paths", async () => {
  let finish!: (value: unknown) => void;
  const f = setup((method) =>
    method === "feedback/save"
      ? Promise.resolve({ savedPath: "/tmp/a.zip" })
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  await f.store.save("/tmp/a.zip", false, "");
  const reading = f.store.loadUsage();
  f.changeAccount();
  finish({ threadUsage: { threadId: "t", nativeUsageUsdMicros: 1000000 } });
  await reading;
  expect(f.store.getSnapshot()).toMatchObject({
    usage: null,
    usageLoaded: false,
    usageBusy: false,
    savedPath: "/tmp/a.zip",
  });
  f.stop();
});
