import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";

type Entry = {
  name?: string;
  version: string;
  resolved: string;
  integrity: string;
  dependencies?: Record<string, string>;
  inBundle?: boolean;
};
const npmRoot = "node_modules/@semantic-release/npm/node_modules/npm";
const originalImport = 'var _glob = _interopRequireDefault(require("glob"));';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "release-tools-test-"));
  const packages: Record<string, Entry> = {};
  const add = async (
    key: string,
    name: string,
    version: string,
    dependencies?: Record<string, string>,
  ) => {
    const directory = join(root, key);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name, version, dependencies }),
    );
    await writeFile(
      join(directory, "index.js"),
      `module.exports = ${JSON.stringify(name + "@" + version)};\n`,
    );
    packages[key] = {
      version,
      resolved: `https://registry.npmjs.org/${name}/-/${basename(name)}-${version}.tgz`,
      integrity: `sha512-${Buffer.from(name + version).toString("base64")}`,
      ...(dependencies ? { dependencies } : {}),
      ...(key.includes("-patch") ? { name } : {}),
      ...(key.startsWith(`${npmRoot}/`) ? { inBundle: true } : {}),
    };
  };
  await mkdir(join(root, "scripts"));
  await copyFile(
    resolve("scripts/patch-release-tools.mjs"),
    join(root, "scripts/patch-release-tools.mjs"),
  );
  await add(npmRoot, "npm", "11.21.1", {
    glob: "^13.0.6",
    minimatch: "^10.2.5",
  });
  await add("node_modules/npm-undici-patch", "undici", "6.29.1");
  await add("node_modules/npm-ip-address-patch", "ip-address", "10.7.4");
  await add("node_modules/glob", "glob", "14.0.3", {
    minimatch: "^11.0.2",
    "path-scurry": "^3.0.0",
  });
  await add("node_modules/minimatch", "minimatch", "11.0.4", {
    "@isaacs/nonrecursive-glob-match": "^1.0.3",
  });
  await add(
    "node_modules/@isaacs/nonrecursive-glob-match",
    "@isaacs/nonrecursive-glob-match",
    "1.0.3",
  );
  await add("node_modules/path-scurry", "path-scurry", "3.0.0", {
    "lru-cache": "^11.0.0",
  });
  await add(
    "node_modules/path-scurry/node_modules/lru-cache",
    "lru-cache",
    "11.5.3",
  );
  // The source's nearest dependency must win over this incompatible hoisted one.
  await add("node_modules/lru-cache", "lru-cache", "5.1.1");
  for (const [name, version] of [
    ["undici", "6.28.0"],
    ["ip-address", "10.6.0"],
    ["glob", "13.0.6"],
    ["minimatch", "10.2.5"],
  ])
    await add(`${npmRoot}/node_modules/${name}`, name, version);
  await add(
    `${npmRoot}/node_modules/@npmcli/arborist`,
    "@npmcli/arborist",
    "9.9.3",
    { minimatch: "^10.0.3" },
  );
  await add(
    `${npmRoot}/node_modules/minimatch/node_modules/obsolete`,
    "obsolete",
    "1.0.0",
  );
  await add("node_modules/commitizen", "commitizen", "4.3.2", {
    glob: "7.2.3",
  });
  const findup = join(
    root,
    "node_modules/commitizen/dist/configLoader/findup.js",
  );
  await mkdir(join(root, "node_modules/commitizen/dist/configLoader"), {
    recursive: true,
  });
  await writeFile(findup, `${originalImport}\n`);
  const lockPath = join(root, "package-lock.json");
  const save = () =>
    writeFile(lockPath, JSON.stringify({ lockfileVersion: 3, packages }));
  await save();
  await writeFile(join(root, "node_modules/.package-lock.json"), "{}");
  return {
    root,
    packages,
    findup,
    save,
    readLock: async () => JSON.parse(await readFile(lockPath, "utf8")),
    run: (...args: string[]) =>
      spawnSync(
        process.execPath,
        [join(root, "scripts/patch-release-tools.mjs"), ...args],
        { encoding: "utf8", timeout: 15_000 },
      ),
    close: () => rm(root, { recursive: true, force: true }),
  };
}

test("release patches install the complete locked graph, update consumers and remain idempotent", async () => {
  const f = await fixture();
  try {
    const patched = f.run();
    assert.equal(patched.status, 0, patched.stderr);
    const lock = await f.readLock();
    assert.equal(
      lock.packages[`${npmRoot}/node_modules/@isaacs/nonrecursive-glob-match`]
        .version,
      "1.0.3",
    );
    assert.equal(
      lock.packages[`${npmRoot}/node_modules/lru-cache`].version,
      "11.5.3",
    );
    assert.equal(
      lock.packages[`${npmRoot}/node_modules/minimatch/node_modules/obsolete`],
      undefined,
    );
    assert.equal(lock.packages[npmRoot].dependencies.glob, "14.0.3");
    const consumer = JSON.parse(
      await readFile(
        join(f.root, npmRoot, "node_modules/@npmcli/arborist/package.json"),
        "utf8",
      ),
    );
    assert.equal(consumer.dependencies.minimatch, "11.0.4");
    await assert.rejects(
      readFile(join(f.root, "node_modules/.package-lock.json")),
      { code: "ENOENT" },
    );
    await assert.rejects(
      readFile(
        join(
          f.root,
          npmRoot,
          "node_modules/path-scurry/node_modules/lru-cache/package.json",
        ),
      ),
      { code: "ENOENT" },
    );
    assert.equal(f.run("--check").status, 0);
    assert.equal(f.run().status, 0);
    assert.deepEqual(await f.readLock(), lock);
  } finally {
    await f.close();
  }
});

