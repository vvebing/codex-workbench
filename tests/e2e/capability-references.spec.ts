import { expect, test, type Page } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";

let server: ReturnType<typeof createMockServer>;
let serverUrl: string;
test.beforeEach(async ({ page }) => {
  server = createMockServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Missing mock address");
  serverUrl = `ws://127.0.0.1:${address.port}`;
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
});
test.afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
async function openThread(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "连接工作环境", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "连接与设置" });
  await settings.getByRole("tab", { name: "工作环境", exact: true }).click();
  await settings.getByLabel("App-server 地址").fill(serverUrl);
  await settings.getByRole("button", { name: "连接", exact: true }).click();
  await expect(settings).toBeHidden();
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "搜索会话" });
  await search
    .getByPlaceholder("搜索标题、摘要或工作区…")
    .fill("接口分页与错误处理 · 10");
  await page.keyboard.press("Enter");
  await expect(search).toBeHidden();
  await expect(
    page.locator("[data-slot=conversation-turn]").first(),
  ).toBeAttached();
}
async function details(page: Page) {
  const button = page.getByRole("button", {
    name: "打开项目面板",
    exact: true,
  });
  if (await button.isVisible()) await button.click();
  const panel = page.getByRole("complementary", { name: "项目面板" });
  await panel.getByRole("tab", { name: "工作区", exact: true }).click();
  return panel;
}
async function environmentScope(page: Page, name: string) {
  const dialog = page.getByRole("dialog", { name: "连接与设置" });
  await dialog.getByRole("button", { name, exact: true }).click();
}
async function settings(page: Page, scope = "连接与账户") {
  await page.locator("[data-settings-trigger]").first().click();
  const dialog = page.getByRole("dialog", { name: "连接与设置" });
  await dialog.getByRole("tab", { name: "工作环境", exact: true }).click();
  if (scope !== "连接与账户") await environmentScope(page, scope);
  return dialog;
}

test("observed capability evidence can be cleared without executing a mutation", async ({
  page,
}) => {
  await openThread(page);
  await details(page);
  await expect
    .poll(() =>
      server.requestLog.some((request) => request.method === "thread/goal/get"),
    )
    .toBe(true);
  const dialog = await settings(page, "工具与集成");
  const capability = dialog.locator("section").filter({
    has: page.getByRole("heading", { name: "服务端功能支持", exact: true }),
  });
  await expect(capability).toContainText("服务器版本");
  await capability.getByText("会话目标", { exact: true }).click();
  const reset = capability.getByRole("button", {
    name: "清除记录以重新验证 thread/goal/get",
    exact: true,
  });
  await expect(reset).toBeVisible();
  const before = server.requestLog.filter(
    (request) => request.method === "thread/goal/get",
  ).length;
  await reset.click();
  await expect(reset).toHaveCount(0);
  await expect(
    capability
      .locator("details")
      .filter({ has: page.getByText("会话目标", { exact: true }) })
      .getByText("未知（尚无调用记录）")
      .first(),
  ).toBeVisible();
  expect(
    server.requestLog.filter((request) => request.method === "thread/goal/get")
      .length,
  ).toBe(before);
});

test("saved references can be explicitly quoted into the unsent draft", async ({
  page,
}) => {
  await openThread(page);
  const panel = await details(page);
  await panel.getByText("参考资料", { exact: true }).click();
  await panel.getByLabel("资料名称", { exact: true }).fill("协议参考");
  await panel
    .getByLabel("链接或文件路径", { exact: true })
    .fill("https://example.invalid/protocol");
  await panel
    .getByRole("button", { name: "保存参考资料", exact: true })
    .click();
  const reference = panel
    .getByRole("article")
    .filter({ has: page.getByRole("link", { name: "协议参考", exact: true }) });
  const before = server.requestLog.filter(
    (request) => request.method === "turn/start",
  ).length;
  await reference
    .getByRole("button", { name: "引用到输入框", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "消息输入框", exact: true }),
  ).toContainText("https://example.invalid/protocol");
  await expect(panel.getByText(/参考资料已引用到输入框/)).toBeVisible();
  expect(
    server.requestLog.filter((request) => request.method === "turn/start")
      .length,
  ).toBe(before);
});
