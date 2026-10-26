import { describe, expect, it, vi } from "vitest";
import type { CodexClient } from "../../src/lib/rpc";
import {
  availableName,
  encodeFile,
  transferName,
  uploadProjectFile,
  MAX_TRANSFER_BYTES,
} from "../../src/features/files/file-transfer";

describe("project file transfer", () => {
  it("keeps extensions when finding an available sibling name", () => {
    expect(
      availableName("report.csv", new Set(["report.csv", "report (1).csv"])),
    ).toBe("report (2).csv");
    expect(availableName(".env", new Set([".env"]))).toBe(".env (1)");
    for (const name of ["../a", "a/b", "a\\b", ".git", "..", ""])
      expect(() => transferName(name)).toThrow();
  });
  it("preserves binary bytes and rejects files before reading beyond the transfer cap", async () => {
    expect(
      await encodeFile(new File([new Uint8Array([0, 255, 128, 10])], "a.bin")),
    ).toBe("AP+ACg==");
    const file = {
      name: "large.bin",
      size: MAX_TRANSFER_BYTES + 1,
      arrayBuffer: vi.fn(),
    } as unknown as File;
    await expect(encodeFile(file)).rejects.toThrow("8 MB");
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });
  it("resolves collisions without overwriting and checks connection again before writing", async () => {
    const request = vi.fn().mockResolvedValue({
      entries: [{ fileName: "a.txt", isFile: true, isDirectory: false }],
    });
    const client = { request } as unknown as Pick<CodexClient, "request">;
    const conflict = vi.fn().mockResolvedValue("keep");
    expect(
      await uploadProjectFile(
        client,
        "/workspace",
        "docs",
        new File(["hello"], "a.txt"),
        conflict,
        () => {},
      ),
    ).toBe("docs/a (1).txt");
    expect(request).toHaveBeenLastCalledWith("fs/writeFile", {
      path: "/workspace/docs/a (1).txt",
      dataBase64: "aGVsbG8=",
    });
    request.mockClear();
    let checks = 0;
    await expect(
      uploadProjectFile(
        client,
        "/workspace",
        "",
        new File(["hello"], "a.txt"),
        conflict,
        () => {
          if (++checks === 3) throw new Error("changed");
        },
      ),
    ).rejects.toThrow("changed");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("skips cancelled uploads and refuses replacing directories", async () => {
    const request = vi.fn().mockResolvedValue({
      entries: [{ fileName: "a.txt", isFile: false, isDirectory: true }],
    });
    const client = { request } as unknown as Pick<CodexClient, "request">;
    expect(
      await uploadProjectFile(
        client,
        "/workspace",
        "",
        new File(["x"], "a.txt"),
        async () => "cancel",
        () => {},
      ),
    ).toBeUndefined();
    await expect(
      uploadProjectFile(
        client,
        "/workspace",
        "",
        new File(["x"], "a.txt"),
        async () => "replace",
        () => {},
      ),
    ).rejects.toThrow("目录");
    expect(
      request.mock.calls.every(([method]) => method === "fs/readDirectory"),
    ).toBe(true);
  });
});
