import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileWorkspaceStore } from "../../src/features/files/store";
import type { ConnectionStore } from "../../src/features/connection/store";

function setup(text = "original") {
  let state = { url: "ws://a", epoch: 1, scope: 1, status: "connected" };
  const listeners = new Set<() => void>();
  const disk = new Map([
    ["ws://a:/work/a.txt", text],
    ["ws://b:/work/a.txt", "other"],
  ]);
  const request = vi.fn(
    async (method: string, params: Record<string, string>) => {
      const key = `${state.url}:${params.path}`;
      if (method === "fs/readFile")
        return {
          dataBase64: btoa(unescape(encodeURIComponent(disk.get(key)!))),
        };
      if (method === "fs/writeFile") {
        disk.set(key, decodeURIComponent(escape(atob(params.dataBase64))));
        return {};
      }
      if (method === "fs/getMetadata") {
        if (!disk.has(key)) throw new Error("ENOENT");
        return {};
      }
      return {};
    },
  );
  const connection = {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    client: { request, onNotification: () => () => {} },
  } as unknown as ConnectionStore;
  const files = new FileWorkspaceStore(connection);
  return {
    files,
    disk,
    request,
    setStatus: (status: string) => {
      state = { ...state, status };
      listeners.forEach((listener) => listener());
    },
    switchTo: (url: string) => {
      state = { ...state, url, epoch: state.epoch + 1, scope: state.scope + 1 };
      listeners.forEach((listener) => listener());
    },
  };
}
describe("file workspace", () => {
  it("previews binary images without decoding text or permitting writes", async () => {
    const { files, request } = setup();
    const data = btoa("\x89PNG\r\n\x1a\n" + "a".repeat(300 * 1024));
    request.mockImplementation(async () => ({ dataBase64: data }));
    await files.open({ path: "/work/screenshot.PNG" });
    const doc = files.getSnapshot().documents[0];
    expect(doc).toMatchObject({
      kind: "image",
      readonly: true,
      loading: false,
      text: "",
    });
    expect(doc.imageUrl).toBe(`data:image/png;base64,${data}`);
    expect(doc.error).toBeUndefined();
    files.setText(doc.id, "overwrite");
    await files.save(doc.id);
    expect(files.getSnapshot().documents[0].dirty).toBe(false);
    expect(
      request.mock.calls.some(([method]) => method === "fs/writeFile"),
    ).toBe(false);
    request.mockImplementation(async () => ({ dataBase64: btoa("invalid") }));
    await files.reload(doc.id);
    expect(files.getSnapshot().documents[0]).toMatchObject({
      readonly: true,
      error: "图片格式无法识别。",
      imageUrl: undefined,
    });
  });
  beforeEach(() =>
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }),
  );
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  it("shares buffers across threads and keeps endpoint drafts isolated", async () => {
    const { files, switchTo } = setup();
    await files.open({ path: "/work/a.txt", threadId: "one" });
    const id = files.getSnapshot().activeId!;
    files.setText(id, "draft");
    await files.open({ path: "a.txt", cwd: "/work", threadId: "two" });
    expect(files.getSnapshot().documents).toHaveLength(1);
    switchTo("ws://b");
    await files.open({ path: "/work/a.txt" });
    expect(files.getSnapshot().documents[0].text).toBe("other");
    await expect(files.save(id)).rejects.toThrow("连接");
    switchTo("ws://a");
    expect(files.getSnapshot().documents[0].text).toBe("draft");
    expect(files.hasDirty()).toBe(true);
  });
  it("refuses external conflicts and dirty directory deletion", async () => {
    const { files, disk, request } = setup();
    await files.open({ path: "/work/a.txt" });
    const id = files.getSnapshot().activeId!;
    files.setText(id, "draft");
    disk.set("ws://a:/work/a.txt", "external");
    await files.save(id);
    expect(files.getSnapshot().documents[0]).toMatchObject({
      conflict: true,
      text: "draft",
      diskText: "external",
    });
    expect(
      request.mock.calls.some(([method]) => method === "fs/writeFile"),
    ).toBe(false);
    await expect(files.remove("/work", true)).rejects.toThrow();
  });
  it("preserves BOM and CRLF and rejects existing create destinations", async () => {
    const { files, disk } = setup("\ufeffa\r\nb\r\n");
    await files.open({ path: "/work/a.txt" });
    const id = files.getSnapshot().activeId!;
    files.setText(id, "a\nc\n");
    await files.save(id);
    expect(disk.get("ws://a:/work/a.txt")).toBe("\ufeffa\r\nc\r\n");
    await expect(files.createFile("/work/a.txt", "oops")).rejects.toThrow(
      "已存在",
    );
  });
  it("preserves the draft and disk when the host rejects a read-only filesystem write", async () => {
    const { files, request, disk } = setup();
    await files.open({ path: "/work/a.txt" });
    const id = files.getSnapshot().activeId!;
    files.setText(id, "draft");
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (method, params) => {
      if (method === "fs/writeFile")
        throw new Error("Read-only file system (os error 30)");
      return original(method, params);
    });
    await files.save(id);
    expect(files.getSnapshot().documents[0]).toMatchObject({
      text: "draft",
      dirty: true,
      saving: false,
      error: "Read-only file system (os error 30)",
    });
    expect(disk.get("ws://a:/work/a.txt")).toBe("original");
  });
  it("does not retry a write with unknown outcome", async () => {
    const { files, request } = setup();
    await files.open({ path: "/work/a.txt" });
    const id = files.getSnapshot().activeId!;
    files.setText(id, "draft");
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (method, params) => {
      if (method === "fs/writeFile") throw new Error("timeout");
      return original(method, params);
    });
    await files.save(id);
    await files.save(id);
    expect(
      request.mock.calls.filter(([method]) => method === "fs/writeFile"),
    ).toHaveLength(1);
    expect(files.getSnapshot().documents[0].dirty).toBe(true);
  });
  it("does not issue a write when the endpoint changes during the save preflight", async () => {
    const { files, request, switchTo } = setup();
    await files.open({ path: "/work/a.txt" });
    const id = files.getSnapshot().activeId!;
    files.setText(id, "draft");
    let resolve!: (value: { dataBase64: string }) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const saving = files.save(id);
    switchTo("ws://b");
    resolve({ dataBase64: btoa("original") });
    await saving;
    expect(
      request.mock.calls.some(([method]) => method === "fs/writeFile"),
    ).toBe(false);
    expect(files.hasDirty()).toBe(true);
  });
  it("keeps edits typed during a save dirty after the earlier text is saved", async () => {
    const { files, request } = setup();
    await files.open({ path: "/work/a.txt" });
    const id = files.getSnapshot().activeId!;
    files.setText(id, "first");
    const original = request.getMockImplementation()!;
    let resolve!: (value: object) => void;
    request.mockImplementation(async (method, params) => {
      if (method === "fs/writeFile")
        return new Promise((done) => {
          resolve = done;
        });
      return original(method, params);
    });
    const saving = files.save(id);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    files.setText(id, "second");
    resolve({});
    await saving;
    expect(files.getSnapshot().documents[0]).toMatchObject({
      text: "second",
      baseText: "first",
      dirty: true,
    });
  });
  it("ignores a closed tab's delayed read after reopening the same path", async () => {
    const { files, request, disk } = setup();
    let finish!: (value: { dataBase64: string }) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const opening = files.open({ path: "/work/a.txt" });
    const id = files.getSnapshot().activeId!;
    files.close(id);
    disk.set("ws://a:/work/a.txt", "new contents");
    await files.open({ path: "/work/a.txt" });
    finish({ dataBase64: btoa("old contents") });
    await opening;
    expect(files.getSnapshot().documents[0].text).toBe("new contents");
    expect(
      request.mock.calls.filter(([method]) => method === "fs/watch"),
    ).toHaveLength(1);
  });
  it("does not register a watcher after closing a pending open or while disconnected", async () => {
    const { files, request, setStatus } = setup();
    let finish!: (value: { dataBase64: string }) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const opening = files.open({ path: "/work/a.txt" });
    files.close(files.getSnapshot().activeId!);
    finish({ dataBase64: btoa("original") });
    await opening;
    expect(vi.getTimerCount()).toBe(0);
    setStatus("disconnected");
    await files.open({ path: "/work/a.txt" });
    expect(vi.getTimerCount()).toBe(0);
    expect(request.mock.calls.some(([method]) => method === "fs/watch")).toBe(
      false,
    );
    setStatus("connected");
    await vi.waitFor(() =>
      expect(files.getSnapshot().documents[0].text).toBe("original"),
    );
    expect(vi.getTimerCount()).toBe(1);
  });
  it("preserves edits made while deletion is pending and blocks saves until it settles", async () => {
    const { files, request } = setup();
    await files.open({ path: "/work/a.txt" });
    const id = files.getSnapshot().activeId!;
    let finish!: (value: object) => void;
    const original = request.getMockImplementation()!;
    request.mockImplementation((method, params) =>
      method === "fs/remove"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : original(method, params),
    );
    const removing = files.remove("/work", true);
    files.setText(id, "keep this draft");
    await files.save(id);
    expect(
      request.mock.calls.some(([method]) => method === "fs/writeFile"),
    ).toBe(false);
    finish({});
    await removing;
    expect(files.getSnapshot().documents[0]).toMatchObject({
      text: "keep this draft",
      dirty: true,
      conflict: true,
    });
  });
  it("does not let polling replace an explicit reload or permit a save during reload", async () => {
    const { files, request } = setup();
    await files.open({ path: "/work/a.txt" });
    const id = files.getSnapshot().activeId!;
    files.setText(id, "draft");
    let finish!: (value: { dataBase64: string }) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const loading = files.reload(id);
    vi.advanceTimersByTime(5000);
    await files.save(id);
    finish({ dataBase64: btoa("reloaded") });
    await loading;
    expect(files.getSnapshot().documents[0]).toMatchObject({
      text: "reloaded",
      dirty: false,
      loading: false,
    });
    expect(
      request.mock.calls.filter(([method]) => method === "fs/readFile"),
    ).toHaveLength(2);
    expect(
      request.mock.calls.some(([method]) => method === "fs/writeFile"),
    ).toBe(false);
  });
  it("refreshes after a connection change while the original open is pending", async () => {
    const { files, request, switchTo } = setup();
    let finish!: (value: { dataBase64: string }) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const opening = files.open({ path: "/work/a.txt" });
    switchTo("ws://b");
    switchTo("ws://a");
    await vi.waitFor(() =>
      expect(files.getSnapshot().documents[0].text).toBe("original"),
    );
    finish({ dataBase64: btoa("stale") });
    await opening;
    expect(files.getSnapshot().documents[0]).toMatchObject({
      text: "original",
      loading: false,
      readonly: false,
    });
  });
  it("invalidates a background read before saving so stale disk text cannot replace the saved buffer", async () => {
    const { files, request } = setup();
    await files.open({ path: "/work/a.txt" });
    const id = files.getSnapshot().activeId!;
    let finish!: (value: { dataBase64: string }) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.advanceTimersByTime(5000);
    files.setText(id, "saved draft");
    const saving = files.save(id);
    expect(
      request.mock.calls.filter(([method]) => method === "fs/readFile"),
    ).toHaveLength(2);
    finish({ dataBase64: btoa("old disk text") });
    await saving;
    await Promise.resolve();
    await Promise.resolve();
    expect(files.getSnapshot().documents[0]).toMatchObject({
      text: "saved draft",
      baseText: "saved draft",
      dirty: false,
      conflict: false,
    });
  });
  it("merges invalidations during a slow read and publishes no unchanged buffers", async () => {
    const { files, request } = setup();
    await files.open({ path: "/work/a.txt" });
    const listener = vi.fn();
    files.subscribe(listener);
    let finish!: (value: { dataBase64: string }) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.advanceTimersByTime(5000);
    files.validateActive();
    files.validateActive();
    vi.advanceTimersByTime(15000);
    expect(
      request.mock.calls.filter(([method]) => method === "fs/readFile"),
    ).toHaveLength(2);
    finish({ dataBase64: btoa("original") });
    await vi.waitFor(() =>
      expect(
        request.mock.calls.filter(([method]) => method === "fs/readFile"),
      ).toHaveLength(3),
    );
    expect(listener).not.toHaveBeenCalled();
  });
  it("reduces hidden panel polling and pauses hidden page reads until focus validation", async () => {
    const { files, request } = setup();
    await files.open({ path: "/work/a.txt" });
    files.setVisible(false);
    vi.advanceTimersByTime(55000);
    expect(
      request.mock.calls.filter(([method]) => method === "fs/readFile"),
    ).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    await Promise.resolve();
    await Promise.resolve();
    expect(
      request.mock.calls.filter(([method]) => method === "fs/readFile"),
    ).toHaveLength(2);
    files.setPageVisible(false);
    vi.advanceTimersByTime(120000);
    expect(
      request.mock.calls.filter(([method]) => method === "fs/readFile"),
    ).toHaveLength(2);
    files.setVisible(true);
    files.setPageVisible(true);
    await vi.waitFor(() =>
      expect(
        request.mock.calls.filter(([method]) => method === "fs/readFile"),
      ).toHaveLength(3),
    );
  });
  it("slows background environments and validates when returning to the foreground", async () => {
    const { files, request } = setup();
    await files.open({ path: "/work/a.txt" });
    files.setForeground(false);
    vi.advanceTimersByTime(55000);
    expect(
      request.mock.calls.filter(([method]) => method === "fs/readFile"),
    ).toHaveLength(1);
    files.setForeground(true);
    await vi.waitFor(() =>
      expect(
        request.mock.calls.filter(([method]) => method === "fs/readFile"),
      ).toHaveLength(2),
    );
  });
  it("recovers unchanged text and image snapshots after a failed refresh", async () => {
    for (const image of [false, true]) {
      const { files, request } = setup();
      const data = image ? btoa("\x89PNG\r\n\x1a\nimage") : btoa("original");
      request.mockImplementation(async () => ({ dataBase64: data }));
      await files.open({ path: image ? "/work/image.png" : "/work/a.txt" });
      request.mockRejectedValueOnce(new Error("temporary read failure"));
      files.validateActive();
      await vi.waitFor(() =>
        expect(files.getSnapshot().documents[0].error).toBeDefined(),
      );
      files.validateActive();
      await vi.waitFor(() =>
        expect(files.getSnapshot().documents[0].error).toBeUndefined(),
      );
      const document = files.getSnapshot().documents[0];
      expect(document.readonly).toBe(image);
      if (image)
        expect(document.imageUrl).toBe(`data:image/png;base64,${data}`);
      else expect(document.text).toBe("original");
    }
  });
  it("adopts changed disk text after a conflicted draft returns to its clean base", async () => {
    const { files, disk } = setup();
    await files.open({ path: "/work/a.txt" });
    const id = files.getSnapshot().activeId!;
    files.setText(id, "draft");
    disk.set("ws://a:/work/a.txt", "external");
    files.validateActive();
    await vi.waitFor(() =>
      expect(files.getSnapshot().documents[0].diskText).toBe("external"),
    );
    files.setText(id, "original");
    files.validateActive();
    await vi.waitFor(() =>
      expect(files.getSnapshot().documents[0].text).toBe("external"),
    );
    expect(files.getSnapshot().documents[0]).toMatchObject({
      dirty: false,
      conflict: false,
      diskText: undefined,
    });
  });
  it("treats symlink metadata as an existing destination and preserves native errors", async () => {
    const { files, request } = setup();
    request.mockImplementationOnce(async () => ({
      dataBase64: undefined,
      isSymlink: true,
      isFile: false,
      isDirectory: false,
    }));
    await expect(files.createFile("/work/link")).rejects.toThrow("已存在");
    request.mockRejectedValueOnce(new Error("Permission denied (os error 13)"));
    await expect(files.createFile("/work/private")).rejects.toThrow(
      "Permission denied",
    );
    request.mockRejectedValueOnce(
      new Error("No such file or directory (os error 2)"),
    );
    await files.createFile("/work/new");
    expect(
      request.mock.calls.filter(([method]) => method === "fs/writeFile"),
    ).toHaveLength(1);
  });
  it("prevents concurrent management requests from bypassing the destination check", async () => {
    const { files, request } = setup();
    let missing!: (reason: Error) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          missing = reject;
        }),
    );
    const first = files.createFile("/work/new", "first");
    await expect(files.createFile("/work/new", "second")).rejects.toThrow(
      "正在执行",
    );
    missing(new Error("ENOENT"));
    await first;
    expect(
      request.mock.calls.filter(([method]) => method === "fs/writeFile"),
    ).toHaveLength(1);
    await expect(files.createFile("/work/new", "third")).rejects.toThrow(
      "已存在",
    );
  });
});
