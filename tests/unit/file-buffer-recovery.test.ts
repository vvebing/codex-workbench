import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileWorkspaceStore } from "../../src/features/files/store";
import {
  fileBufferKey,
  readFileBuffers,
  readLargeFileBuffers,
  saveLargeFileBuffers,
  MAX_RECOVERY_TEXT_LENGTH,
} from "../../src/features/files/buffer-recovery";
import type { ConnectionStore } from "../../src/features/connection/store";

let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup(
  scope = "environment",
  url = "ws://localhost:4501",
  text = "original",
) {
  const request = vi.fn(
    async (method: string, params: { dataBase64?: string }) => {
      if (method === "fs/readFile") return { dataBase64: btoa(text) };
      if (method === "fs/writeFile") text = atob(params.dataBase64!);
      return {};
    },
  );
  const connection = {
    getSnapshot: () => ({ url, status: "connected", epoch: 1 }),
    subscribe: () => () => {},
    client: { request, onNotification: () => () => {} },
  } as unknown as ConnectionStore;
  const files = new FileWorkspaceStore(connection, scope);
  return { files, request };
}
it("restores edits and their baseline without writing; successful save clears recovery", async () => {
  const first = setup();
  await first.files.open({ path: "/project/file.txt" });
  const id = first.files.getSnapshot().activeId!;
  first.files.setText(id, "unsaved");
  const fresh = setup();
  expect(fresh.files.getSnapshot().documents[0]).toMatchObject({
    text: "unsaved",
    baseText: "original",
    dirty: true,
    recovered: true,
  });
  expect(fresh.request).not.toHaveBeenCalled();
  await fresh.files.save(id);
  expect(fresh.request.mock.calls.map(([method]) => method)).toEqual([
    "fs/readFile",
    "fs/writeFile",
  ]);
  expect(setup().files.getSnapshot().documents).toEqual([]);
});
it("keeps restored text on external changes and refuses to overwrite the disk", async () => {
  const first = setup();
  await first.files.open({ path: "/project/file.txt" });
  const id = first.files.getSnapshot().activeId!;
  first.files.setText(id, "unsaved");
  const fresh = setup("environment", "ws://localhost:4501", "external");
  await fresh.files.open({ path: "/project/file.txt" });
  expect(fresh.files.getSnapshot().documents[0]).toMatchObject({
    text: "unsaved",
    diskText: "external",
    conflict: true,
  });
  await fresh.files.save(id);
  expect(
    fresh.request.mock.calls.every(([method]) => method !== "fs/writeFile"),
  ).toBe(true);
  expect(setup().files.getSnapshot().documents[0].text).toBe("unsaved");
});
it("isolates environments and endpoints and deletes discarded buffers", async () => {
  const first = setup();
  await first.files.open({ path: "/project/file.txt" });
  const id = first.files.getSnapshot().activeId!;
  first.files.setText(id, "unsaved");
  expect(setup("another").files.getSnapshot().documents).toEqual([]);
  expect(
    setup("environment", "ws://remote:4501").files.getSnapshot().documents,
  ).toEqual([]);
  first.files.close(id);
  expect(setup().files.getSnapshot().documents).toEqual([]);
});
it("retains editing and signals failures when browser storage is unavailable", async () => {
  const { files } = setup();
  await files.open({ path: "/project/file.txt" });
  vi.stubGlobal("localStorage", {
    setItem: () => {
      throw Error("quota");
    },
  });
  files.setText(files.getSnapshot().activeId!, "unsaved");
  expect(files.getSnapshot().documents[0].text).toBe("unsaved");
  expect(files.getSnapshot().recoveryError).toContain("未能保存");
});
it("can reopen and edit a restored buffer before the first connection", async () => {
  const first = setup();
  await first.files.open({ path: "/project/file.txt" });
  first.files.setText(first.files.getSnapshot().activeId!, "unsaved");
  const request = vi.fn();
  const connection = {
    getSnapshot: () => ({ url: "", status: "disconnected", epoch: 0 }),
    subscribe: () => () => {},
    client: { request, onNotification: () => () => {} },
  } as unknown as ConnectionStore;
  const offline = new FileWorkspaceStore(
    connection,
    "environment",
    "ws://localhost:4501",
  );
  offline.setVisible(true);
  await offline.open({ path: "/project/file.txt" });
  offline.setText(offline.getSnapshot().activeId!, "edited offline");
  expect(offline.getSnapshot().documents[0]).toMatchObject({
    text: "edited offline",
    conflict: false,
  });
  expect(request).not.toHaveBeenCalled();
  expect(setup().files.getSnapshot().documents[0].text).toBe("edited offline");
});
it("rejects malformed, oversized and unsupported recovery records", () => {
  const key = fileBufferKey("environment", "ws://localhost:4501");
  for (const raw of [
    "{",
    JSON.stringify({ version: 2, buffers: [] }),
    JSON.stringify({ version: 1, buffers: [{ path: "relative" }] }),
    "x".repeat(2 * 1024 * 1024 + 1),
  ]) {
    storage.set(key, raw);
    expect(readFileBuffers(key).buffers).toEqual([]);
    expect(readFileBuffers(key).error).toBeTruthy();
  }
});

