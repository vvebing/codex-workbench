import { expect, test } from "@playwright/test";

test("welcome loads optional features only when opened", async ({ page }) => {
  test.skip(!process.env.E2E_PRODUCTION, "Checks emitted production chunks");
  await page.addInitScript(() =>
    localStorage.setItem(
      "codex-environments",
      JSON.stringify([
        {
          id: "local",
          name: "本机",
          kind: "local",
          url: "ws://127.0.0.1:4501",
          autoConnect: false,
        },
      ]),
    ),
  );
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator('[data-slot="welcome"]')).toBeVisible();
  expect(
    scripts.filter((url) =>
      /\/(?:MonacoEditor|mermaid|Composer|Timeline|SettingsDialog|SearchDialog|Details)-/.test(
        url,
      ),
    ),
  ).toEqual([]);
  await page.getByRole("button", { name: "连接工作环境", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(scripts.some((url) => /\/SettingsDialog-/.test(url))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(scripts.some((url) => /\/SearchDialog-/.test(url))).toBe(true);
});
