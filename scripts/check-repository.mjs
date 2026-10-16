import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { extname } from "node:path";

// These product icons are the only raster assets approved for the repository.
const productIcons = new Set([
  "public/favicon.ico",
  "public/icons/apple-touch-icon.png",
  "public/icons/favicon-running.png",
  "public/icons/favicon-completed.png",
  "public/icons/favicon.png",
  "public/icons/icon-512.png",
  "public/icons/product-icon.png",
]);
const imageExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".ico",
  ".avif",
  ".bmp",
  ".tif",
  ".tiff",
  ".heic",
  ".svg",
  ".heif",
  ".pdf",
]);
const privatePath =
  /(?:^|\/)(?:\.env(?:\..+)?|\.aws|\.ssh|\.codex|\.gnupg|auth\.json|credentials(?:\.json)?|id_(?:rsa|ed25519|ecdsa|dsa)|\.netrc|\.npmrc\.local)(?:\/|$)|\.(?:pem|key|p12|pfx|keystore)$/i;
const artifactPath =
  /(?:^|\/)(?:node_modules|dist|coverage|test-results|playwright-report|output|screenshots)\/|(?:^|\/)\.DS_Store$|\.(?:log|tsbuildinfo)$/i;
const credentials = [
  /-----BEGIN (?:ENCRYPTED |RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/,
  /(?:https?|wss?|ssh):\/\/[^\s/":]+:[^\s/@"]+@/,
];
const git = (args) => execFileSync("git", args, { encoding: "utf8" });
const staged = new Set(git(["ls-files", "--cached", "-z"]).split("\0"));
const files = new Set(
  git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean),
);
const findings = new Set();
for (const entry of git(["ls-files", "--stage", "-z"]).split("\0")) {
  if (/^(?:120000|160000) /.test(entry))
    findings.add(
      `${entry.slice(entry.indexOf("\t") + 1)}: unreviewed Git link`,
    );
}
function inspect(path, buffer, source) {
  if (buffer.includes(0) && !productIcons.has(path))
    findings.add(`${path}: unapproved binary in ${source}`);
  const text = buffer.toString("utf8").replaceAll("\0", "");
  if (credentials.some((pattern) => pattern.test(text)))
    findings.add(`${path}: possible credential in ${source}`);
}
for (const path of files) {
  if (privatePath.test(path) && !/(?:^|\/)\.env\.example$/.test(path))
    findings.add(`${path}: private configuration or key file`);
  if (artifactPath.test(path)) findings.add(`${path}: generated artifact`);
  if (
    imageExtensions.has(extname(path).toLowerCase()) &&
    !productIcons.has(path)
  )
    findings.add(`${path}: unapproved image`);
  try {
    if ((await lstat(path)).isSymbolicLink())
      findings.add(`${path}: unreviewed symbolic link`);
    else inspect(path, await readFile(path), "working tree");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (staged.has(path))
    inspect(path, execFileSync("git", ["show", `:${path}`]), "Git index");
}
if (findings.size) {
  console.error("Repository check failed (secret values are never printed):");
  for (const finding of [...findings].sort()) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Repository check passed: ${files.size} files inspected.`);
}
