import { execFileSync, spawnSync } from "node:child_process";

// npm consumers and CI must not have their Git configuration changed.
if (!process.env.CI && !process.env.CODEX_COMMIT_CHECK) {
  let root;
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // A source archive or published package has no Git repository.
  }
  if (root === process.cwd()) {
    const current = spawnSync("git", ["config", "--get", "core.hooksPath"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (current.stdout.trim() && current.stdout.trim() !== ".githooks") {
      throw new Error(
        "Existing core.hooksPath must be integrated with .githooks first.",
      );
    }
    execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"]);
  }
}
