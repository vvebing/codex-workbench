import { expect, test, type Page } from "@playwright/test";

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

const terminalPanel = (page: Page) =>
  page.locator("[data-slot=terminal-panel]");
async function expectTerminalPrompt(page: Page, directory: string) {
  await expect
    .poll(async () =>
      (await terminalPanel(page).locator(".xterm-rows").innerText())
        .trimEnd()
        .endsWith(`${directory} $`),
    )
    .toBe(true);
}
async function openTerminal(page: Page) {
  await page.locator("[data-slot=terminal-toggle]").click();
  await expect(
    terminalPanel(page).locator('[data-slot="terminal-tab"]').first(),
  ).toHaveAttribute("data-activity", "idle");
  await expect(terminalPanel(page).locator(".xterm-rows")).toContainText(
    "模拟",
  );
  await expectTerminalPrompt(page, "/demo/atlas-web");
}
async function terminalCommand(page: Page, command: string) {
  await terminalPanel(page)
    .getByRole("textbox", { name: "终端输入", exact: true })
    .focus();
  if (
    Array.from(command).some((character) => character.codePointAt(0)! > 127)
  ) {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate((text) => navigator.clipboard.writeText(text), command);
    await page.keyboard.press("Control+Shift+v");
    await expect(terminalPanel(page).locator(".xterm-rows")).toContainText(
      command,
    );
  } else await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

test("runs simulated read-only directory, text, pipeline and Git commands", async ({
  page,
}) => {
  await openTerminal(page);
  const rows = terminalPanel(page).locator(".xterm-rows");
  await terminalCommand(page, "help");
  await expect(rows).toContainText("pwd");
  await expect(rows).toContainText("tail");
  await terminalCommand(page, "pwd");
  await expect(rows).toContainText("/demo/atlas-web");
  await terminalCommand(page, "ls");
  await expect(rows).toContainText("README.md");
  await expect(
    rows.locator(".xterm-fg-4").filter({ hasText: "docs" }),
  ).toBeVisible();
  await terminalCommand(page, "cat README.md | head -n 1");
  await expect(rows).toContainText("# atlas-web");
  await terminalCommand(page, "cd src");
  await expectTerminalPrompt(page, "/demo/atlas-web/src");
  await terminalCommand(page, "pwd");
  await expect(rows).toContainText("/demo/atlas-web/src");
  await terminalCommand(page, "head -n 1 ProjectList.tsx");
  await expect(rows).toContainText("export const projects");
  await terminalCommand(page, "cd ..");
  await expectTerminalPrompt(page, "/demo/atlas-web");
  await terminalCommand(page, "rg -n projects src");
  await expect(rows).toContainText("ProjectList.tsx");
  await expect(
    rows.locator(".xterm-fg-2").filter({ hasText: "projects" }).first(),
  ).toBeVisible();
  await terminalCommand(page, "cat 'docs/示例 说明.md'");
  await expect(rows).toContainText("只读终端可以查看");
  await terminalCommand(page, "git branch");
  await expect(rows).toContainText("demo/workbench");
  await terminalCommand(page, "git diff");
  await expect(rows.locator(".xterm-fg-1").first()).toBeVisible();
  await terminalCommand(page, "uname -s");
  await expect(rows).toContainText("DemoBrowser");
  await terminalCommand(page, "touch forbidden.txt");
  await expect(rows).toContainText(
    "只读演示终端不允许写入或联网：touch forbidden.txt",
  );
  await terminalCommand(page, "node --version");
  await expect(rows).toContainText(
    "演示终端尚未模拟此命令或参数：node --version",
  );
  await terminalCommand(page, "cat forbidden.txt");
  await expect(rows).toContainText("演示终端找不到路径：forbidden.txt");
  await page.screenshot({ path: "output/demo-terminal.png", fullPage: true });
  const path = rows
    .locator(".xterm-fg-2")
    .filter({ hasText: "/demo/atlas-web" })
    .last();
  const lightColor = await path.evaluate(
    (element) => getComputedStyle(element).color,
  );
  await page.evaluate(() => {
    localStorage.setItem("codex-workbench.theme", "dark");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "codex-workbench.theme",
        newValue: "dark",
      }),
    );
  });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(path).not.toHaveCSS("color", lightColor);
  await page.screenshot({
    path: "output/demo-terminal-dark.png",
    fullPage: true,
  });
});

