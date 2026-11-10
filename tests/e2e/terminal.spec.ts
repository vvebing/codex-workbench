import { once } from "node:events";
import { expect, test, type Page } from "@playwright/test";
import { createMockServer } from "../fixtures/app-server";

let server: ReturnType<typeof createMockServer>;
let endpoint: string;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("codex-environments"))
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
  server = createMockServer({
    terminal: true,
    terminalActivity: !test
      .info()
      .title.startsWith("terminal without prompt integration"),
    commandExec: ({ command }) =>
      command[0] === "/bin/sh" && command[1] === "-lc"
        ? { stdout: "project-task-marker\n", exitCode: 0 }
        : undefined,
    initialAnswer: test.info().title.startsWith("shell code")
      ? "```sh\necho safe-marker\n```"
      : undefined,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture address");
  endpoint = `ws://127.0.0.1:${address.port}`;
});
test.afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

async function selectThread(page: Page, title: string) {
  await page
    .getByRole("complementary")
    .getByRole("button", { name: /^搜索会话/ })
    .click();
  const search = page.getByRole("dialog", { name: "搜索会话" });
  await search.getByPlaceholder("搜索标题、摘要或工作区…").fill(title);
  await search
    .getByRole("option")
    .filter({ has: page.getByText(title, { exact: true }) })
    .click();
  await expect(search).toBeHidden();
}
async function openProject(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "连接工作环境", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "连接与设置" });
  await settings.getByRole("tab", { name: "工作环境", exact: true }).click();
  await settings.getByLabel("App-server 地址").fill(endpoint);
  await settings.getByRole("button", { name: "连接", exact: true }).click();
  await expect(settings).toBeHidden();
  await selectThread(page, "工作区导航与搜索 · 1");
  await expect(page.getByRole("textbox", { name: "消息输入框" })).toBeVisible();
}
const shells = () =>
  server.requestLog.filter(
    (request) => request.method === "command/exec" && request.params?.tty,
  );
const panel = (page: Page) => page.locator("[data-slot=terminal-panel]");
async function expectOutputSpace(page: Page, minimum = 0.8) {
  await expect
    .poll(async () => {
      const dock = await panel(page).boundingBox();
      const output = await panel(page)
        .locator("[data-slot=terminal-surface]")
        .boundingBox();
      return dock && output ? output.height / dock.height : 0;
    })
    .toBeGreaterThanOrEqual(minimum);
}
async function shellReady(page: Page) {
  await expect(panel(page).locator(".xterm-rows")).toContainText(
    "Workbench fixture terminal",
  );
}
async function newShell(page: Page) {
  await panel(page)
    .getByRole("button", { name: "新建终端", exact: true })
    .last()
    .click();
  await expect(panel(page).locator(".xterm-rows")).toContainText(
    "Workbench fixture terminal",
  );
}
async function command(page: Page, text: string) {
  const input = panel(page).getByRole("textbox", {
    name: "终端输入",
    exact: true,
  });
  await expect(input).toBeEditable();
  await input.focus();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}
async function expectPrompt(page: Page, directory: string) {
  await expect
    .poll(async () =>
      (await panel(page).locator(".xterm-rows").innerText())
        .trimEnd()
        .endsWith(`${directory} $`),
    )
    .toBe(true);
}

