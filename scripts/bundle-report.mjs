import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const root = new URL("../dist/client/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL(".vite/manifest.json", root), "utf8"),
);
const initial = new Set();
const visited = new Set();
function visit(key) {
  if (visited.has(key)) return;
  visited.add(key);
  const chunk = manifest[key];
  initial.add(chunk.file);
  for (const css of chunk.css ?? []) initial.add(css);
  for (const dependency of chunk.imports ?? []) visit(dependency);
}
visit("index.html");

async function sizes(files) {
  let raw = 0;
  let gzip = 0;
  for (const file of files) {
    const body = await readFile(new URL(file, root));
    raw += body.length;
    gzip += gzipSync(body).length;
  }
  return {
    files: files.length,
    kB: +(raw / 1000).toFixed(2),
    gzipKB: +(gzip / 1000).toFixed(2),
  };
}
const assets = (await readdir(new URL("assets/", root)))
  .filter((file) => /\.(js|css)$/.test(file))
  .map((file) => join("assets", file));
console.table({
  "Initial JS/CSS (static import closure)": await sizes([...initial]),
  "All emitted JS/CSS (including lazy chunks/workers)": await sizes(assets),
});
console.log("Initial files:", [...initial]);
console.log(
  "gzip sizes are estimates; the HTTP server does not enable compression.",
);
