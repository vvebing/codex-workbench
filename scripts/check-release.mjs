import assert from "node:assert/strict";
import { analyzeCommits } from "@semantic-release/commit-analyzer";
import { generateNotes } from "@semantic-release/release-notes-generator";
import config from "../release.config.mjs";

const context = {
  cwd: process.cwd(),
  logger: { log() {} },
  options: { repositoryUrl: "https://github.com/vvebing/codex-workbench.git" },
  lastRelease: { gitTag: "v1.0.0" },
  nextRelease: { version: "2.0.0", gitTag: "v2.0.0" },
};
const samples = [
  ["feat(cli): add custom port", "minor"],
  ["fix(cli): validate port", "patch"],
  ["feat!: remove legacy option", "major"],
  ["docs: explain installation", null],
];
for (const [message, expected] of samples) {
  assert.equal(
    await analyzeCommits(config.plugins[0][1], {
      ...context,
      commits: [{ hash: "0123456789abcdef", message }],
    }),
    expected,
  );
}
const notes = await generateNotes(config.plugins[1][1], {
  ...context,
  commits: samples.map(([message], index) => ({
    hash: `${index}123456789abcdef`,
    message,
  })),
});
for (const text of [
  "2.0.0",
  "add custom port",
  "validate port",
  "BREAKING CHANGES",
  "remove legacy option",
])
  assert(notes.includes(text), `Missing release note: ${text}`);
assert(!notes.includes("explain installation"));
console.log("Release analysis and changelog rendering passed.");