test("project terminal opens ready with a read-only policy, streams input and survives folding", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openProject(page);
  expect(shells()).toHaveLength(0);
  await page.locator("[data-slot=terminal-toggle]").click();
  await expect(panel(page)).toBeVisible();
  await shellReady(page);
  expect(shells()).toHaveLength(1);
  expect(shells()[0].cwd).toBe("/demo/atlas-web");
  expect(shells()[0].sandboxPolicy).toEqual({
    type: "readOnly",
    networkAccess: false,
  });
  expect(shells()[0].params?.env).toMatchObject({ GIT_OPTIONAL_LOCKS: "0" });
  await expect(panel(page).locator("[data-slot=terminal-readonly]")).toHaveText(
    "只读",
  );
  await expectPrompt(page, "/demo/atlas-web");
  const coloredPath = panel(page)
    .locator(".xterm-fg-2")
    .filter({ hasText: "/demo/atlas-web" })
    .last();
  await expect(coloredPath).toBeVisible();
  const lightPathColor = await coloredPath.evaluate(
    (element) => getComputedStyle(element).color,
  );
  const foreground = await panel(page)
    .locator(".xterm-rows")
    .evaluate((element) => getComputedStyle(element).color);
  expect(lightPathColor).not.toBe(foreground);
  await command(page, "cd src");
  await expectPrompt(page, "/demo/atlas-web/src");
  await command(page, "cd ..");
  await expectPrompt(page, "/demo/atlas-web");
  await command(page, "git status");
  await expect(panel(page).locator(".xterm-rows")).toContainText(
    "On branch fixture/terminal",
  );
  await page.setViewportSize({ width: 1280, height: 850 });
  await expect
    .poll(
      () =>
        server.requestLog.filter(
          (request) => request.method === "command/exec/resize",
        ).length,
    )
    .toBeGreaterThan(0);
  await page.locator("[data-slot=terminal-toggle]").click();
  await expect(panel(page)).toBeHidden();
  await page.locator("[data-slot=terminal-toggle]").click();
  await expect(panel(page).locator(".xterm-rows")).toContainText(
    "On branch fixture/terminal",
  );
  expect(shells()).toHaveLength(1);
  expect(
    server.requestLog.filter(
      (request) => request.method === "command/exec/terminate",
    ),
  ).toHaveLength(0);
  expect(errors).toEqual([]);
  await expect(panel(page).locator(".terminal-surface")).toHaveCSS(
    "box-shadow",
    "none",
  );
  await expect(panel(page).locator(".terminal-surface")).toHaveCSS(
    "border-bottom-width",
    "0px",
  );
  await expectOutputSpace(page);
  await page.screenshot({
    path: "output/terminal-desktop.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    localStorage.setItem("codex-workbench.theme", "dark");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "codex-workbench.theme",
        newValue: "dark",
      }),
    );
  });
  await expect(panel(page).locator(".terminal-view-tab").first()).toHaveCSS(
    "color",
    "rgb(151, 200, 169)",
  );
  await expect(coloredPath).not.toHaveCSS("color", lightPathColor);
  await page.screenshot({
    path: "output/terminal-desktop-dark.png",
    fullPage: true,
  });
});

