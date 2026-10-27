import { describe, expect, it, vi } from "vitest";
import {
  attachmentPath,
  projectFileDrop,
  resolveAttachmentHome,
  resolveAttachmentDirectory,
  saveAttachment,
} from "../../src/features/composer/file-attachments";

describe("composer file attachments", () => {
  it("places named files in an isolated home attachment directory", () => {
    expect(
      attachmentPath(
        "/home/mock user/.codex-workbench/attachments",
        "需求.pdf",
        "upload-id",
      ),
    ).toBe("/home/mock user/.codex-workbench/attachments/upload-id/需求.pdf");
    for (const name of [
      "../secret",
      "a/b",
      "a\\b",
      ".",
      "..",
      "",
      "a\u0000b",
      "C:secret",
    ]) {
      expect(() =>
        attachmentPath(
          "/home/mock user/.codex-workbench/attachments",
          name,
          "upload-id",
        ),
      ).toThrow();
    }
  });
  it("accepts matching project references and rejects cross-project or forged paths", () => {
    const item = {
      cwd: "/workspace",
      relative: "src/a.ts",
      path: "/workspace/src/a.ts",
    };
    expect(projectFileDrop(JSON.stringify(item), "/workspace")).toEqual({
      relative: "src/a.ts",
      path: "/workspace/src/a.ts",
    });
    expect(() => projectFileDrop(JSON.stringify(item), "/other")).toThrow(
      "当前项目",
    );
    expect(() =>
      projectFileDrop(
        JSON.stringify({ ...item, path: "/etc/passwd" }),
        "/workspace",
      ),
    ).toThrow("路径");
    expect(() =>
      projectFileDrop(
        JSON.stringify({ ...item, relative: "../secret" }),
        "/workspace",
      ),
    ).toThrow();
  });
});

it("resolves the execution host home without inferring it from project or CODEX_HOME", async () => {
  const request = vi.fn().mockResolvedValue({
    stdout: "/home/remote user",
    stderr: "",
    exitCode: 0,
  });
  const client = { request, platformFamily: "unix" } as unknown as Pick<
    import("../../src/lib/rpc").CodexClient,
    "request" | "platformFamily"
  >;
  expect(await resolveAttachmentHome(client, () => true)).toBe(
    "/home/remote user",
  );
  expect(request).toHaveBeenCalledWith(
    "command/exec",
    expect.objectContaining({
      command: ["sh", "-c", 'test -n "$HOME" && printf \'%s\' "$HOME"'],
      sandboxPolicy: { type: "readOnly", networkAccess: false },
    }),
  );
  expect(
    attachmentPath(
      "C:\\Users\\Remote User\\.codex-workbench\\attachments",
      "a.txt",
      "id",
    ),
  ).toBe("C:/Users/Remote User/.codex-workbench/attachments/id/a.txt");
  request.mockResolvedValueOnce({
    stdout: "C:\\Users\\Remote User",
    stderr: "",
    exitCode: 0,
  });
  expect(
    await resolveAttachmentHome(
      { ...client, platformFamily: "windows" },
      () => true,
    ),
  ).toBe("C:\\Users\\Remote User");
  expect(request.mock.calls.at(-1)?.[1].command[0]).toBe("powershell.exe");
});

it("rejects unavailable or relative homes and stops on connection changes", async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ stdout: "relative", exitCode: 0 });
  const client = { request, platformFamily: null } as unknown as Pick<
    import("../../src/lib/rpc").CodexClient,
    "request" | "platformFamily"
  >;
  await expect(resolveAttachmentHome(client, () => true)).rejects.toThrow();
  request.mockResolvedValue({ stdout: "", exitCode: 1 });
  await expect(resolveAttachmentHome(client, () => true)).rejects.toThrow();
  request.mockResolvedValue({ stdout: "/home/remote", exitCode: 0 });
  let checks = 0;
  await expect(
    resolveAttachmentHome(client, () => ++checks === 1),
  ).rejects.toThrow();
  expect(
    request.mock.calls.every(([method]) => method === "command/exec"),
  ).toBe(true);
});

it("preserves attachment bytes under home and never writes into a project", async () => {
  const request = vi.fn().mockResolvedValue({});
  const client = { request } as unknown as Pick<
    import("../../src/lib/rpc").CodexClient,
    "request"
  >;
  const file = new File([new Uint8Array([0, 255, 128])], "binary.dat");
  const path = await saveAttachment(
    client,
    "/home/remote user/.codex-workbench/attachments",
    file,
    () => true,
    "AP+A",
  );
  expect(path).toMatch(
    /^\/home\/remote user\/\.codex-workbench\/attachments\/[^/]+\/binary.dat$/,
  );
  expect(request).toHaveBeenLastCalledWith("fs/writeFile", {
    path,
    dataBase64: "AP+A",
  });
  request.mockClear();
  let checks = 0;
  await expect(
    saveAttachment(client, "/home/remote", file, () => ++checks === 1, "AP+A"),
  ).rejects.toThrow();
  expect(request.mock.calls.map(([method]) => method)).toEqual([
    "fs/createDirectory",
  ]);
});

it("expands configured home paths on the host and accepts absolute directories without a shell lookup", async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ stdout: "/home/remote user", exitCode: 0 });
  const client = { request, platformFamily: "unix" } as unknown as Pick<
    import("../../src/lib/rpc").CodexClient,
    "request" | "platformFamily"
  >;
  expect(
    await resolveAttachmentDirectory(client, "~/custom uploads", () => true),
  ).toBe("/home/remote user/custom uploads");
  request.mockClear();
  expect(
    await resolveAttachmentDirectory(client, "/var/attachments", () => true),
  ).toBe("/var/attachments");
  expect(request).not.toHaveBeenCalled();
  await expect(
    resolveAttachmentDirectory(client, "C:/uploads", () => true),
  ).rejects.toThrow();
  await expect(
    resolveAttachmentDirectory(
      { ...client, platformFamily: "windows" },
      "/tmp/uploads",
      () => true,
    ),
  ).rejects.toThrow();
  expect(
    await resolveAttachmentDirectory(
      { ...client, platformFamily: "windows" },
      "C:\\Uploads",
      () => true,
    ),
  ).toBe("C:/Uploads");
});
