import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileWorkspaceStore } from "../../src/features/files/store";
import {
  fileTextInfo,
  isLargeFile,
  MAX_FILE_BYTES,
  MAX_EDITABLE_FILE_BYTES,
  MAX_NORMAL_FILE_BYTES,
} from "../../src/features/files/file-limits";
import type { ConnectionStore } from "../../src/features/connection/store";

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("indexedDB", undefined);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup(text: string) {
  const request = vi.fn(
    async (method: string, params: { dataBase64?: string }) => {
      if (method === "fs/readFile")
        return { dataBase64: Buffer.from(text).toString("base64") };
      if (method === "fs/writeFile")
        text = Buffer.from(params.dataBase64!, "base64").toString("utf8");
      return {};
    },
  );
  const connection = {
    getSnapshot: () => ({
      url: "ws://large",
      epoch: 1,
      scope: 1,
      status: "connected",
    }),
    subscribe: () => () => {},
    client: { request, onNotification: () => () => {} },
  } as unknown as ConnectionStore;
  return { files: new FileWorkspaceStore(connection), request };
}
it("classifies UTF-8 bytes and dense or very long line files", () => {
  expect(fileTextInfo("中").byteLength).toBe(3);
  expect(isLargeFile("normal\ntext")).toBe(false);
  expect(isLargeFile("x".repeat(20_001))).toBe(true);
  expect(isLargeFile("\n".repeat(20_000))).toBe(true);
  expect(isLargeFile("text", MAX_NORMAL_FILE_BYTES)).toBe(false);
  expect(isLargeFile("text", MAX_NORMAL_FILE_BYTES + 1)).toBe(true);
});
it.each([
  [MAX_EDITABLE_FILE_BYTES, false],
  [MAX_EDITABLE_FILE_BYTES + 1, true],
  [MAX_FILE_BYTES, true],
])(
  "opens %i bytes with readonly=%s without truncation",
  async (size, readonly) => {
    const text = "x".repeat(size);
    const { files, request } = setup(text);
    await files.open({ path: "/work/large.txt" });
    const doc = files.getSnapshot().documents[0];
    expect(doc).toMatchObject({
      byteLength: size,
      largeFile: true,
      readonly,
    });
    expect(doc.error).toBeUndefined();
    expect(doc.text).toBe(text);
    if (readonly) {
      files.setText(doc.id, "overwrite");
      await files.save(doc.id);
      expect(files.getSnapshot().documents[0].text).toBe(text);
      expect(
        request.mock.calls.some(([method]) => method === "fs/writeFile"),
      ).toBe(false);
    }
  },
);
it("rejects files above eight MB without exposing partial contents", async () => {
  const { files } = setup("x".repeat(MAX_FILE_BYTES + 1));
  await files.open({ path: "/work/too-large.txt" });
  expect(files.getSnapshot().documents[0]).toMatchObject({
    text: "",
    readonly: true,
    error: expect.stringContaining("8 MB"),
  });
});
it("preserves oversized edits for undo but blocks writes until reduced", async () => {
  const { files, request } = setup("original");
  await files.open({ path: "/work/edit.txt" });
  const id = files.getSnapshot().activeId!;
  const oversized = "中".repeat(Math.floor(MAX_EDITABLE_FILE_BYTES / 3) + 1);
  files.setText(id, oversized);
  await files.save(id);
  expect(files.getSnapshot().documents[0]).toMatchObject({
    text: oversized,
    readonly: false,
    error: expect.stringContaining("5 MB"),
  });
  expect(request.mock.calls.some(([method]) => method === "fs/writeFile")).toBe(
    false,
  );
  files.setText(id, "reduced");
  await files.save(id);
  expect(files.getSnapshot().documents[0]).toMatchObject({
    text: "reduced",
    dirty: false,
    error: undefined,
  });
});
