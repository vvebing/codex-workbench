import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// npm ships its own node_modules in its tarball; overrides do not replace them.
// Copy integrity-locked official patch packages, verify the installed bytes, and
// only then synchronize audit metadata. Run after every npm ci / npm install.
const root = resolve(import.meta.dirname, "..");
const lockPath = join(root, "package-lock.json");
const lock = JSON.parse(await readFile(lockPath, "utf8"));
const patches = [
  { name: "undici", alias: "npm-undici-patch", version: "6.29.1" },
  { name: "ip-address", alias: "npm-ip-address-patch", version: "10.7.4" },
];
const verifyOnly = process.argv.includes("--check");

async function manifest(dir, prefix = "") {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    assert(!entry.isSymbolicLink(), `Unexpected symbolic link: ${relative}`);
    if (entry.isDirectory())
      files.push(...(await manifest(join(dir, entry.name), `${relative}/`)));
    else
      files.push([
        relative,
        createHash("sha256")
          .update(await readFile(join(dir, entry.name)))
          .digest("hex"),
      ]);
  }
  return files.sort(([a], [b]) => a.localeCompare(b));
}

for (const patch of patches) {
  const sourceKey = `node_modules/${patch.alias}`;
  const source = join(root, sourceKey);
  const metadata = lock.packages[sourceKey];
  assert.equal(metadata?.version, patch.version);
  assert.equal(metadata.name, patch.name);
  assert(metadata.integrity?.startsWith("sha512-"));
  assert.equal(
    metadata.resolved,
    `https://registry.npmjs.org/${patch.name}/-/${patch.name}-${patch.version}.tgz`,
  );
  const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  assert.equal(pkg.name, patch.name);
  assert.equal(pkg.version, patch.version);
  const targets = Object.keys(lock.packages).filter((key) =>
    key.endsWith(`/npm/node_modules/${patch.name}`),
  );
  assert(
    targets.length > 0,
    `Re-evaluate workaround: no bundled ${patch.name} found`,
  );
  for (const key of targets) {
    const destination = join(root, key);
    if (!verifyOnly) {
      await rm(destination, { recursive: true, force: true });
      await cp(source, destination, { recursive: true });
    }
    assert.deepEqual(
      await manifest(destination),
      await manifest(source),
      `${key} must match the official patched package; run npm run patch:release-tools`,
    );
    const { name: _name, ...replacement } = metadata;
    void _name;
    if (verifyOnly) {
      assert.equal(lock.packages[key].version, patch.version);
      assert.equal(lock.packages[key].integrity, metadata.integrity);
    } else lock.packages[key] = { ...replacement, inBundle: true };
    console.log(
      `${verifyOnly ? "Verified" : "Patched"} ${key}@${patch.version}`,
    );
  }
}
if (!verifyOnly)
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