test("verification rejects altered installed code and reapplying the patch repairs it", async () => {
  const f = await fixture();
  try {
    assert.equal(f.run().status, 0);
    await writeFile(
      join(f.root, npmRoot, "node_modules/minimatch/index.js"),
      "module.exports = 'altered';\n",
    );
    const before = await f.readLock();
    const checked = f.run("--check");
    assert.equal(checked.status, 1);
    assert.match(checked.stderr, /must match the official patched package/);
    assert.deepEqual(await f.readLock(), before);
    assert.equal(f.run().status, 0);
    assert.equal(f.run("--check").status, 0);
  } finally {
    await f.close();
  }
});

test("patching rejects untrusted package sources before replacing bundled files", async () => {
  const f = await fixture();
  try {
    f.packages["node_modules/glob"].resolved =
      "https://example.invalid/glob.tgz";
    await f.save();
    const file = join(f.root, npmRoot, "node_modules/glob/index.js");
    const before = await readFile(file, "utf8");
    assert.equal(f.run().status, 1);
    assert.equal(await readFile(file, "utf8"), before);
  } finally {
    await f.close();
  }
});

test("patching refuses missing transitive dependencies instead of only changing audit metadata", async () => {
  const f = await fixture();
  try {
    delete f.packages["node_modules/@isaacs/nonrecursive-glob-match"];
    await f.save();
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing locked dependency/);
  } finally {
    await f.close();
  }
});

test("verification detects removed Commitizen compatibility and stale consumer manifests", async () => {
  const f = await fixture();
  try {
    assert.equal(f.run().status, 0);
    await writeFile(f.findup, `${originalImport}\n`);
    assert.match(
      f.run("--check").stderr,
      /Commitizen glob compatibility patch is missing/,
    );
    assert.equal(f.run().status, 0);
    const file = join(f.root, npmRoot, "package.json");
    const pkg = JSON.parse(await readFile(file, "utf8"));
    pkg.dependencies.glob = "^13.0.6";
    await writeFile(file, JSON.stringify(pkg));
    assert.equal(f.run("--check").status, 1);
  } finally {
    await f.close();
  }
});

test("CI audits development dependencies even with omit=dev and stops on audit failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "ci-audit-test-"));
  try {
    const executable = join(root, "npm");
    const log = join(root, "calls.jsonl");
    await writeFile(
      executable,
      `#!${process.execPath}\nconst fs = require('node:fs');\nfs.appendFileSync(process.env.CI_AUDIT_TEST_LOG, JSON.stringify(process.argv.slice(2))+'\\n');\nif(process.argv[2]==='audit') process.exit(1);\n`,
    );
    await chmod(executable, 0o755);
    const result = spawnSync(process.execPath, [resolve("scripts/ci.mjs")], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        npm_config_omit: "dev",
        CI_AUDIT_TEST_LOG: log,
      },
    });
    assert.equal(result.status, 1);
    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(calls, [
      ["run", "patch:release-tools"],
      ["audit", "--include=dev", "--audit-level=low"],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the installed Commitizen discovers its existing adapter with modern glob", () => {
  const require = createRequire(resolve("package.json"));
  const loader = require("commitizen/dist/commitizen/configLoader.js");
  assert.equal(
    loader.load(undefined, process.cwd()).path,
    "cz-conventional-changelog",
  );
});

test("the patched bundled npm packs the intended files without publishing", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-npm-smoke-"));
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "release-tools-smoke",
        version: "1.0.0",
        files: ["lib/**/*.js"],
      }),
    );
    await mkdir(join(root, "lib"));
    await writeFile(join(root, "README.md"), "Release tools smoke test.\n");
    await writeFile(join(root, "lib/index.js"), "module.exports = {};\n");
    await writeFile(join(root, "lib/excluded.txt"), "excluded\n");
    const result = spawnSync(
      process.execPath,
      [
        resolve(npmRoot, "bin/npm-cli.js"),
        "pack",
        "--dry-run",
        "--ignore-scripts",
        "--offline",
        "--json",
      ],
      { cwd: root, encoding: "utf8", timeout: 15_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    const [packed] = JSON.parse(result.stdout);
    assert.deepEqual(
      packed.files.map(({ path }: { path: string }) => path).sort(),
      ["README.md", "lib/index.js", "package.json"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
