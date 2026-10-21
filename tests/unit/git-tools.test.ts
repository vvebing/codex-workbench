import { describe, expect, it, vi } from "vitest";
import { GitTools } from "../../src/features/shell/git-tools";
import type { CommandExecResponse } from "../../src/generated/v2/CommandExecResponse";

const success = (stdout = ""): CommandExecResponse => ({
  stdout,
  stderr: "",
  exitCode: 0,
});

describe("read-only Git tools", () => {
  it.each([false, true])(
    "exports the exact patch with cached=%s and a read-only, offline argv",
    async (cached) => {
      const patch = "diff --git a/a.bin b/a.bin\nGIT binary patch\n";
      const execute = vi.fn(async () => success(patch));
      const tools = new GitTools("/repo with spaces", execute);
      await expect(tools.patch(cached)).resolves.toBe(patch);
      expect(execute).toHaveBeenCalledExactlyOnceWith({
        command: [
          "git",
          "--no-optional-locks",
          "diff",
          ...(cached ? ["--cached"] : []),
          "--binary",
          "--no-ext-diff",
          "--no-textconv",
          "--no-color",
        ],
        cwd: "/repo with spaces",
        timeoutMs: 30_000,
        disableOutputCap: true,
        sandboxPolicy: { type: "readOnly", networkAccess: false },
      });
    },
  );

  it("reads existing worktrees from NUL-delimited porcelain without losing spaces or newlines", async () => {
    const execute = vi.fn(async () =>
      success(
        "worktree /repo\0HEAD abc\0branch refs/heads/main\0\0worktree /repo with spaces\0HEAD def\0detached\0\0worktree /repo\nnewline\0bare\0\0",
      ),
    );
    await expect(new GitTools("/repo", execute).worktrees()).resolves.toEqual([
      "/repo",
      "/repo with spaces",
      "/repo\nnewline",
    ]);
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      command: [
        "git",
        "--no-optional-locks",
        "worktree",
        "list",
        "--porcelain",
        "-z",
      ],
      cwd: "/repo",
      timeoutMs: 30_000,
      disableOutputCap: true,
      sandboxPolicy: { type: "readOnly", networkAccess: false },
    });
  });

  it("returns no worktrees for empty output", async () => {
    await expect(
      new GitTools("/repo", async () => success()).worktrees(),
    ).resolves.toEqual([]);
  });

  it.each(["patch", "worktrees"] as const)(
    "does not execute %s after connection identity changes",
    async (action) => {
      const execute = vi.fn(async () => success());
      const tools = new GitTools("/repo", execute, () => false);
      await expect(
        action === "patch" ? tools.patch(false) : tools.worktrees(),
      ).rejects.toThrow("目标环境已改变");
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it.each(["patch", "worktrees"] as const)(
    "rejects a late %s response after connection identity changes",
    async (action) => {
      let current = true;
      let complete!: (response: CommandExecResponse) => void;
      const execute = vi.fn(
        () =>
          new Promise<CommandExecResponse>((resolve) => {
            complete = resolve;
          }),
      );
      const tools = new GitTools("/repo", execute, () => current);
      const pending =
        action === "patch" ? tools.patch(false) : tools.worktrees();
      current = false;
      complete(success("worktree /stale\0\0"));
      await expect(pending).rejects.toThrow("目标环境已改变");
      expect(execute).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["Git failed", ""])(
    "surfaces failed reads without returning partial stdout (%s)",
    async (stderr) => {
      const tools = new GitTools("/repo", async () => ({
        stdout: "partial patch",
        stderr,
        exitCode: 1,
      }));
      await expect(tools.patch(false)).rejects.toThrow(
        stderr || "无法读取 Git 工作区",
      );
    },
  );
});