test("tracks virtual log edits and protects a running terminal tab", async ({
  page,
}) => {
  await openTerminal(page);
  await terminalCommand(page, "tail -f logs/app.log");
  const panel = terminalPanel(page);
  const tabs = panel.locator('[data-slot="terminal-tab"]');
  await expect(tabs.first()).toHaveAttribute("data-activity", "busy");
  await expect(panel.locator(".xterm-rows")).toContainText(
    "Read-only terminal ready.",
  );
  const openFiles = page.getByRole("button", {
    name: "打开项目面板",
    exact: true,
  });
  if (await openFiles.count()) await openFiles.click();
  await page.getByRole("tab", { name: "文件", exact: true }).click();
  const files = page.getByRole("region", { name: "项目文件", exact: true });
  await files.locator('[data-file-entry="logs"] button').first().click();
  await files.getByText("app.log", { exact: true }).dblclick();
  const editor = page.getByRole("region", { name: "文件编辑工作区" });
  await expect(editor.locator(".monaco-editor")).toBeVisible();
  await editor.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(
    "[demo] Loaded example files.\n[demo] Read-only terminal ready.\n[demo] Example log updated.\n",
  );
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(panel.locator(".xterm-rows")).toContainText(
    "Example log updated.",
  );
  await editor.getByRole("button", { name: "返回会话", exact: true }).click();
  await panel.getByRole("button", { name: "新建终端", exact: true }).click();
  await expect(tabs).toHaveCount(2);
  await expect(tabs.last()).toHaveAttribute("data-active", "true");
  await tabs
    .first()
    .getByRole("button", { name: "关闭终端 1", exact: true })
    .click();
  const close = page.getByRole("dialog", {
    name: "关闭运行中的终端？",
    exact: true,
  });
  await expect(close).toBeVisible();
  await close.getByRole("button", { name: "取消", exact: true }).click();
  await expect(tabs.last()).toHaveAttribute("data-active", "true");
  await tabs.first().locator(".terminal-session-tab").click();
  await panel.getByRole("textbox", { name: "终端输入", exact: true }).focus();
  await page.keyboard.press("Control+c");
  await expect(tabs.first()).toHaveAttribute("data-activity", "idle");
  await terminalCommand(page, "pwd");
  await expect(panel.locator(".xterm-rows")).toContainText("/demo/atlas-web");
  await panel.getByRole("button", { name: "关闭终端 1", exact: true }).click();
  await expect(tabs).toHaveCount(1);
  await page
    .locator("[data-slot=topbar]")
    .getByRole("button", { name: "关闭项目面板", exact: true })
    .click();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole("textbox", { name: "终端输出（只读）", exact: true }),
  ).toHaveAttribute("readonly", "");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "output/demo-terminal-mobile.png",
    fullPage: true,
  });
});

test("reset starts a fresh virtual terminal and preserves real environment records", async ({
  page,
}) => {
  await openTerminal(page);
  await terminalCommand(page, "echo previous-demo-terminal");
  await expect(terminalPanel(page).locator(".xterm-rows")).toContainText(
    "previous-demo-terminal",
  );
  const realKey = 'codex-terminals:v1:["local","ws://127.0.0.1:4501/"]';
  await page.evaluate(
    ({ key }) => localStorage.setItem(key, "preserve-real-environment"),
    { key: realKey },
  );
  page.once("dialog", (dialog) => void dialog.accept());
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "重置演示", exact: true }).click(),
  ]);
  await expect(page.getByRole("textbox", { name: "消息输入框" })).toBeVisible();
  await openTerminal(page);
  await expect(
    terminalPanel(page).locator('[data-slot="terminal-tab"]'),
  ).toHaveCount(1);
  await expect(terminalPanel(page).locator(".xterm-rows")).not.toContainText(
    "previous-demo-terminal",
  );
  expect(await page.evaluate((key) => localStorage.getItem(key), realKey)).toBe(
    "preserve-real-environment",
  );
});
