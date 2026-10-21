import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileWorkspaceStore } from "../../src/features/files/store";
import {
  fileBufferKey,
  readFileBuffers,
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
