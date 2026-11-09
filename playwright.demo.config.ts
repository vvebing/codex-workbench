import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/demo",
  outputDir: "output/demo-tests",
  timeout: 40_000,
  workers: 1,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5183/codex-workbench/",
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/fixtures/demo-server.mjs",
    env: { PORT: "5183" },
    url: "http://127.0.0.1:5183/codex-workbench/",
    reuseExistingServer: false,
  },
});
