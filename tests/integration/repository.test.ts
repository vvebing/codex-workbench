import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFile,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(
  new URL("../../scripts/check-repository.mjs", import.meta.url),
);
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "workbench-repository-"));
  execFileSync("git", ["init", "--quiet"], { cwd: directory });
  return {
    directory,
    git: (...args: string[]) =>
      execFileSync("git", args, { cwd: directory, stdio: "pipe" }),
    check: () =>
      spawnSync(process.execPath, [script], {
        cwd: directory,
        encoding: "utf8",
      }),
    close: () => rm(directory, { recursive: true, force: true }),
  };
}

test("repository check rejects staged private files even after they are ignored", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.directory, ".env"), "DEMO=true\n");
    f.git("add", ".env");
    await writeFile(join(f.directory, ".gitignore"), ".env\n");
    const result = f.check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\.env: private configuration/);
  } finally {
    await f.close();
  }
});

test("repository check detects credentials in the index without printing their values", async () => {
  const f = await fixture();
  const syntheticToken = ["ghp", "A".repeat(36)].join("_");
  try {
    await writeFile(join(f.directory, "config.txt"), syntheticToken);
    f.git("add", "config.txt");
    await writeFile(join(f.directory, "config.txt"), "safe example\n");
    const result = f.check();
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /config\.txt: possible credential in Git index/,
    );
    assert(!result.stderr.includes(syntheticToken));
    assert(!result.stdout.includes(syntheticToken));
  } finally {
    await f.close();
  }
});

test("repository check permits reviewed product images and rejects unrelated images", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.directory, "public", "icons"), { recursive: true });
    await writeFile(
      join(f.directory, "public", "icons", "favicon.png"),
      "icon",
    );
    await mkdir(join(f.directory, "docs", "images"), { recursive: true });
    for (const name of [
      "workbench-overview.png",
      "code-review.png",
      "approvals.png",
      "task-center.png",
      "subagent-collaboration.png",
    ])
      await writeFile(
        join(f.directory, "docs", "images", name),
        Buffer.from("reviewed synthetic capture\0"),
      );
    assert.equal(f.check().status, 0);
    await writeFile(
      join(f.directory, "docs", "images", "private.png"),
      "private screenshot",
    );
    await writeFile(join(f.directory, "public", "private.png"), "screenshot");
    const result = f.check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /public\/private\.png: unapproved image/);
    assert.match(result.stderr, /docs\/images\/private\.png: unapproved image/);
  } finally {
    await f.close();
  }
});

test("repository check scans staged text larger than the default child process buffer", async () => {
  const f = await fixture();
  try {
    await writeFile(
      join(f.directory, "font-index.json"),
      JSON.stringify({ data: "a".repeat(2 * 1024 * 1024) }),
    );
    f.git("add", "font-index.json");
    const result = f.check();
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await f.close();
  }
});

test("repository check rejects binary payloads and scans NUL-containing secrets", async () => {
  const fixtureState = await fixture();
  const syntheticToken = ["ghp", "B".repeat(36)].join("_");
  try {
    await writeFile(
      join(fixtureState.directory, "payload.dat"),
      Buffer.from(`\0${syntheticToken}`),
    );
    const result = fixtureState.check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unapproved binary/);
    assert.match(result.stderr, /possible credential/);
    assert(!result.stderr.includes(syntheticToken));
  } finally {
    await fixtureState.close();
  }
});

test("repository check rejects private keys, nested artifacts and vector images", async () => {
  const fixtureState = await fixture();
  try {
    await mkdir(join(fixtureState.directory, "nested", "node_modules"), {
      recursive: true,
    });
    await writeFile(
      join(fixtureState.directory, "nested", "node_modules", "index.js"),
      "export {};",
    );
    await writeFile(join(fixtureState.directory, "id_ed25519"), "private");
    await writeFile(join(fixtureState.directory, "capture.svg"), "<svg/>");
    const result = fixtureState.check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /id_ed25519: private configuration/);
    assert.match(
      result.stderr,
      /nested\/node_modules\/index.js: generated artifact/,
    );
    assert.match(result.stderr, /capture.svg: unapproved image/);
  } finally {
    await fixtureState.close();
  }
});

test("repository check rejects links in both working tree and index", async () => {
  const fixtureState = await fixture();
  try {
    await symlink(
      "missing-private-file",
      join(fixtureState.directory, "linked.txt"),
    );
    fixtureState.git("add", "linked.txt");
    let result = fixtureState.check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unreviewed symbolic link/);
    await rm(join(fixtureState.directory, "linked.txt"));
    await writeFile(join(fixtureState.directory, "linked.txt"), "safe");
    result = fixtureState.check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unreviewed Git link/);
  } finally {
    await fixtureState.close();
  }
});

test("repository ignore rules preserve icons but exclude private images and keys", async () => {
  const fixtureState = await fixture();
  try {
    await copyFile(
      new URL("../../.gitignore", import.meta.url),
      join(fixtureState.directory, ".gitignore"),
    );
    await mkdir(join(fixtureState.directory, "public", "icons"), {
      recursive: true,
    });
    for (const path of [
      "private.png",
      "attachment.pdf",
      "id_ed25519",
      "public/icons/favicon.png",
    ])
      await writeFile(join(fixtureState.directory, path), "fixture");
    const untracked = fixtureState
      .git("ls-files", "--others", "--exclude-standard")
      .toString();
    assert.match(untracked, /public\/icons\/favicon\.png/);
    assert.doesNotMatch(untracked, /private\.png|attachment\.pdf|id_ed25519/);
    fixtureState.git("add", "-f", "private.png");
    const result = fixtureState.check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /private\.png: unapproved image/);
  } finally {
    await fixtureState.close();
  }
});
