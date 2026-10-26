export default {
  branches: ["main"],
  plugins: [
    ["@semantic-release/commit-analyzer", { preset: "conventionalcommits" }],
    [
      "@semantic-release/release-notes-generator",
      { preset: "conventionalcommits" },
    ],
    "@semantic-release/changelog",
    ["@semantic-release/npm", { tarballDir: "output/release" }],
    [
      "@semantic-release/github",
      {
        assets: [
          { path: "output/release/*.tgz", label: "npm package" },
          { path: "CHANGELOG.md", label: "Changelog" },
        ],
        successComment: false,
        failComment: false,
        failTitle: false,
        releasedLabels: false,
      },
    ],
  ],
};
