import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { CodexClient } from "../../src/lib/rpc";
import {
  decodeGitPath,
  readIgnoredPaths,
} from "../../src/features/shell/git-ignore";

describe("Git ignored tree entries", () => {
  it("decodes Git quoting without splitting control characters or UTF-8 names", () => {
    expect(decodeGitPath('"a\\nb\\t\\"c\\\\d"')).toBe('a\nb\t"c\\d');
    expect(decodeGitPath('"\\344\\270\\255.log"')).toBe("中.log");
    expect(decodeGitPath("中文.log")).toBe("中文.log");
  });
  it("honors real nested, negated, global and tracked-file rules in batches", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "workbench-ignore-"));
    const run = (args: string[]) => {
      const r = spawnSync("git", args, { cwd, encoding: "utf8" });
      return { exitCode: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
    };
    try {
      expect(run(["init", "-q"]).exitCode).toBe(0);
      writeFileSync(join(cwd, ".gitignore"), "ignored/\n*.log\n!keep.log\n");
      writeFileSync(join(cwd, "global-rules"), "*.cache\n");
      expect(
        run(["config", "core.excludesFile", join(cwd, "global-rules")])
          .exitCode,
      ).toBe(0);
      mkdirSync(join(cwd, "nested"));
      mkdirSync(join(cwd, "ignored"));
      writeFileSync(join(cwd, "nested/.gitignore"), "local.txt\n");
      for (const path of [
        "tracked.log",
        "app.log",
        "keep.log",
        "a\nb.log",
        "中文.log",
        "global.cache",
        "nested/local.txt",
      ])
        writeFileSync(join(cwd, path), "x");
      expect(run(["add", "-f", "tracked.log"]).exitCode).toBe(0);
      const client = {
        request: async (_method: string, params: { command: string[] }) =>
          run(params.command.slice(1)),
      } as unknown as Pick<CodexClient, "request">;
      const ignored = await readIgnoredPaths(client, cwd, [
        "ignored",
        "ignored/child.txt",
        "tracked.log",
        "app.log",
        "keep.log",
        "a\nb.log",
        "中文.log",
        "global.cache",
        "nested/local.txt",
      ]);
      expect([...ignored].sort()).toEqual(
        [
          "ignored",
          "ignored/child.txt",
          "app.log",
          "a\nb.log",
          "中文.log",
          "global.cache",
          "nested/local.txt",
        ].sort(),
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
