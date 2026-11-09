import { expect, test } from "@playwright/test";

const errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) =>
    errors.push("Unexpected WebSocket: " + socket.url()),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin !== "http://127.0.0.1:5183" ||
      !url.pathname.startsWith("/codex-workbench/")
    ) {
      errors.push("Unexpected service request: " + url.href);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("./");
  await expect(page.locator('[data-slot="demo-banner"]')).toBeVisible();
  await expect(page.getByRole("textbox", { name: "消息输入框" })).toBeVisible();
  await expect(page.locator('[data-slot="conversation-turn"]')).toHaveCount(1);
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

test("uses the real conversation UI, sends a simulated turn, and resets history", async ({
  page,
}) => {
  await page
    .getByRole("textbox", { name: "消息输入框" })
    .fill("总结这个任务的变更");
  await page.locator("[data-slot=composer-action]").click();
  await expect(page.locator('[data-slot="conversation-turn"]')).toHaveCount(2);
  await expect(
    page.getByText("这是一条预设的演示回复，未调用模型。", { exact: false }),
  ).toBeVisible();
  await expect(
    page.locator('[data-slot="conversation-turn-footer"]').last(),
  ).toContainText("已完成");
  await page.getByRole("button", { name: "重置演示", exact: true }).click();
  await expect(page.locator('[data-slot="conversation-turn"]')).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "消息输入框" })).toBeVisible();
});

test("switches existing sessions and preserves query routes on reload", async ({
  page,
}) => {
  const session = page.getByText("统一按钮与焦点状态", { exact: true }).first();
  await session.click();
  await expect(page).toHaveURL(/session=demo-thread-002/);
  await page.reload();
  await expect(page.locator('[data-slot="conversation-turn"]')).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "消息输入框" })).toBeVisible();
});

test("keeps the actual workbench and reset control usable on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(
    page.getByRole("button", { name: "重置演示", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "消息输入框" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "重置演示", exact: true }).click();
  await expect(page.locator('[data-slot="conversation-turn"]')).toHaveCount(1);
});

test("opens the production Monaco diff and saves virtual files through the original editor", async ({
  page,
}) => {
  await expect(page.locator('[data-slot="branch-changes"]')).toContainText(
    "改动 1 个文件",
  );
  await page.locator('[data-slot="header-branch"]').click();
  await page
    .getByRole("button", { name: "src/ProjectList.tsx", exact: true })
    .click();
  const workspace = page.getByRole("region", { name: "文件编辑工作区" });
  await expect(workspace.locator(".monaco-diff-editor")).toBeVisible();
  await expect(
    workspace.locator(".monaco-diff-editor .modified .view-lines"),
  ).toContainText("query");
  await workspace
    .getByRole("button", { name: "返回会话", exact: true })
    .click();
  await page.getByRole("tab", { name: "文件", exact: true }).click();
  await page.getByText("README.md", { exact: true }).last().dblclick();
  await expect(workspace.locator(".monaco-editor")).toBeVisible();
  await workspace.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("# Edited demo file\n");
  await workspace.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  await expect(
    workspace.getByText("Git 行标记不可用", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('[data-slot="branch-changes"]')).toContainText(
    "改动 2 个文件",
  );
});

test("creates a session using the production composer and simulated protocol", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "在 atlas-web 新建会话", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "新建会话", exact: true })
    .getByRole("button", { name: "创建会话", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "消息输入框" })
    .fill("创建一个演示任务");
  await page.locator("[data-slot=composer-action]").click();
  await expect(page.locator('[data-slot="conversation-turn"]')).toHaveCount(1);
  await expect(
    page.locator('[data-slot="conversation-turn-footer"]').last(),
  ).toContainText("已完成");
  await expect(
    page.getByText("这是一条预设的演示回复，未调用模型。", { exact: false }),
  ).toBeVisible();
});

test("uses existing appearance settings and explains unavailable local terminal output", async ({
  page,
}) => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("radio", { name: /深色/ }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("tab", { name: "终端输出", exact: true }).click();
  await expect(
    page.getByText(
      "演示模式不启动本机服务或读取终端输出。请在本机安装工作台后使用。",
      { exact: true },
    ),
  ).toBeVisible();
});
