import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

const git = (args, cwd = process.cwd()) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const tree = git(["write-tree"]);
const snapshot = mkdtempSync(join(tmpdir(), "codex-commit-check-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
let status = 1;
try {
  // Check exactly what will be committed, including partial staging, without
  // stashing, editing the working tree, or replacing the developer's dependencies.
  git(["checkout-index", "--all", `--prefix=${snapshot}${sep}`]);
  const env = { ...process.env, CI: "1", CODEX_COMMIT_CHECK: "1" };
  // Git sets these when invoking hooks; don't let the temporary repository use
  // the original index, worktree or object database.
  for (const key of git(["rev-parse", "--local-env-vars"]).split("\n"))
    delete env[key];
  const run = (command, args) => {
    const result = spawnSync(command, args, {
      cwd: snapshot,
      env,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`${command} ${args.join(" ")} failed`);
  };
  console.log(
    "Checking staged files with the full CI suite in an isolated directory…",
  );
  run("git", ["init", "--quiet"]);
  run("git", ["add", "--force", "."]);
  run(npm, ["ci", "--include=dev"]);
  run(npm, ["run", "ci"]);
  run(npm, ["run", "ci:e2e"]);
  if (git(["write-tree"]) !== tree)
    throw new Error("Staged files changed during checks. Retry the commit.");
  status = 0;
} catch (error) {
  console.error(`Commit blocked: ${error.message}`);
} finally {
  rmSync(snapshot, { recursive: true, force: true });
}
process.exitCode = status;