function indexedRecovery() {
  const records = new Map<string, unknown>();
  let failWrite = false;
  const close = vi.fn();
  vi.stubGlobal("indexedDB", {
    open: () => {
      const request: Record<string, unknown> = {};
      const database = {
        close,
        transaction: () => {
          const transaction: Record<string, unknown> = {};
          const operation = (kind: string, key: string, value?: unknown) => {
            const operationRequest: Record<string, unknown> = {};
            Promise.resolve().then(() => {
              if (failWrite && kind !== "get") {
                transaction.error = new Error("QuotaExceededError");
                (transaction.onabort as () => void)?.();
                return;
              }
              if (kind === "put") records.set(key, structuredClone(value));
              if (kind === "delete") records.delete(key);
              operationRequest.result = records.get(key);
              (operationRequest.onsuccess as () => void)?.();
              (transaction.oncomplete as () => void)?.();
            });
            return operationRequest;
          };
          transaction.objectStore = () => ({
            get: (key: string) => operation("get", key),
            put: (value: unknown, key: string) => operation("put", key, value),
            delete: (key: string) => operation("delete", key),
          });
          return transaction;
        },
      };
      request.result = database;
      Promise.resolve().then(() => (request.onsuccess as () => void)?.());
      return request;
    },
  });
  return {
    records,
    close,
    failWrites: () => {
      failWrite = true;
    },
  };
}

it("persists large structured-clone buffers, isolates endpoints and deletes cleared copies", async () => {
  const db = indexedRecovery();
  const key = fileBufferKey("environment", "ws://localhost:4501");
  const buffer = {
    path: "/project/large.txt",
    text: "x".repeat(1024 * 1024 + 1),
    baseText: "baseline",
  };
  expect(await saveLargeFileBuffers(key, [buffer])).toBeUndefined();
  expect((await readLargeFileBuffers(key)).buffers).toEqual([buffer]);
  expect(
    (
      await readLargeFileBuffers(
        fileBufferKey("another", "ws://localhost:4501"),
      )
    ).buffers,
  ).toEqual([]);
  expect(await saveLargeFileBuffers(key, [])).toBeUndefined();
  expect((await readLargeFileBuffers(key)).buffers).toEqual([]);
  expect(db.close).toHaveBeenCalledTimes(5);
});

it("reports failed large writes and rejects malformed or oversized indexed records", async () => {
  const db = indexedRecovery();
  const buffer = {
    path: "/project/large.txt",
    text: "edited",
    baseText: "original",
  };
  db.failWrites();
  expect(await saveLargeFileBuffers("key", [buffer])).toContain("未能保存");
  db.records.set("key", {
    version: 1,
    buffers: [{ ...buffer, text: "x".repeat(MAX_RECOVERY_TEXT_LENGTH + 1) }],
  });
  expect(await readLargeFileBuffers("key")).toMatchObject({
    buffers: [],
    error: expect.stringContaining("无法读取"),
  });
  expect(
    await saveLargeFileBuffers("key", [{ ...buffer, path: "relative" }]),
  ).toContain("未能保存");
});

it("keeps small recovery usable without IndexedDB and warns when large recovery is unavailable", async () => {
  vi.stubGlobal("indexedDB", undefined);
  expect(await readLargeFileBuffers("key")).toEqual({ buffers: [] });
  expect(await saveLargeFileBuffers("key", [])).toBeUndefined();
  expect(
    await saveLargeFileBuffers("key", [
      { path: "/project/large.txt", text: "edited", baseText: "original" },
    ]),
  ).toContain("未能保存");
});

it("debounces large store drafts, restores them before opening and removes saved copies", async () => {
  const db = indexedRecovery();
  const original = "line\n".repeat(220_000);
  const first = setup("environment", "ws://localhost:4501", original);
  await first.files.open({ path: "/project/large.txt" });
  const id = first.files.getSnapshot().activeId!;
  first.files.setText(id, `first edit\n${original}`);
  first.files.setText(id, `last edit\n${original}`);
  expect(first.files.getSnapshot().recoveryPending).toBe(true);
  expect(db.records.size).toBe(0);
  await first.files.flushRecovery();
  expect(first.files.getSnapshot().recoveryPending).toBe(false);
  const fresh = setup("environment", "ws://localhost:4501", original);
  await fresh.files.open({ path: "/project/large.txt" });
  expect(fresh.files.getSnapshot().documents[0]).toMatchObject({
    text: `last edit\n${original}`,
    recovered: true,
    largeFile: true,
  });
  await fresh.files.save(id);
  expect(db.records.size).toBe(0);
  expect(fresh.files.getSnapshot().recoveryPending).toBe(false);
});

it("does not restore discarded large drafts even before asynchronous cleanup completes", async () => {
  indexedRecovery();
  const original = "line\n".repeat(220_000);
  const first = setup("environment", "ws://localhost:4501", original);
  await first.files.open({ path: "/project/large.txt" });
  const id = first.files.getSnapshot().activeId!;
  first.files.setText(id, `discarded\n${original}`);
  await first.files.flushRecovery();
  first.files.close(id);
  const fresh = setup("environment", "ws://localhost:4501", original);
  await fresh.files.open({ path: "/project/large.txt" });
  expect(fresh.files.getSnapshot().documents[0]).toMatchObject({
    text: original,
    dirty: false,
  });
});
