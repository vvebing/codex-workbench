import { describe, expect, it, vi } from "vitest";
import { readGitComparison } from "../../src/features/files/git-content";
import { DEFAULT_FILE_LIMITS } from "../../src/features/files/file-limits";
import type { RpcNotification } from "../../src/lib/rpc";
import type { CodexClient } from "../../src/lib/rpc";

function setup(xy = "MM", record = "1", path = "a.txt", previous?: string) {
  const original = "HEAD text\n",
    index = "index text\n",
    disk = "disk text\n";
  const oidHead = "a".repeat(40),
    oidIndex = "b".repeat(40);
  const status = `# branch.head main\0${record === "?" ? `? ${path}` : `${record} ${xy} N... 100644 100644 100644 a b ${record === "2" ? "R100 " : ""}${path}${previous ? `\0${previous}` : ""}`}\0`;
  const request = vi.fn(
    async (method: string, params: { command?: string[]; path?: string }) => {
      if (method === "fs/readFile") return { dataBase64: btoa(disk) };
      const args = params.command!;
      let stdout = "";
      if (args.includes("--show-toplevel")) stdout = "/repo\n";
      else if (args.includes("status")) stdout = status;
      else if (args.includes("--verify"))
        stdout = `${args.at(-1)!.startsWith("HEAD:") ? oidHead : oidIndex}\n`;
      else if (args.includes("-s"))
        stdout = `${Buffer.byteLength(args.at(-1) === oidHead ? original : index)}\n`;
      else if (args.includes("blob"))
        stdout = args.at(-1) === oidHead ? original : index;
      return { exitCode: 0, stdout, stderr: "" };
    },
  );
  return {
    client: { request } as unknown as Pick<CodexClient, "request">,
    request,
    original,
    index,
    disk,
  };
}

describe("Git editor comparison", () => {
  it("reads HEAD/index for staged and index/disk for unstaged without mixing drafts", async () => {
    const ctx = setup();
    const staged = await readGitComparison(ctx.client, {
      cwd: "/repo/subdir",
      path: "a.txt",
      group: "staged",
    });
    expect(staged.comparison.original).toBe(ctx.original);
    expect(staged.modified).toBe(ctx.index);
    expect(ctx.request.mock.calls.some(([m]) => m === "fs/readFile")).toBe(
      false,
    );
    const unstaged = await readGitComparison(ctx.client, {
      cwd: "/repo/subdir",
      path: "a.txt",
      group: "unstaged",
    });
    expect(unstaged.comparison.original).toBe(ctx.index);
    expect(unstaged.modified).toBe(ctx.disk);
    expect(unstaged.path).toBe("/repo/a.txt");
    expect(
      ctx.request.mock.calls
        .filter(([m]) => m === "command/exec")
        .every(
          ([, p]) =>
            (p as { sandboxPolicy?: { type: string } }).sandboxPolicy?.type ===
            "readOnly",
        ),
    ).toBe(true);
  });
  it("uses empty originals for additions and empty modified content for deletions", async () => {
    for (const group of ["staged", "untracked"] as const) {
      const ctx = setup("A.", group === "untracked" ? "?" : "1");
      const result = await readGitComparison(ctx.client, {
        cwd: "/repo",
        path: "a.txt",
        group,
      });
      expect(result.comparison.original).toBe("");
    }
    const ctx = setup("D.");
    const result = await readGitComparison(ctx.client, {
      cwd: "/repo",
      path: "a.txt",
      group: "staged",
    });
    expect(result.modified).toBe("");
    expect(result.comparison.canOpen).toBe(false);
  });
  it("reads a renamed file's HEAD from its original path with literal argv", async () => {
    const ctx = setup("R.", "2", "new name.txt", "old name.txt");
    await readGitComparison(ctx.client, {
      cwd: "/repo",
      path: "new name.txt",
      group: "staged",
    });
    expect(
      ctx.request.mock.calls.some(
        ([, p]) => p.command?.at(-1) === "HEAD:old name.txt",
      ),
    ).toBe(true);
    expect(
      ctx.request.mock.calls.some(
        ([, p]) => p.command?.at(-1) === ":new name.txt",
      ),
    ).toBe(true);
  });
  it("rejects stale status and stops reads when the connection changes", async () => {
    const ctx = setup(".M");
    await expect(
      readGitComparison(ctx.client, {
        cwd: "/repo",
        path: "a.txt",
        group: "staged",
      }),
    ).rejects.toThrow("状态已改变");
    ctx.request.mockClear();
    let checks = 0;
    await expect(
      readGitComparison(
        ctx.client,
        { cwd: "/repo", path: "a.txt", group: "unstaged" },
        () => {
          if (++checks === 2) throw new Error("连接变化");
        },
      ),
    ).rejects.toThrow("连接变化");
    expect(ctx.request).toHaveBeenCalledTimes(1);
  });
});

