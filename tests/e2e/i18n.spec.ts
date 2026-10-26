import { once } from "node:events";
import { expect, test, type Page } from "@playwright/test";
import { createMockServer } from "../fixtures/app-server";

const languageKey = "codex-workbench.language";
async function settings(page: Page, language: "en" | "zh-CN") {
  await page.locator("[data-settings-trigger]").click();
  const dialog = page.getByRole("dialog", {
    name: language === "en" ? "Connections and settings" : "连接与设置",
  });
  await dialog
    .getByRole("tab", {
      name: language === "en" ? "General" : "通用",
      exact: true,
    })
    .click();
  return dialog;
}

test.describe("English browser language", () => {
  test.use({ locale: "en-US" });
  test("detects English, switches immediately without losing Chinese draft content, and persists the choice", async ({
    page,
  }) => {
    const server = createMockServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing listener");
    await page.route("**/codex-release", (route) =>
      route.fulfill({ json: { version: "0.160.0" } }),
    );
    await page.addInitScript((url) => {
      if (!localStorage.getItem("codex-environments"))
        localStorage.setItem(
          "codex-environments",
          JSON.stringify([
            {
              id: "local",
              name: "我的环境",
              kind: "local",
              url,
              autoConnect: true,
            },
          ]),
        );
    }, `ws://127.0.0.1:${address.port}`);
    try {
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page).toHaveTitle("Codex Workbench");
      expect(
        await page.evaluate((key) => localStorage.getItem(key), languageKey),
      ).toBeNull();
      await page
        .getByRole("button", { name: "Start new session", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "New session", exact: true })
        .getByRole("button", { name: "Create session", exact: true })
        .click();
      const draft = "保留中文用户内容，切换语言也不能丢失。";
      await expect(
        page.getByRole("textbox", { name: "Message input", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("textbox", { name: "Message input", exact: true })
        .fill(draft);
      let dialog = await settings(page, "en");
      await dialog
        .getByRole("combobox", { name: "Interface language", exact: true })
        .click();
      await page.getByRole("option", { name: "简体中文", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
      dialog = page.getByRole("dialog", { name: "连接与设置" });
      await expect(
        dialog.getByRole("combobox", { name: "界面语言", exact: true }),
      ).toContainText("简体中文");
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "消息输入框", exact: true }),
      ).toHaveText(draft);
      await expect(
        page.getByRole("tab", { name: "我的环境", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate((key) => localStorage.getItem(key), languageKey),
      ).toBe("zh-CN");
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
      await expect(page).toHaveTitle("Codex 工作台");
      dialog = await settings(page, "zh-CN");
      await dialog
        .getByRole("combobox", { name: "界面语言", exact: true })
        .click();
      await page
        .getByRole("option", { name: "跟随浏览器", exact: true })
        .click();
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      expect(
        await page.evaluate((key) => localStorage.getItem(key), languageKey),
      ).toBe("system");
    } finally {
      await page.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

test.describe("Chinese browser language", () => {
  test.use({ locale: "zh-TW" });
  test("maps Chinese browser variants to Simplified Chinese and honors explicit English on reload", async ({
    page,
  }) => {
    await page.route("**/codex-release", (route) =>
      route.fulfill({ json: { version: "0.160.0" } }),
    );
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page).toHaveTitle("Codex 工作台");
    let dialog = await settings(page, "zh-CN");
    await dialog
      .getByRole("combobox", { name: "界面语言", exact: true })
      .click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    dialog = await settings(page, "en");
    await expect(
      dialog.getByRole("combobox", { name: "Interface language", exact: true }),
    ).toContainText("English");
  });
});
