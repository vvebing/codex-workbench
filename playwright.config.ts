import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 35_000,
  expect: { timeout: 8_000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5181",
    // Existing fixtures assert the Chinese interface explicitly.
    locale: "zh-CN",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        // Keep the native user agent: Monaco chooses shortcuts from it, while
        // Playwright's ControlOrMeta follows the host operating system.
        browserName: "chromium",
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: {
    command: process.env.E2E_PRODUCTION
      ? "node tests/fixtures/production-server.mjs"
      : "npm run dev -- --port 5181",
    env: { PORT: "5181" },
    url: "http://127.0.0.1:5181",
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
