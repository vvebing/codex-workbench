import { describe, expect, it, vi } from "vitest";
import {
  gitStatusCommand,
  parseGitStatus,
  readGitStatus,
} from "../../src/features/shell/git-status";
import type { CodexClient } from "../../src/lib/rpc";
import type { CommandExecResponse } from "../../src/generated/v2/CommandExecResponse";

const header = "# branch.oid (initial)\0# branch.head main\0";
const changed = (path: string, xy = ".M") =>
  `1 ${xy} N... 100644 100644 100644 abc def ${path}\0`;
const renamed = (path: string, original: string) =>
  `2 R. N... 100644 100644 100644 abc def R100 ${path}\0${original}\0`;
const conflicted = (path: string) =>
  `u UU N... 100644 100644 100644 100644 abc def ghi ${path}\0`;
const response = (stdout = header, exitCode = 0): CommandExecResponse => ({
  stdout,
  exitCode,
  stderr: "",
});

describe("Git porcelain v2 status", () => {
  it("counts staged, unstaged, both, conflicted and individual untracked files", () => {
    expect(
      parseGitStatus(
        header +
          changed("staged.ts", "M.") +
          changed("unstaged.ts") +
          changed("both.ts", "MM") +
          conflicted("conflict.ts") +
          "? new/a.ts\0? new/b.ts\0",
      ),
    ).toEqual({ branch: "main", changedFiles: 6 });
  });

  it("counts each rename once and skips its original path regardless of its prefix", () => {
    expect(
      parseGitStatus(
        header +
          renamed("new name\nfile.ts", "? original.ts") +
          renamed("other.ts", "# branch.head fake") +
          changed("real.ts"),
      ),
    ).toEqual({ branch: "main", changedFiles: 3 });
  });

  it("handles spaces, newlines, Unicode, tabs and record-like text in file names", () => {
    expect(
      parseGitStatus(
        header +
          changed("目录/a b\n? next\tfile.ts") +
          "? # branch.head fake\nname.ts\0! ignored name\0",
      ),
    ).toEqual({ branch: "main", changedFiles: 2 });
  });

  it("accepts additional branch headers, clean and unborn repositories, and detached HEAD", () => {
    expect(parseGitStatus(header)).toEqual({ branch: "main", changedFiles: 0 });
    expect(
      parseGitStatus(header + "# branch.upstream origin/main\0# future data\0"),
    ).toEqual({ branch: "main", changedFiles: 0 });
    expect(parseGitStatus("# branch.head (detached)\0")).toEqual({
      branch: "HEAD",
      changedFiles: 0,
    });
  });

  it("rejects incomplete, malformed, empty and non-porcelain output instead of reporting zero", () => {
    for (const output of [
      "",
      "fatal: not a git repository",
      "# branch.head main",
      changed("missing-branch.ts"),
      "# branch.head \0",
      header + "1 .M incomplete\0",
      header + "2 R. N... 100644 100644 100644 abc def R100 target\0",
      header + "? \0",
      header + "unexpected record\0",
      header + "\0",
    ])
      expect(() => parseGitStatus(output)).toThrow();
  });
});

describe("app-server Git status query", () => {
  it("uses buffered read-only argv execution with a bounded timeout and complete output", () => {
    expect(gitStatusCommand("/demo/workspace")).toEqual({
      command: [
        "git",
        "--no-optional-locks",
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
        "--untracked-files=all",
      ],
      cwd: "/demo/workspace",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      timeoutMs: 5000,
      disableOutputCap: true,
    });
  });

  it("rejects Git failures and unsupported command execution", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response("", 128))
      .mockRejectedValueOnce(new Error("Unsupported method"));
    const client = { request } as unknown as Pick<CodexClient, "request">;
    await expect(readGitStatus(client, "/demo/workspace")).rejects.toThrow();
    await expect(readGitStatus(client, "/demo/workspace")).rejects.toThrow();
  });

  it("serializes workspace switches and discards the old response", async () => {
    let finish!: (value: CommandExecResponse) => void;
    let active = true;
    const request = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<CommandExecResponse>((resolve) => (finish = resolve)),
      )
      .mockResolvedValueOnce(response(header + "? new.ts\0"));
    const client = { request } as unknown as Pick<CodexClient, "request">;
    const old = readGitStatus(client, "/demo/old", () => active);
    await Promise.resolve();
    active = false;
    const next = readGitStatus(client, "/demo/next");
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    finish(response(header + changed("old.ts")));
    expect(await old).toBeNull();
    expect(await next).toEqual({ branch: "main", changedFiles: 1 });
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      "command/exec",
      "command/exec",
    ]);
    expect(request.mock.calls[1][1].cwd).toBe("/demo/next");
  });

  it("skips work cancelled before a queued query starts", async () => {
    let finish!: (value: CommandExecResponse) => void;
    let active = true;
    const request = vi.fn(
      () => new Promise<CommandExecResponse>((resolve) => (finish = resolve)),
    );
    const client = { request } as unknown as Pick<CodexClient, "request">;
    const first = readGitStatus(client, "/demo/first");
    await Promise.resolve();
    const cancelled = readGitStatus(client, "/demo/cancelled", () => active);
    active = false;
    finish(response());
    await first;
    expect(await cancelled).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });
});

// Workspace paths must remain literal, including rename source paths and spaces.
describe("workspace Git file details", () => {
  it("preserves paths and puts a file modified in both places in both groups", async () => {
    const { parseWorkspaceGitStatus } =
      await import("../../src/features/shell/git-status");
    expect(
      parseWorkspaceGitStatus(
        header +
          changed("a b\n.ts", "MM") +
          renamed("next.ts", "old.ts") +
          conflicted("conflict.ts") +
          "? new.ts\0",
      ).files,
    ).toEqual([
      {
        path: "a b\n.ts",
        indexStatus: "M",
        worktreeStatus: "M",
        groups: ["staged", "unstaged"],
      },
      {
        path: "next.ts",
        originalPath: "old.ts",
        indexStatus: "R",
        worktreeStatus: ".",
        groups: ["staged"],
      },
      {
        path: "conflict.ts",
        indexStatus: "U",
        worktreeStatus: "U",
        groups: ["conflict"],
      },
      {
        path: "new.ts",
        indexStatus: "?",
        worktreeStatus: "?",
        groups: ["untracked"],
      },
    ]);
  });
  it("preserves every supported status code", async () => {
    const { parseWorkspaceGitStatus } =
      await import("../../src/features/shell/git-status");
    for (const code of ["M", "A", "D", "R", "C", "T", "U"]) {
      const file = parseWorkspaceGitStatus(
        header + changed("file.ts", `${code}.`),
      ).files[0];
      expect(file.indexStatus).toBe(code);
      expect(file.worktreeStatus).toBe(".");
    }
  });
  it("uses literal argv paths, cached diff for index and no-index for new files", async () => {
    const { gitDiffCommand } =
      await import("../../src/features/shell/git-status");
    const file = {
      path: ":(glob)* $(touch nope)",
      groups: ["staged" as const],
      originalPath: "old name",
    };
    const staged = gitDiffCommand("/repo", file, "staged");
    expect(staged.command).toEqual([
      "git",
      "--no-optional-locks",
      "--literal-pathspecs",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--cached",
      "--",
      file.path,
      "old name",
    ]);
    expect(staged.sandboxPolicy).toEqual({
      type: "readOnly",
      networkAccess: false,
    });
    expect(
      gitDiffCommand("/repo", file, "untracked").command.slice(-4),
    ).toEqual(["--no-index", "--", "/dev/null", file.path]);
  });
});
