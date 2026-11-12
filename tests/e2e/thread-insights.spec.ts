import { expect, test, type Page } from "@playwright/test";
import { once } from "node:events";
import { createMockServer, type MockOptions } from "../fixtures/app-server";

let server: ReturnType<typeof createMockServer>;
let address: string;
let options: MockOptions;
test.beforeEach(async ({ page }) => {
  options = {};
  server = createMockServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address();
  if (!port || typeof port === "string") throw Error("No mock port");
  address = `ws://127.0.0.1:${port.port}`;
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

async function tools(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "连接工作环境", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "连接与设置" });
  await settings.getByRole("tab", { name: "工作环境", exact: true }).click();
  await settings.getByLabel("App-server 地址").fill(address);
  await settings.getByRole("button", { name: "连接", exact: true }).click();
  await expect(settings).toBeHidden();
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "搜索会话" });
  await search
    .getByPlaceholder("搜索标题、摘要或工作区…")
    .fill("接口分页与错误处理 · 10");
  await page.keyboard.press("Enter");
  await expect(search).toBeHidden();
  const open = page.getByRole("button", { name: "打开项目面板", exact: true });
  if (await open.isVisible()) await open.click();
  const panel = page.getByRole("complementary", { name: "项目面板" });
  await panel.getByRole("tab", { name: "工作区", exact: true }).click();
  return panel;
}

test("usage stays on demand, distinguishes unknown prices and renders session Hooks", async ({
  page,
}) => {
  const panel = await tools(page);
  expect(
    server.requestLog.some((entry) => entry.method === "account/usage/read"),
  ).toBe(false);
  await panel.getByText("会话用量与费用", { exact: true }).click();
  await panel
    .getByRole("button", { name: "刷新会话用量", exact: true })
    .click();
  await expect(panel.getByText("USD 0.123456", { exact: true })).toBeVisible();
  await expect(panel.getByText("暂未提供", { exact: true })).toBeVisible();
  const request = server.requestLog.find(
    (entry) => entry.method === "account/usage/read",
  );
  expect(request?.params).toEqual({ threadId: "mock-thread-010" });
  await panel.getByText("当前会话 Hooks", { exact: true }).click();
  await expect(panel.getByText(/模型请求前 · command/)).toBeVisible();
  await expect(
    panel.getByText("执行环境：demo-execution-environment", { exact: true }),
  ).toBeVisible();
  expect(
    server.requestLog.find((entry) => entry.method === "hooks/list")?.params,
  ).toEqual({ threadId: "mock-thread-010" });
  await panel
    .getByText("会话用量与费用", { exact: true })
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.screenshot({
    path: test.info().outputPath("desktop.png"),
    fullPage: true,
  });
});

test("diagnostics save explicitly to the environment, with optional logs and separate download", async ({
  page,
}) => {
  const panel = await tools(page);
  await panel.getByText("本地诊断包", { exact: true }).click();
  expect(
    server.requestLog.some((entry) => entry.method === "feedback/save"),
  ).toBe(false);
  await panel
    .getByLabel("环境主机上的 ZIP 路径", { exact: true })
    .fill("/demo/atlas-web/report.zip");
  await panel
    .getByLabel("问题说明（可选）", { exact: true })
    .fill("Investigate demo");
  await expect(
    panel.getByLabel("包含运行日志（可能含敏感信息）"),
  ).not.toBeChecked();
  await panel
    .getByRole("button", { name: "导出到环境主机", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "取回诊断包", exact: true }),
  ).toBeVisible();
  expect(
    server.requestLog.find((entry) => entry.method === "feedback/save")?.params,
  ).toMatchObject({
    threadId: "mock-thread-010",
    includeLogs: false,
    savePath: "/demo/atlas-web/report.zip",
  });
  const downloadEvent = page.waitForEvent("download");
  await panel.getByRole("button", { name: "取回诊断包", exact: true }).click();
  expect((await downloadEvent).suggestedFilename()).toBe("report.zip");
  await panel
    .getByRole("button", { name: "导出到环境主机", exact: true })
    .click();
  await expect(
    panel.getByText("此路径已用于导出，请更换新路径以避免重复写入。", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    server.requestLog.filter((entry) => entry.method === "feedback/save"),
  ).toHaveLength(1);
  expect(
    server.requestLog.some((entry) => entry.method === "feedback/upload"),
  ).toBe(false);
});

test("older servers explain unsupported features without disturbing the conversation", async ({
  page,
}) => {
  options.unsupportedMethods = [
    "account/usage/read",
    "feedback/save",
    "hooks/list",
  ];
  const panel = await tools(page);
  await panel.getByText("会话用量与费用", { exact: true }).click();
  await panel
    .getByRole("button", { name: "刷新会话用量", exact: true })
    .click();
  await expect(
    panel.getByText("当前服务端不支持会话用量查询。", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "刷新会话用量", exact: true }),
  ).toBeDisabled();
  await panel.getByText("本地诊断包", { exact: true }).click();
  await panel
    .getByRole("button", { name: "导出到环境主机", exact: true })
    .click();
  await expect(
    panel.getByText("当前服务端不支持保存本地诊断包。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "消息输入框" })).toBeVisible();
});

test("session tools remain readable in English, dark mode and a narrow viewport", async ({
  page,
}) => {
  const panel = await tools(page);
  await panel.getByText("会话用量与费用", { exact: true }).click();
  await panel
    .getByRole("button", { name: "刷新会话用量", exact: true })
    .click();
  await expect(panel.getByText("USD 0.123456", { exact: true })).toBeVisible();
  await panel.getByText("本地诊断包", { exact: true }).click();
  await page.locator("[data-settings-trigger]").first().click();
  const settings = page.getByRole("dialog", { name: "连接与设置" });
  await settings.getByRole("tab", { name: "通用", exact: true }).click();
  await settings
    .getByRole("combobox", { name: "界面语言", exact: true })
    .click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Connections and settings" })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.emulateMedia({ colorScheme: "dark" });
  const englishPanel = page.getByRole("complementary", {
    name: "Project panel",
  });
  await expect(
    englishPanel.getByText("Native USD usage", { exact: true }),
  ).toBeVisible();
  await expect(
    englishPanel.getByLabel("ZIP path on environment host", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    englishPanel.getByLabel("ZIP path on environment host", { exact: true }),
  ).toHaveCSS("background-color", "rgb(27, 29, 30)");
  await page.screenshot({
    path: test.info().outputPath("desktop-en-dark.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const drawer = page.getByRole("dialog", {
    name: "Project panel",
    exact: true,
  });
  await expect(drawer).toBeVisible();
  const mobilePanel = drawer.getByRole("complementary", {
    name: "Project panel",
  });
  const diagnostic = mobilePanel.locator("details").filter({
    has: page.locator("summary", { hasText: "Local diagnostic bundle" }),
  });
  if (
    !(await diagnostic.evaluate(
      (element) => (element as HTMLDetailsElement).open,
    ))
  )
    await diagnostic.locator(":scope > summary").click();
  await diagnostic
    .getByLabel("ZIP path on environment host", { exact: true })
    .scrollIntoViewIfNeeded();
  await diagnostic
    .locator(":scope > summary")
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
  await expect(
    diagnostic.getByRole("button", {
      name: "Export to environment host",
      exact: true,
    }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    await englishPanel.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("mobile.png"),
    fullPage: true,
  });
});