function streamSetup(
  original: Uint8Array,
  modified: Uint8Array,
  options: {
    declaredSize?: number;
    capReached?: boolean;
    stale?: boolean;
    chunkSize?: number;
  } = {},
) {
  const listeners = new Set<(notification: RpcNotification) => void>();
  const unsubscribe = vi.fn();
  const oid = "a".repeat(40);
  const status =
    "# branch.head main\0" + "1 .M N... 100644 100644 100644 a b a.txt\0";
  let current = true;
  const request = vi.fn(
    async (
      method: string,
      params: {
        command?: string[];
        processId?: string;
        streamStdoutStderr?: boolean;
        outputBytesCap?: number;
      },
    ) => {
      if (method === "command/exec/terminate") return {};
      if (method === "fs/readFile")
        return { dataBase64: Buffer.from(modified).toString("base64") };
      const args = params.command!;
      let stdout = "";
      if (args.includes("--show-toplevel")) stdout = "/repo\n";
      else if (args.includes("status")) stdout = status;
      else if (args.includes("--verify")) stdout = `${oid}\n`;
      else if (args.includes("-s"))
        stdout = `${options.declaredSize ?? original.length}\n`;
      else if (args.includes("blob")) {
        expect(params.streamStdoutStderr).toBe(true);
        const size = options.chunkSize ?? 32768;
        for (let offset = 0; offset < original.length; offset += size) {
          if (options.stale) current = false;
          for (const listener of listeners)
            listener({
              method: "command/exec/outputDelta",
              params: {
                processId: params.processId!,
                stream: "stdout",
                deltaBase64: Buffer.from(
                  original.subarray(offset, offset + size),
                ).toString("base64"),
                capReached: options.capReached ?? false,
              },
            });
        }
      }
      return { exitCode: 0, stdout, stderr: "" };
    },
  );
  const client = {
    request,
    onNotification: (listener: (notification: RpcNotification) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
  } as unknown as Pick<CodexClient, "request" | "onNotification">;
  const check = () => {
    if (!current) throw new Error("stale connection");
  };
  return { client, request, unsubscribe, listeners, check };
}
const comparisonRequest = {
  cwd: "/repo",
  path: "a.txt",
  group: "unstaged" as const,
};

describe("bounded Git diff reads", () => {
  it("streams complete UTF-8 blobs above 256KB including split multibyte sequences", async () => {
    const content = new TextEncoder().encode("中文\t\n".repeat(50000));
    const ctx = streamSetup(content, content, { chunkSize: 32767 });
    const result = await readGitComparison(
      ctx.client,
      comparisonRequest,
      ctx.check,
    );
    expect(result.comparison.original).toBe(new TextDecoder().decode(content));
    expect(result.modified).toBe(result.comparison.original);
    expect(ctx.unsubscribe).toHaveBeenCalledOnce();
    expect(ctx.listeners.size).toBe(0);
    expect(
      ctx.request.mock.calls.find(([, params]) =>
        params.command?.includes("blob"),
      )?.[1].outputBytesCap,
    ).toBe(DEFAULT_FILE_LIMITS.diffBytes + 1);
  });
  it("enforces the configured byte cap separately on both versions", async () => {
    const limits = { ...DEFAULT_FILE_LIMITS, diffBytes: 1024 * 1024 };
    const oversize = new Uint8Array(1024 * 1024 + 1).fill(97);
    const original = streamSetup(oversize, new TextEncoder().encode("small"));
    await expect(
      readGitComparison(
        original.client,
        comparisonRequest,
        original.check,
        limits,
      ),
    ).rejects.toThrow(/1 MB/);
    expect(
      original.request.mock.calls.some(([, params]) =>
        params.command?.includes("blob"),
      ),
    ).toBe(false);
    const modified = streamSetup(new TextEncoder().encode("small"), oversize);
    await expect(
      readGitComparison(
        modified.client,
        comparisonRequest,
        modified.check,
        limits,
      ),
    ).rejects.toThrow(/1 MB/);
    const multibyte = streamSetup(
      new TextEncoder().encode("small"),
      new TextEncoder().encode("中".repeat(400000)),
    );
    await expect(
      readGitComparison(
        multibyte.client,
        comparisonRequest,
        multibyte.check,
        limits,
      ),
    ).rejects.toThrow(/1 MB/);
  });
  it("rejects invalid UTF-8 and exact-byte cap overflow even when base64 lengths match", async () => {
    const invalid = streamSetup(new Uint8Array([255]), new Uint8Array([97]));
    await expect(
      readGitComparison(invalid.client, comparisonRequest),
    ).rejects.toThrow();
    expect(invalid.unsubscribe).toHaveBeenCalledOnce();
    const limit = 1024 * 1024;
    const ctx = streamSetup(
      new Uint8Array([97]),
      new Uint8Array(limit + 1).fill(97),
    );
    await expect(
      readGitComparison(ctx.client, comparisonRequest, ctx.check, {
        ...DEFAULT_FILE_LIMITS,
        diffBytes: limit,
      }),
    ).rejects.toThrow(/1 MB/);
  });
  it("rejects truncated or capped output and cleans up its subscription", async () => {
    for (const options of [{ declaredSize: 100 }, { capReached: true }]) {
      const ctx = streamSetup(
        new TextEncoder().encode("short"),
        new Uint8Array(),
        options,
      );
      await expect(
        readGitComparison(ctx.client, comparisonRequest),
      ).rejects.toThrow();
      expect(
        ctx.request.mock.calls.some(
          ([method]) => method === "command/exec/terminate",
        ),
      ).toBe(true);
      expect(ctx.unsubscribe).toHaveBeenCalledOnce();
      expect(ctx.listeners.size).toBe(0);
    }
  });
  it("terminates reads and unsubscribes when the connection changes during streaming", async () => {
    const ctx = streamSetup(
      new TextEncoder().encode("x".repeat(100000)),
      new Uint8Array(),
      { stale: true },
    );
    await expect(
      readGitComparison(ctx.client, comparisonRequest, ctx.check),
    ).rejects.toThrow("stale connection");
    expect(
      ctx.request.mock.calls.filter(
        ([method]) => method === "command/exec/terminate",
      ),
    ).toHaveLength(1);
    expect(ctx.unsubscribe).toHaveBeenCalledOnce();
    expect(
      ctx.request.mock.calls.some(([method]) => method === "fs/readFile"),
    ).toBe(false);
  });
});
