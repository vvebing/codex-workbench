import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join, posix, relative, resolve, sep } from "node:path";

// npm ships its own node_modules in its tarball; overrides do not replace them.
// Copy integrity-locked official patch packages, verify the installed bytes, and
// only then synchronize audit metadata. Run after every npm ci / npm install.
const root = resolve(import.meta.dirname, "..");
const lockPath = join(root, "package-lock.json");
const lock = JSON.parse(await readFile(lockPath, "utf8"));
const patches = [
  { name: "undici", source: "npm-undici-patch", version: "6.29.1" },
  { name: "ip-address", source: "npm-ip-address-patch", version: "10.7.4" },
  { name: "glob", source: "glob", version: "14.0.3" },
  { name: "minimatch", source: "minimatch", version: "11.0.4" },
];
const verifyOnly = process.argv.includes("--check");
const npmRoots = Object.keys(lock.packages).filter(
  (key) => key === "node_modules/npm" || key.endsWith("/node_modules/npm"),
);
assert(npmRoots.length, "Re-evaluate workaround: no bundled npm found");

async function manifest(dir, prefix = "", omitDependencies = false) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (
      omitDependencies &&
      entry.name === "node_modules" &&
      entry.isDirectory()
    )
      continue;
    const relative = `${prefix}${entry.name}`;
    assert(!entry.isSymbolicLink(), `Unexpected symbolic link: ${relative}`);
    if (entry.isDirectory())
      files.push(
        ...(await manifest(
          join(dir, entry.name),
          `${relative}/`,
          omitDependencies,
        )),
      );
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

/** Resolve the source dependency as Node does, including non-hoisted copies. */
function dependencyKey(from, name) {
  for (
    let directory = from;
    directory !== ".";
    directory = posix.dirname(directory)
  ) {
    if (posix.basename(directory) === "node_modules") continue;
    const key = `${directory}/node_modules/${name}`;
    if (lock.packages[key]) return key;
  }
  const key = `node_modules/${name}`;
  assert(lock.packages[key], `Missing locked dependency: ${from} -> ${name}`);
  return key;
}

const sources = new Map();
async function collect(sourceKey) {
  assert(
    !npmRoots.some((key) => sourceKey.startsWith(`${key}/`)),
    `Patch source must be outside bundled npm: ${sourceKey}`,
  );
  const source = join(root, sourceKey);
  const metadata = lock.packages[sourceKey];
  assert(metadata, `Missing patch source: ${sourceKey}`);
  const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  assert(/^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i.test(pkg.name));
  assert.equal(pkg.version, metadata.version);
  assert.equal(metadata.name ?? pkg.name, pkg.name);
  assert(metadata.integrity?.startsWith("sha512-"));
  assert.equal(
    metadata.resolved,
    `https://registry.npmjs.org/${pkg.name}/-/${basename(pkg.name)}-${pkg.version}.tgz`,
  );
  const previous = sources.get(pkg.name);
  if (previous) {
    assert.equal(
      previous.metadata.integrity,
      metadata.integrity,
      `Conflicting patch dependency versions: ${pkg.name}`,
    );
    return;
  }
  sources.set(pkg.name, { source, metadata });
  // New glob/minimatch majors also need their matching runtime dependencies.
  // Copying only the entry packages can leave incompatible bundled helpers.
  for (const name of Object.keys(metadata.dependencies ?? {}))
    await collect(dependencyKey(sourceKey, name));
}

for (const patch of patches) {
  const sourceKey = `node_modules/${patch.source}`;
  assert.equal(lock.packages[sourceKey]?.version, patch.version);
  const pkg = JSON.parse(
    await readFile(join(root, sourceKey, "package.json"), "utf8"),
  );
  assert.equal(pkg.name, patch.name);
  for (const npmRoot of npmRoots)
    assert(
      lock.packages[`${npmRoot}/node_modules/${patch.name}`],
      `Re-evaluate workaround: no bundled ${patch.name} found`,
    );
  await collect(sourceKey);
}