test("shell code is copied intact and only inserted after explicit action without Enter", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await openProject(page);
  const block = page.locator(".group\\/code").last();
  await block.hover();
  await block.getByRole("button", { name: "复制代码", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "echo safe-marker\n",
  );
  await block.getByRole("button", { name: "填入终端", exact: true }).click();
  await expect(panel(page)).toBeVisible();
  expect(shells()).toHaveLength(0);
  await expect(
    panel(page).getByRole("textbox", {
      name: "待填入的命令（按 Enter 才执行）",
    }),
  ).toHaveValue("echo safe-marker");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    panel(page).getByRole("textbox", {
      name: "待填入的命令（按 Enter 才执行）",
    }),
  ).toHaveAttribute("readonly", "");
  await expect(
    panel(page).getByRole("button", { name: "填入终端", exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await newShell(page);
  await panel(page)
    .getByRole("button", { name: "填入终端", exact: true })
    .click();
  const writes = server.requestLog.filter(
    (request) => request.method === "command/exec/write",
  );
  expect(
    writes
      .map((request) =>
        Buffer.from(String(request.params?.deltaBase64), "base64").toString(),
      )
      .join(""),
  ).toBe("echo safe-marker");
  await panel(page)
    .getByRole("textbox", { name: "终端输入", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(panel(page).locator(".xterm-rows")).toContainText("safe-marker");
});

test("read-only terminal stays usable after a denied write without any setup", async ({
  page,
}) => {
  await openProject(page);
  await page.locator("[data-slot=terminal-toggle]").click();
  await shellReady(page);
  await command(page, "git branch");
  await expect(panel(page).locator(".xterm-rows")).toContainText(
    "* fixture/terminal",
  );
  await command(page, "touch readonly-probe");
  await expect(panel(page).locator(".xterm-rows")).toContainText(
    "Read-only file system",
  );
  await command(page, "git status");
  await expect(panel(page).locator(".xterm-rows")).toContainText(
    "On branch fixture/terminal",
  );
  expect(shells()).toHaveLength(1);
  expect(shells()[0].sandboxPolicy).toEqual({
    type: "readOnly",
    networkAccess: false,
  });
  await panel(page).locator("[data-slot=terminal-scope]").click();
  const details = page.locator("[data-slot=terminal-details]");
  await expect(details).toContainText("只读");
  await expect(details).toContainText("内容搜索");
  await expect(details).toContainText("日志查看");
  await expect(details).toContainText("网络受限");
  await expect(details).not.toContainText("调整执行环境权限后重连");
  await page.screenshot({
    path: "output/terminal-command-scope.png",
    fullPage: true,
  });
});

test("opening terminal on mobile does not start a shell", async ({ page }) => {
  await openProject(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-slot=terminal-toggle]").click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText("手机仅支持查看输出");
  expect(shells()).toHaveLength(0);
});

test("directory terminal starts in the selected folder and keeps project ownership", async ({
  page,
}) => {
  await openProject(page);
  await page.getByRole("button", { name: "打开项目面板", exact: true }).click();
  const files = page.getByRole("region", { name: "项目文件", exact: true });
  await files.locator('[data-file-entry="src"] button').first().click();
  await files
    .getByRole("button", { name: "在此目录新建终端", exact: true })
    .click();
  await expect(panel(page).locator(".xterm-rows")).toContainText(
    "Workbench fixture terminal",
  );
  expect(shells()).toHaveLength(1);
  expect(shells()[0].cwd).toBe("/demo/atlas-web/src");
  await panel(page).locator("[data-slot=terminal-scope]").click();
  await expect(page.locator("[data-slot=terminal-details]")).toContainText(
    "/demo/atlas-web",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-slot=terminal-details]")).toBeHidden();
  await command(page, "pwd");
  await expect(panel(page).locator(".xterm-rows")).toContainText(
    "/demo/atlas-web/src",
  );
});

test("project task output shares the dock while an interactive shell stays alive", async ({
  page,
}) => {
  await openProject(page);
  await page.locator("[data-slot=terminal-toggle]").click();
  await shellReady(page);
  await page.getByRole("button", { name: "打开项目面板", exact: true }).click();
  await page.getByRole("tab", { name: "工作区", exact: true }).click();
  const workspace = page.getByRole("region", { name: "工作区", exact: true });
  await workspace
    .getByRole("textbox", { name: "test 命令", exact: true })
    .fill("echo project-task-marker");
  await workspace
    .getByRole("button", { name: "运行 test", exact: true })
    .click();
  await expect(
    panel(page).getByRole("button", { name: "项目命令", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    panel(page).locator("[data-slot=terminal-readonly]"),
  ).toHaveCount(0);
  await expect(
    panel(page).getByLabel("命令输出", { exact: true }),
  ).toContainText("project-task-marker");
  await expect
    .poll(async () => {
      const dock = await panel(page).boundingBox();
      const output = await panel(page)
        .locator('[data-slot="project-task-log"]')
        .boundingBox();
      return dock && output ? output.height / dock.height : 0;
    })
    .toBeGreaterThanOrEqual(0.7);
  await expect(
    panel(page).getByRole("button", { name: "停止", exact: true }),
  ).toHaveCount(0);
  await panel(page)
    .getByRole("button", { name: "命令详情", exact: true })
    .click();
  const details = page.getByRole("dialog", { name: "命令详情", exact: true });
  await expect(details).toContainText("echo project-task-marker");
  await expect(details).toContainText("/demo/atlas-web");
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await workspace
    .getByRole("textbox", { name: "build 命令", exact: true })
    .fill("echo second-task-marker");
  await workspace
    .getByRole("button", { name: "运行 build", exact: true })
    .click();
  const history = panel(page).getByRole("combobox", {
    name: "选择运行记录",
    exact: true,
  });
  await expect(history).toHaveAttribute("title", "echo second-task-marker");
  await history.selectOption({ index: 0 });
  await expect(history).toHaveAttribute("title", "echo project-task-marker");
  await history.selectOption({ index: 1 });
  await expect(history).toHaveAttribute("title", "echo second-task-marker");
  await page
    .locator("[data-slot=topbar]")
    .getByRole("button", { name: "关闭项目面板", exact: true })
    .click();
  await page.screenshot({
    path: "output/terminal-task-output.png",
    fullPage: true,
  });
  await panel(page).getByRole("button", { name: "终端", exact: true }).click();
  await command(page, "echo shell-still-alive");
  await expect(panel(page).locator(".xterm-rows")).toContainText(
    "shell-still-alive",
  );
  expect(shells()).toHaveLength(1);
  expect(
    server.requestLog.filter(
      (request) => request.method === "command/exec/terminate",
    ),
  ).toHaveLength(0);
});

test("selected terminal output is added to the draft without sending or replacing it", async ({
  page,
}) => {
  await openProject(page);
  await page.getByRole("textbox", { name: "消息输入框" }).fill("保留的草稿");
  await page.locator("[data-slot=terminal-toggle]").click();
  await shellReady(page);
  await command(page, "echo draftmarker");
  const line = panel(page)
    .locator(".xterm-rows")
    .getByText("draftmarker", { exact: true })
    .last();
  await expect(line).toBeVisible();
  const bounds = await line.boundingBox();
  if (!bounds) throw new Error("No terminal output bounds");
  // The xterm screen intentionally handles pointer input above its text rows.
  await page.mouse.dblclick(bounds.x + 5, bounds.y + bounds.height / 2);
  await panel(page)
    .getByRole("button", { name: "添加到对话", exact: true })
    .click();
  const draft = page.getByRole("textbox", { name: "消息输入框" });
  await expect(draft).toContainText("保留的草稿");
  await expect(draft).toContainText("draftmarker");
  await expect(draft).toContainText("/demo/atlas-web");
  expect(
    server.requestLog.filter((request) => request.method === "turn/start"),
  ).toHaveLength(0);
});

test("project terminals keep concurrent sessions and isolate another project", async ({
  page,
}) => {
  await openProject(page);
  await page.locator("[data-slot=terminal-toggle]").click();
  await shellReady(page);
  await command(page, "echo first-project-marker");
  await newShell(page);
  expect(shells()).toHaveLength(2);
  await selectThread(page, "设计令牌与暗色模式 · 2");
  if (!(await panel(page).isVisible()))
    await page.locator("[data-slot=terminal-toggle]").click();
  await expect(panel(page)).not.toContainText("first-project-marker");
  await newShell(page);
  expect(shells().at(-1)?.cwd).toBe("/demo/design-system");
  await selectThread(page, "工作区导航与搜索 · 1");
  if (!(await panel(page).isVisible()))
    await page.locator("[data-slot=terminal-toggle]").click();
  await expect(
    panel(page)
      .getByRole("group", { name: "终端会话", exact: true })
      .locator('[data-slot="terminal-tab"]'),
  ).toHaveCount(2);
  expect(shells()).toHaveLength(3);
});

test("terminal ends explicitly and page recreation does not replay shell creation", async ({
  page,
}) => {
  await openProject(page);
  await page.locator("[data-slot=terminal-toggle]").click();
  await shellReady(page);
  await expect(
    panel(page).locator('[data-slot="terminal-tab"]').first(),
  ).toHaveAttribute("data-activity", "idle");
  await panel(page)
    .getByRole("button", { name: "关闭终端 1", exact: true })
    .click();
  await expect
    .poll(
      () =>
        server.requestLog.filter(
          (request) => request.method === "command/exec/terminate",
        ).length,
    )
    .toBe(1);
  await expect(panel(page).locator('[data-slot="terminal-tab"]')).toHaveCount(
    0,
  );
  await expect(page.getByRole("dialog", { name: /关闭.*终端/ })).toHaveCount(0);
  await newShell(page);
  const context = page.context();
  const address = page.url();
  await page.close();
  page = await context.newPage();
  await page.goto(address);
  await expect(page.locator("[data-slot=terminal-toggle]")).toBeVisible();
  await page.locator("[data-slot=terminal-toggle]").click();
  await expect(panel(page)).toContainText("核实");
  expect(shells()).toHaveLength(2);
  await panel(page)
    .getByRole("button", { name: "关闭终端 1", exact: true })
    .click();
  const record = page.getByRole("dialog", {
    name: "移除状态未知的终端记录？",
    exact: true,
  });
  await expect(record).toContainText("不会终止原进程");
  await record.getByRole("button", { name: "仅移除记录", exact: true }).click();
  await expect(panel(page).locator('[data-slot="terminal-tab"]')).toHaveCount(
    0,
  );
  expect(
    server.requestLog.filter(
      (request) => request.method === "command/exec/terminate",
    ),
  ).toHaveLength(1);
});

test("mobile terminal is output only without creating or writing a shell", async ({
  page,
}) => {
  await openProject(page);
  await page.locator("[data-slot=terminal-toggle]").click();
  await shellReady(page);
  await command(page, "echo mobile-output-marker");
  const before = server.requestLog.filter(
    (request) => request.method === "command/exec/write",
  ).length;
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator(".xterm-rows")).toContainText(
    "mobile-output-marker",
  );
  await expectOutputSpace(page);
  const create = panel(page).getByRole("button", {
    name: "新建终端",
    exact: true,
  });
  if (await create.count()) await expect(create).toBeDisabled();
  await expect(
    panel(page).getByRole("button", { name: "关闭终端 1", exact: true }),
  ).toBeDisabled();
  await expect(
    panel(page).getByRole("textbox", { name: "终端输出（只读）", exact: true }),
  ).toHaveAttribute("readonly", "");
  expect(
    server.requestLog.filter(
      (request) => request.method === "command/exec/write",
    ),
  ).toHaveLength(before);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "output/terminal-mobile.png", fullPage: true });
});

test("tab close for an inactive idle terminal preserves the selected shell", async ({
  page,
}) => {
  await openProject(page);
  await page.locator("[data-slot=terminal-toggle]").click();
  await shellReady(page);
  await newShell(page);
  const tabs = panel(page).locator('[data-slot="terminal-tab"]');
  const activeId = await tabs.last().getAttribute("data-terminal-id");
  await expect(tabs.first()).toHaveAttribute("data-activity", "idle");
  const select = await tabs
    .first()
    .locator(".terminal-session-tab")
    .boundingBox();
  const close = await tabs
    .first()
    .getByRole("button", { name: "关闭终端 1", exact: true })
    .boundingBox();
  expect(select && close && close.x >= select.x + select.width).toBeTruthy();
  await tabs
    .first()
    .getByRole("button", { name: "关闭终端 1", exact: true })
    .click();
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toHaveAttribute("data-terminal-id", activeId!);
  await expect(tabs.first()).toHaveAttribute("data-active", "true");
  await expect(page.getByRole("dialog", { name: /关闭.*终端/ })).toHaveCount(0);
  await command(page, "echo selected-shell-remains");
  await expect(panel(page).locator(".xterm-rows")).toContainText(
    "selected-shell-remains",
  );
});

test("busy terminal close confirms interruption and cancel leaves the task running", async ({
  page,
}) => {
  await openProject(page);
  await page.locator("[data-slot=terminal-toggle]").click();
  await shellReady(page);
  await command(page, "sleep 30");
  const tab = panel(page).locator('[data-slot="terminal-tab"]').first();
  await expect(tab).toHaveAttribute("data-activity", "busy");
  await expect(tab).toContainText("运行中");
  await tab.getByRole("button", { name: "关闭终端 1", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "关闭运行中的终端？",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  expect(
    server.requestLog.filter(
      (request) => request.method === "command/exec/terminate",
    ),
  ).toHaveLength(0);
  await page.screenshot({
    path: "output/terminal-close-running.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(tab).toHaveAttribute("data-activity", "busy");
  await panel(page)
    .getByRole("textbox", { name: "终端输入", exact: true })
    .focus();
  await page.keyboard.press("Control+c");
  await expect(tab).toHaveAttribute("data-activity", "idle");
  await command(page, "sleep 30");
  await expect(tab).toHaveAttribute("data-activity", "busy");
  await tab.getByRole("button", { name: "关闭终端 1", exact: true }).click();
  await dialog
    .getByRole("button", { name: "关闭并终止任务", exact: true })
    .click();
  await expect(panel(page).locator('[data-slot="terminal-tab"]')).toHaveCount(
    0,
  );
  expect(
    server.requestLog.filter(
      (request) => request.method === "command/exec/terminate",
    ),
  ).toHaveLength(1);
});

test("background terminal tasks also require confirmation before closing", async ({
  page,
}) => {
  await openProject(page);
  await page.locator("[data-slot=terminal-toggle]").click();
  await shellReady(page);
  await command(page, "sleep 30 &");
  const tab = panel(page).locator('[data-slot="terminal-tab"]').first();
  await expect(tab).toContainText("后台任务运行中");
  await tab.getByRole("button", { name: "关闭终端 1", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "关闭运行中的终端？",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await command(page, "wait");
  await expect(tab).toHaveAttribute("data-activity", "idle");
  await tab.getByRole("button", { name: "关闭终端 1", exact: true }).click();
  await expect(panel(page).locator('[data-slot="terminal-tab"]')).toHaveCount(
    0,
  );
});

test("multiline terminal paste stays protected while a queued command is running", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await openProject(page);
  await page.locator("[data-slot=terminal-toggle]").click();
  await shellReady(page);
  const tab = panel(page).locator('[data-slot="terminal-tab"]').first();
  await expect(tab).toHaveAttribute("data-activity", "idle");
  await panel(page)
    .getByRole("textbox", { name: "终端输入", exact: true })
    .focus();
  await page.evaluate(() =>
    navigator.clipboard.writeText("echo first-queued-command\nsleep 30\n"),
  );
  await page.keyboard.press("Control+Shift+v");
  await expect(panel(page).locator(".xterm-rows")).toContainText(
    "fixture process running",
  );
  await expect(tab).not.toHaveAttribute("data-activity", "idle");
  await tab.getByRole("button", { name: "关闭终端 1", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^关闭.*终端/ });
  await expect(dialog).toBeVisible();
  expect(
    server.requestLog.filter(
      (request) => request.method === "command/exec/terminate",
    ),
  ).toHaveLength(0);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(tab).toBeVisible();
});

test("terminal without prompt integration does not guess that the shell is idle", async ({
  page,
}) => {
  await openProject(page);
  await page.locator("[data-slot=terminal-toggle]").click();
  await shellReady(page);
  const tab = panel(page).locator('[data-slot="terminal-tab"]').first();
  await expect(tab).toHaveAttribute("data-activity", "unknown");
  await expect(tab).toContainText("状态待确认");
  await tab.getByRole("button", { name: "关闭终端 1", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "关闭状态未确认的终端？",
    exact: true,
  });
  await expect(dialog).toContainText("无法确认终端是否空闲");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(
    server.requestLog.filter(
      (request) => request.method === "command/exec/terminate",
    ),
  ).toHaveLength(0);
});

test("exited terminal tabs close without sending another termination request", async ({
  page,
}) => {
  await openProject(page);
  await page.locator("[data-slot=terminal-toggle]").click();
  await shellReady(page);
  await command(page, "exit");
  await expect(panel(page)).toContainText("已退出");
  await panel(page)
    .getByRole("button", { name: "关闭终端 1", exact: true })
    .click();
  await expect(panel(page).locator('[data-slot="terminal-tab"]')).toHaveCount(
    0,
  );
  expect(
    server.requestLog.filter(
      (request) => request.method === "command/exec/terminate",
    ),
  ).toHaveLength(0);
});

test("terminal focus mode uses the main workspace and restores the conversation draft", async ({
  page,
}) => {
  await openProject(page);
  await page
    .getByRole("textbox", { name: "消息输入框" })
    .fill("保留的专注模式草稿");
  await page.locator("[data-slot=terminal-toggle]").click();
  await shellReady(page);
  await panel(page)
    .getByRole("button", { name: "最大化终端", exact: true })
    .click();
  await expect(page.locator(".conversation-workspace")).toBeHidden();
  await expectOutputSpace(page, 0.9);
  await command(page, "echo focused-terminal");
  await expect(panel(page).locator(".xterm-rows")).toContainText(
    "focused-terminal",
  );
  await page.screenshot({
    path: "output/terminal-focus-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "打开导航", exact: true }),
  ).toBeVisible();
  await expect(panel(page)).toHaveAttribute("data-maximized", "true");
  await expect(page.locator(".conversation-workspace")).toBeHidden();
  await expectOutputSpace(page, 0.9);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollHeight <= innerHeight),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "output/terminal-focus-mobile.png",
    fullPage: true,
  });
  await panel(page)
    .getByRole("button", { name: "还原终端高度", exact: true })
    .click();
  const draft = page.getByRole("textbox", { name: "消息输入框" });
  await expect(draft).toBeVisible();
  await expect(draft).toContainText("保留的专注模式草稿");
  expect(
    server.requestLog.filter((request) => request.method === "turn/start"),
  ).toHaveLength(0);
});
