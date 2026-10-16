import { describe, expect, it, vi } from "vitest";
import { readGitComparison } from "../../src/features/files/git-content";
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
      else if (args.includes("-s")) stdout = "12\n";
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