for (const npmRoot of npmRoots) {
  for (const [name, { source, metadata }] of sources) {
    const key = `${npmRoot}/node_modules/${name}`;
    const destination = join(root, key);
    if (!verifyOnly) {
      await rm(destination, { recursive: true, force: true });
      await cp(source, destination, {
        recursive: true,
        // Dependencies are installed as a separately verified, complete graph.
        filter: (path) =>
          !relative(source, path).split(sep).includes("node_modules"),
      });
      for (const nested of Object.keys(lock.packages))
        if (nested.startsWith(`${key}/node_modules/`))
          delete lock.packages[nested];
    }
    assert.deepEqual(
      await manifest(destination),
      await manifest(source, "", true),
      `${key} must match the official patched package; run npm run patch:release-tools`,
    );
    const { name: _name, ...replacement } = metadata;
    void _name;
    const expected = { ...replacement, inBundle: true };
    if (verifyOnly) assert.deepEqual(lock.packages[key], expected);
    else lock.packages[key] = expected;
    console.log(
      `${verifyOnly ? "Verified" : "Patched"} ${key}@${metadata.version}`,
    );
  }
}

// Arborist intentionally ignores overrides for bundled packages. Keep their
// actual consumers' manifests and the lock consistent with the installed majors.
for (const npmRoot of npmRoots) {
  for (const [key, metadata] of Object.entries(lock.packages)) {
    if (key !== npmRoot && !key.startsWith(`${npmRoot}/node_modules/`))
      continue;
    if (
      [...sources.keys()].some(
        (name) => key === `${npmRoot}/node_modules/${name}`,
      )
    )
      continue;
    const names = ["glob", "minimatch"].filter(
      (name) => metadata.dependencies?.[name],
    );
    if (!names.length) continue;
    const file = join(root, key, "package.json");
    const pkg = JSON.parse(await readFile(file, "utf8"));
    assert.equal(pkg.version, metadata.version);
    for (const name of names) {
      const version = sources.get(name).metadata.version;
      assert(
        pkg.dependencies?.[name],
        `Missing bundled consumer dependency: ${key} -> ${name}`,
      );
      if (verifyOnly) {
        assert.equal(pkg.dependencies[name], version);
        assert.equal(metadata.dependencies[name], version);
      } else {
        pkg.dependencies[name] = version;
        metadata.dependencies[name] = version;
      }
    }
    if (!verifyOnly) await writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

// Commitizen's Babel default import predates glob's named CommonJS exports.
// Normalize that one import while preserving the existing config discovery API.
const commitizen = lock.packages["node_modules/commitizen"];
assert.equal(commitizen?.version, "4.3.2");
const findupPath = join(
  root,
  "node_modules/commitizen/dist/configLoader/findup.js",
);
const originalImport = 'var _glob = _interopRequireDefault(require("glob"));';
const compatibleImport = 'var _glob = { default: require("glob") };';
const findup = await readFile(findupPath, "utf8");
if (verifyOnly) {
  assert(
    findup.includes(compatibleImport) && !findup.includes(originalImport),
    "Commitizen glob compatibility patch is missing; run npm run patch:release-tools",
  );
} else if (findup.includes(originalImport)) {
  await writeFile(findupPath, findup.replace(originalImport, compatibleImport));
} else
  assert(
    findup.includes(compatibleImport),
    "Re-evaluate Commitizen glob compatibility patch",
  );
console.log(
  `${verifyOnly ? "Verified" : "Patched"} Commitizen glob compatibility`,
);

if (!verifyOnly) {
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  // npm's hidden lock still describes the original tarball contents. Invalidate
  // it so npm ls / subsequent installs read the patched dependency graph.
  await rm(join(root, "node_modules/.package-lock.json"), { force: true });
}
