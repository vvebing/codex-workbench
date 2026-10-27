import { spawnSync } from "node:child_process";

// Keep the local commit gate and GitHub Actions checks in one place.
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const commands = [
  ["run", "patch:release-tools"],
  ["audit", "--audit-level=low"],
  ["run", "check"],
  ["run", "build"],
  ["run", "test:package"],
];
if (process.argv.includes("--e2e")) {
  commands.length = 0;
  commands.push([
    "run",
    "test:e2e",
    "--",
    "--fully-parallel",
    "--workers=1",
    ...process.argv.slice(3),
  ]);
}
for (const args of commands) {
  const result = spawnSync(npm, args, {
    stdio: "inherit",
    env: { ...process.env, E2E_PRODUCTION: "1" },
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
