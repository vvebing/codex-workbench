import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

// Exercise the actual tarball in a clean consumer directory, without real Codex.
const temp = await mkdtemp(join(tmpdir(), "codex-workbench-package-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (args, cwd = process.cwd()) =>
  execFileSync(npm, args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });
let child;
try {
  const [packed] = JSON.parse(
    run(["pack", "--ignore-scripts", "--json", "--pack-destination", temp]),
  );
  for (const { path } of packed.files) {
    assert.match(
      path,
      /^(dist\/(client|server)\/|docs\/.*\.md$|package\.json$|README(?:\.zh-CN)?\.md$|SECURITY\.md$|CHANGELOG\.md$|CONTRIBUTING\.md$|LICENSE$)/,
    );
    assert.doesNotMatch(path, /\.(map|ts|tsx)$/);
  }
  assert(packed.files.some(({ path }) => path === "dist/client/index.html"));
  assert(packed.files.some(({ path }) => path === "dist/server/index.js"));
  assert(packed.files.some(({ path }) => path === "README.zh-CN.md"));
  run(
    [
      "install",
      "--ignore-scripts",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      join(temp, packed.filename),
    ],
    temp,
  );
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(
    run(
      ["exec", "--offline", "--", "codex-workbench", "--version"],
      temp,
    ).trim(),
    pkg.version,
  );
  assert.match(
    run(["exec", "--offline", "--", "codex-workbench", "--help"], temp),
    /--port/,
  );
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  child = spawn(
    process.execPath,
    [
      resolve(temp, "node_modules/codex-workbench/dist/server/index.js"),
      "--port",
      String(port),
      "--no-app-server",
    ],
    {
      cwd: temp,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(child.exitCode, null, output);
    try {
      ready = (await fetch(`${base}/healthz`)).ok;
    } catch {
      /* Wait for listen. */
    }
    if (ready) break;
    await setTimeout(100);
  }
  assert(ready, `Packaged server did not start: ${output}`);
  for (const path of ["/", "/session/example"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<html/);
  }
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const timer = globalThis.setTimeout(() => child.kill("SIGKILL"), 5000);
  const code = await exited;
  clearTimeout(timer);
  assert.equal(code, 0, output);
  console.log(
    `Package smoke test passed: ${packed.filename} (${packed.size} bytes).`,
  );
} finally {
  if (child && child.exitCode === null) child.kill("SIGKILL");
  await rm(temp, { recursive: true, force: true });
}
