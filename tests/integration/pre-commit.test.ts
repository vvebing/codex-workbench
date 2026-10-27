import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const script = resolve("scripts/pre-commit.mjs");
for (const fail of [false, true]) {
  test(`commit gate checks staged content and ${fail ? "blocks failed CI" : "accepts successful CI"}`, () => {
    const temp = mkdtempSync(join(tmpdir(), "commit-gate-test-"));
    const repo = join(temp, "repo");
    const bin = join(temp, "bin");
    const log = join(temp, "calls.jsonl");
    try {
      mkdirSync(repo);
      mkdirSync(bin);
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: repo });
      git("init", "--quiet");
      writeFileSync(join(repo, "marker"), "staged");
      git("add", "marker");
      writeFileSync(join(repo, "marker"), "unstaged");
      const npm = join(bin, "npm");
      writeFileSync(
        npm,
        `#!${process.execPath}
const fs = require("node:fs");
if (fs.readFileSync("marker", "utf8") !== "staged") process.exit(9);
fs.appendFileSync(process.env.GATE_TEST_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.env.GATE_TEST_FAIL === "1" && process.argv[3] === "ci") process.exit(1);
`,
      );
      chmodSync(npm, 0o755);
      const result = spawnSync(process.execPath, [script], {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          GIT_INDEX_FILE: join(repo, ".git/index"),
          GATE_TEST_LOG: log,
          GATE_TEST_FAIL: fail ? "1" : "0",
        },
      });
      assert.equal(result.status, fail ? 1 : 0, result.stdout + result.stderr);
      const calls = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        calls,
        fail
          ? [
              ["ci", "--include=dev"],
              ["run", "ci"],
            ]
          : [
              ["ci", "--include=dev"],
              ["run", "ci"],
              ["run", "ci:e2e"],
            ],
      );
      assert.equal(readFileSync(join(repo, "marker"), "utf8"), "unstaged");
      assert.equal(git("show", ":marker").toString(), "staged");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
}
