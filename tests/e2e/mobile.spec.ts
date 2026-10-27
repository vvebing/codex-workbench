import { expect, test, type Locator, type Page } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";

let server: ReturnType<typeof createMockServer>;
let endpoint: string;

test.beforeEach(async ({ page }) => {
  server = createMockServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing listener");
  endpoint = `ws://127.0.0.1:${address.port}`;
  await page.addInitScript(() => {
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
    );
  });
});

test.afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

async function fitsViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  await expect
    .poll(async () =>
      locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left >= -1 &&
          rect.right <= innerWidth + 1 &&
          rect.top >= -1 &&
          rect.bottom <= innerHeight + 1
        );
      }),
    )
    .toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
}

async function openConversation(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "连接工作环境", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "连接与设置" });
  await settings.getByRole("tab", { name: "工作环境", exact: true }).click();
  await settings.getByLabel("App-server 地址").fill(endpoint);
  await settings.getByRole("button", { name: "连接", exact: true }).click();
  await expect(settings).toBeHidden();
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "搜索会话" });
  await search
    .getByPlaceholder("搜索标题、摘要或工作区…")
    .fill("接口分页与错误处理 · 10");
  await search.getByRole("option", { name: /接口分页与错误处理 · 10/ }).click();
  await expect(search).toBeHidden();
  await expect(page.getByRole("textbox", { name: "消息输入框" })).toBeVisible();
}

for (const width of [320, 390, 768]) {
  test(`mobile ${width}px keeps navigation, settings, composer and project panel within the viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 740 });
    await openConversation(page);
    const editor = page.getByRole("textbox", { name: "消息输入框" });
    await editor.fill("移动端长文本".repeat(40));
    await fitsViewport(page, editor);
    await fitsViewport(page, page.locator("[data-slot=composer-action]"));
    await fitsViewport(page, page.locator("[data-slot=model-choice]"));
    await page.getByRole("button", { name: "打开导航" }).click();
    const navigation = page.getByRole("dialog", { name: "工作区导航" });
    await fitsViewport(page, navigation);
    await navigation.locator("[data-slot=connection-entry]").click();
    const settings = page.getByRole("dialog", { name: "连接与设置" });
    await fitsViewport(page, settings);
    for (const tab of await settings.getByRole("tab").all()) {
      await tab.click();
      await fitsViewport(page, tab);
      if ((await tab.textContent())?.includes("工作环境")) {
        const categories = settings.getByRole("group", {
          name: "工作环境设置",
        });
        await expect(categories.getByRole("button")).toHaveCount(6);
        for (const category of await categories.getByRole("button").all()) {
          await category.scrollIntoViewIfNeeded();
          await fitsViewport(page, category);
          await category.click();
          await expect(category).toHaveAttribute("aria-current", "page");
        }
      }
      const content = settings.locator("[data-slot=settings-content]");
      expect(
        await content.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await expect(page.getByRole("button", { name: "打开导航" })).toBeFocused();
    await page.getByRole("button", { name: "打开项目面板" }).click();
    const panel = page.getByRole("complementary", { name: "项目面板" });
    await fitsViewport(page, panel);
    await page
      .getByRole("dialog", { name: "项目面板" })
      .getByRole("button", { name: "关闭项目面板", exact: true })
      .click();
    await expect(editor).toHaveText("移动端长文本".repeat(40));
    await page.setViewportSize({ width, height: 420 });
    await fitsViewport(page, page.locator("[data-slot=composer-action]"));
    await page.getByRole("button", { name: "打开导航" }).click();
    await navigation.locator("[data-slot=connection-entry]").click();
    await fitsViewport(page, settings);
    await settings.getByRole("tab", { name: "工作环境", exact: true }).click();
    const address = settings.getByLabel("App-server 地址");
    await address.scrollIntoViewIfNeeded();
    await fitsViewport(page, address);
  });
}

test("mobile visual viewport resize keeps the composer and settings above the keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await openConversation(page);
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", {
      configurable: true,
      get: () => 420,
    });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect
    .poll(() =>
      page
        .locator("[data-slot=app-shell]")
        .evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBe(420);
  const action = page.locator("[data-slot=composer-action]");
  expect(
    (await action.boundingBox())!.y + (await action.boundingBox())!.height,
  ).toBeLessThanOrEqual(420);
  await page.getByRole("button", { name: "打开导航" }).click();
  await page
    .getByRole("dialog", { name: "工作区导航" })
    .locator("[data-slot=connection-entry]")
    .click();
  const settings = page.getByRole("dialog", { name: "连接与设置" });
  await expect(settings).toBeVisible();
  const box = (await settings.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(420);
});
