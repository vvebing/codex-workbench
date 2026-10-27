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
async function menu(page: Page) {
  await page
    .getByRole("button", {
      name: "会话操作：接口分页与错误处理 · 10",
      exact: true,
    })
    .first()
    .click();
  return page.getByRole("menu", { name: "会话操作" });
}

test("thread goal is explicitly saved, receives live usage, and can be cleared", async ({
  page,
}) => {
  await openThread(page);
  const panel = await details(page);
  await panel.getByText("会话目标", { exact: true }).click();
  await panel
    .getByLabel("目标内容", { exact: true })
    .fill("完成协议端到端验证");
  await panel.getByRole("combobox", { name: "目标状态" }).click();
  await page.getByRole("option", { name: "已暂停", exact: true }).click();
  await panel
    .getByLabel("Token 预算（留空不限）", { exact: true })
    .fill("4000");
  expect(
    server.requestLog.some((entry) => entry.method === "thread/goal/set"),
  ).toBe(false);
  await panel.getByRole("button", { name: "保存目标", exact: true }).click();
  await expect(panel.getByText("状态：已暂停", { exact: true })).toBeVisible();
  await expect(
    panel.getByText("Token 用量：0 / 4000", { exact: true }),
  ).toBeVisible();
  server.publish({
    method: "thread/goal/updated",
    params: {
      threadId: "mock-thread-010",
      turnId: null,
      goal: {
        threadId: "mock-thread-010",
        objective: "完成协议端到端验证",
        status: "paused",
        tokenBudget: 4000,
        tokensUsed: 123,
        timeUsedSeconds: 7,
        createdAt: 1,
        updatedAt: 2,
      },
    },
  });
  await expect(
    panel.getByText("Token 用量：123 / 4000", { exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "清除目标", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "清除目标", exact: true }),
  ).toBeHidden();
  await expect(panel.getByText("目标已清除。", { exact: true })).toBeVisible();
});

test("thread references persist, expose owner lookup, and remove without uploading", async ({
  page,
}) => {
  await openThread(page);
  const panel = await details(page);
  await panel.getByText("参考资料", { exact: true }).click();
  await expect(panel.getByText(/不会上传文件内容/)).toBeVisible();
  await panel.getByLabel("资料名称", { exact: true }).fill("协议参考");
  await panel
    .getByLabel("链接或文件路径", { exact: true })
    .fill("https://example.invalid/protocol");
  await panel
    .getByRole("button", { name: "保存参考资料", exact: true })
    .click();
  const reference = panel.getByRole("article").filter({
    has: page.getByRole("link", { name: "协议参考", exact: true }),
  });
  await expect(
    reference.getByRole("link", { name: "协议参考" }),
  ).toHaveAttribute("href", "https://example.invalid/protocol");
  await reference
    .getByRole("button", { name: "查看所属会话", exact: true })
    .click();
  await expect(
    panel.getByText("mock-thread-010", { exact: true }),
  ).toBeVisible();
  await reference
    .getByRole("button", { name: "移除参考资料", exact: true })
    .click();
  await expect(
    panel.getByRole("link", { name: "协议参考", exact: true }),
  ).toBeHidden();
  expect(
    server.requestLog.some(
      (entry) => entry.method === "thread/attachmentOwner/list",
    ),
  ).toBe(true);
});

test("inline code reviews support all targets and stream into the existing conversation", async ({
  page,
}) => {
  await openThread(page);
  const panel = await details(page);
  await panel.getByText("代码审查", { exact: true }).click();
  const cases = [
    { type: "uncommittedChanges" },
    { type: "baseBranch", label: "基准分支", value: "main" },
    { type: "commit", label: "提交 SHA", value: "abc1234" },
    { type: "custom", label: "审查说明", value: "检查边界情况" },
  ];
  for (const [index, target] of cases.entries()) {
    await panel.getByRole("combobox", { name: "审查范围" }).click();
    await page
      .getByRole("option", {
        name: ["未提交修改", "与分支比较", "指定提交", "自定义审查"][index],
        exact: true,
      })
      .click();
    if (target.label)
      await panel.getByLabel(target.label, { exact: true }).fill(target.value!);
    await panel.getByRole("button", { name: "开始审查", exact: true }).click();
    await expect(
      page.getByText("模拟代码审查完成：未发现阻塞问题。", { exact: true }),
    ).toHaveCount(index + 1);
    await expect(
      panel.getByRole("button", { name: "开始审查", exact: true }),
    ).toBeEnabled();
  }
  expect(
    server.requestLog.filter((entry) => entry.method === "review/start"),
  ).toHaveLength(4);
});

test("environment account device login is cancellable and logout requires confirmation", async ({
  page,
}) => {
  await openThread(page);
  const dialog = await settings(page);
  await dialog.getByRole("button", { name: "设备码登录", exact: true }).click();
  await expect(dialog.getByText("DEMO-1234", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "打开登录授权页面", exact: true }),
  ).toHaveAttribute("href", "https://example.invalid/device");
  await dialog.getByRole("button", { name: "取消登录", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "设备码登录", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "退出账户", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "退出当前环境账户" });
  expect(
    server.requestLog.some((entry) => entry.method === "account/logout"),
  ).toBe(false);
  await confirm.getByRole("button", { name: "确认退出", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect
    .poll(() =>
      server.requestLog.some((entry) => entry.method === "account/logout"),
    )
    .toBe(true);
});

test("environment tools load effective configuration and complete MCP authorization", async ({
  page,
}) => {
  await openThread(page);
  const dialog = await settings(page, "模型与权限");
  const config = dialog.locator("section").filter({
    has: page.getByRole("heading", { name: "查看项目生效配置", exact: true }),
  });
  const browserPreference = await page.evaluate(() =>
    localStorage.getItem("codex-workbench.default-model"),
  );
  await expect(
    config.getByRole("button", { name: "读取配置", exact: true }),
  ).toBeDisabled();
  await config
    .getByLabel("查询目录", { exact: true })
    .fill("/demo/another-project");
  await config.getByRole("button", { name: "读取配置", exact: true }).click();
  await expect(config.getByText(/模型：mock-codex/)).toBeVisible();
  expect(
    server.requestLog.filter((entry) => entry.method === "config/read").at(-1)
      ?.cwd,
  ).toBe("/demo/another-project");
  const defaults = dialog.locator("section").filter({
    has: page.getByRole("heading", { name: "设备默认设置", exact: true }),
  });
  await defaults
    .getByLabel("设备默认模型", { exact: true })
    .fill("mock-updated");
  await defaults
    .getByRole("button", { name: "保存设备默认模型", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("配置已写入");
  await expect(config.getByText(/模型：mock-codex/)).toBeVisible();
  await config.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(config.getByText(/模型：mock-updated/)).toBeVisible();
  await config.getByLabel("查询目录", { exact: true }).fill("/demo/different");
  await expect(config.getByText(/模型：mock-updated/)).toHaveCount(0);
  await expect(
    config.getByRole("button", { name: "读取配置", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("codex-workbench.default-model"),
    ),
  ).toBe(browserPreference);
  await environmentScope(page, "工具与集成");
  await expect(config).toHaveCount(0);
  await expect(dialog.getByLabel("设备默认模型", { exact: true })).toHaveCount(
    0,
  );
  const mcp = dialog.locator("section").filter({
    has: page.getByRole("heading", { name: "MCP 服务", exact: true }),
  });
  await mcp.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(mcp.getByText(/demo-mcp/)).toBeVisible();
  await mcp.getByRole("button", { name: "OAuth 登录", exact: true }).click();
  await expect(
    mcp.getByRole("link", { name: "打开授权页", exact: true }),
  ).toHaveAttribute("href", "https://example.invalid/mcp");
  server.publish({
    method: "mcpServer/oauthLogin/completed",
    params: {
      name: "demo-mcp",
      threadId: null,
      loginId: "demo-oauth",
      success: true,
      error: null,
    },
  });
  await expect(dialog.getByText("MCP 登录成功", { exact: true })).toBeVisible();
});

test("sidebar sections persist moves and deletion without unsupported pin requests", async ({
  page,
}) => {
  await openThread(page);
  await expect(
    page.getByRole("combobox", { name: "管理分区", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "导航选项", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "分区筛选与管理", exact: true })
    .click();
  await page.getByRole("combobox", { name: "管理分区", exact: true }).click();
  await page.getByRole("option", { name: "管理分区…", exact: true }).click();
  const sections = page.getByRole("dialog", { name: "管理分区", exact: true });
  await sections.getByLabel("新分区名称", { exact: true }).fill("待审查");
  await sections.getByRole("button", { name: "新建分区", exact: true }).click();
  await expect(sections.getByText("待审查", { exact: true })).toBeVisible();
  await sections.getByRole("button", { name: "重命名", exact: true }).click();
  await sections.getByLabel("分区新名称", { exact: true }).fill("已规划");
  await sections.getByRole("button", { name: "保存名称", exact: true }).click();
  await expect(sections.getByText("已规划", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await (
    await menu(page)
  )
    .getByRole("menuitem", { name: "移动到分区", exact: true })
    .click();
  const move = page.getByRole("dialog", { name: "移动到分区", exact: true });
  await move.getByRole("combobox", { name: "目标分区" }).click();
  await page.getByRole("option", { name: "已规划", exact: true }).click();
  await move.getByRole("button", { name: "确认", exact: true }).click();
  await expect(move).toBeHidden();
  const threadMenu = await menu(page);
  await expect(threadMenu.getByRole("menuitem", { name: /置顶/ })).toHaveCount(
    0,
  );
  expect(
    server.requestLog.some(
      (entry) => entry.method === "thread/metadata/update",
    ),
  ).toBe(false);
  await page.keyboard.press("Escape");
  await (
    await menu(page)
  )
    .getByRole("menuitem", { name: "永久删除", exact: true })
    .click();
  const deletion = page.getByRole("dialog", {
    name: "永久删除会话",
    exact: true,
  });
  await expect(
    deletion.getByRole("button", { name: "确认", exact: true }),
  ).toBeDisabled();
  expect(
    server.requestLog.some((entry) => entry.method === "thread/delete"),
  ).toBe(false);
  await deletion.getByRole("checkbox").check();
  await deletion.getByRole("button", { name: "确认", exact: true }).click();
  await expect(deletion).toBeHidden();
  await expect
    .poll(() =>
      server.requestLog.some((entry) => entry.method === "thread/delete"),
    )
    .toBe(true);
});

test("available app mention is inserted into the selected draft and sent as structured input", async ({
  page,
}) => {
  await openThread(page);
  const dialog = await settings(page, "工具与集成");
  const apps = dialog.locator("section").filter({
    has: page.getByRole("heading", { name: "可用应用", exact: true }),
  });
  await apps.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(
    apps.getByText("演示笔记 · 已启用", { exact: true }),
  ).toBeVisible();
  await apps.getByRole("button", { name: "插入应用提及", exact: true }).click();
  await expect(dialog).toBeHidden();
  const composer = page.getByRole("textbox", {
    name: "消息输入框",
    exact: true,
  });
  await expect(composer).toContainText("演示笔记");
  await composer.press("End");
  await composer.pressSequentially(" 请检查演示笔记");
  await page.locator("[data-slot=composer-action]").click();
  await expect
    .poll(
      () =>
        server.requestLog.find((entry) => entry.method === "turn/start")?.input,
    )
    .toEqual(
      expect.arrayContaining([
        { type: "mention", name: "演示笔记", path: "app://mock-notes" },
      ]),
    );
});

test("configuration migration requires selected items and displays asynchronous completion and history", async ({
  page,
}) => {
  await openThread(page);
  const dialog = await settings(page, "配置迁移");
  const migration = dialog.locator("section").filter({
    has: page.getByRole("heading", { name: "外部配置迁移", exact: true }),
  });
  expect(
    server.requestLog.some(
      (entry) => entry.method === "externalAgentConfig/detect",
    ),
  ).toBe(false);
  await migration
    .getByRole("button", { name: "探测可迁移内容", exact: true })
    .click();
  await expect(
    migration.getByRole("button", { name: "导入所选（0）", exact: true }),
  ).toBeDisabled();
  await migration.getByRole("checkbox", { name: /AGENTS_MD/ }).check();
  expect(
    server.requestLog.some(
      (entry) => entry.method === "externalAgentConfig/import",
    ),
  ).toBe(false);
  await migration
    .getByRole("button", { name: "导入所选（1）", exact: true })
    .click();
  await expect(migration.getByText(/导入已完成/)).toBeVisible();
  await expect(
    migration.getByText(/AGENTS_MD：成功\s*1，失败\s*0/),
  ).toBeVisible();
  const imported = server.requestLog.find(
    (entry) => entry.method === "externalAgentConfig/import",
  )?.migrationItems;
  expect(imported).toHaveLength(1);
  expect(imported?.[0]?.itemType).toBe("AGENTS_MD");
  const history = dialog.locator("section").filter({
    has: page.getByRole("heading", { name: "迁移历史", exact: true }),
  });
  await expect(history.getByText(/成功\s*1，失败\s*0/)).toBeVisible();
});

test("one section manager filters by device and clears edits on device changes", async ({
  page,
}) => {
  const remote = createMockServer();
  remote.listen(0, "127.0.0.1");
  await once(remote, "listening");
  const address = remote.address();
  if (!address || typeof address === "string")
    throw Error("Missing remote address");
  try {
    await openThread(page);
    const dialog = await settings(page);
    await dialog.getByRole("button", { name: "添加开发机" }).click();
    await dialog.getByLabel("环境名称", { exact: true }).fill("dev-box");
    await dialog
      .getByLabel("App-server 地址")
      .fill(`ws://127.0.0.1:${address.port}`);
    await dialog.getByRole("button", { name: "连接", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "导航选项", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "分区筛选与管理", exact: true })
      .click();
    const manage = page.getByRole("combobox", {
      name: "管理分区",
      exact: true,
    });
    await expect(manage).toHaveCount(1);
    await page.getByRole("tab", { name: "dev-box", exact: true }).click();
    await manage.click();
    await page.getByRole("option", { name: "管理分区…", exact: true }).click();
    const sections = page.getByRole("dialog", {
      name: "管理分区",
      exact: true,
    });
    const device = sections.getByRole("combobox", { name: "分区所属设备" });
    await expect(device).toHaveText("dev-box");
    await sections.getByLabel("新分区名称", { exact: true }).fill("远端计划");
    await sections
      .getByRole("button", { name: "新建分区", exact: true })
      .click();
    await expect(sections.getByText("远端计划", { exact: true })).toBeVisible();
    await sections.getByRole("button", { name: "重命名", exact: true }).click();
    await sections.getByLabel("分区新名称", { exact: true }).fill("未保存");
    await device.click();
    await page.getByRole("option", { name: "本机", exact: true }).click();
    await expect(sections.getByText("远端计划", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      sections.getByLabel("新分区名称", { exact: true }),
    ).toHaveValue("");
    await sections.getByLabel("新分区名称", { exact: true }).fill("本机计划");
    await sections
      .getByRole("button", { name: "新建分区", exact: true })
      .click();
    await expect(sections.getByText("本机计划", { exact: true })).toBeVisible();
    expect(
      server.requestLog.filter(
        (entry) => entry.method === "threadSection/create",
      ),
    ).toHaveLength(1);
    expect(
      remote.requestLog.filter(
        (entry) => entry.method === "threadSection/create",
      ),
    ).toHaveLength(1);
    await device.focus();
    await page.keyboard.press("ArrowDown");
    await page.getByRole("option", { name: "dev-box", exact: true }).click();
    await expect(sections.getByText("远端计划", { exact: true })).toBeVisible();
    await expect(sections.getByText("本机计划", { exact: true })).toHaveCount(
      0,
    );
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "全部", exact: true }).click();
    await expect(manage).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "管理分区", exact: true }),
    ).toHaveCount(0);
    await expect(manage).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^(折叠|展开)全部项目$/ }),
    ).toHaveCount(1);
    await manage.click();
    await expect(
      page.getByRole("option", { name: "本机 · 本机计划", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("option", { name: "dev-box · 远端计划", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "dev-box", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(manage).toHaveText("远端计划");
    await manage.click();
    await expect(page.getByRole("option", { name: /本机计划/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
  } finally {
    await new Promise<void>((resolve, reject) =>
      remote.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

for (const width of [375, 1440]) {
  test(`account usage at ${width}px shows plan and confirms earned reset before consuming`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openThread(page);
    if (width < 900)
      await page.getByRole("button", { name: "打开导航" }).click();
    const dialog = await settings(page);
    await expect(dialog.getByText("Plus", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/续费日期/)).toHaveCount(0);
    await expect(
      dialog.getByRole("progressbar", { name: "5 小时额度" }),
    ).toHaveAttribute("aria-valuenow", "25");
    await expect(
      dialog.getByText("可用重置次数：1", { exact: true }),
    ).toBeVisible();
    const consumeCount = () =>
      server.requestLog.filter(
        (entry) => entry.method === "account/rateLimitResetCredit/consume",
      ).length;
    await dialog.getByRole("button", { name: "使用此重置机会" }).click();
    const confirm = page.getByRole("dialog", {
      name: "确认使用额度重置",
      exact: true,
    });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "取消", exact: true }).click();
    expect(consumeCount()).toBe(0);
    await dialog.getByRole("button", { name: "使用此重置机会" }).click();
    await confirm
      .getByRole("button", { name: "确认使用一次", exact: true })
      .click();
    await expect(confirm).toBeHidden();
    await expect(
      dialog.getByRole("heading", { name: "主动重置额度", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("progressbar", { name: "5 小时额度" }),
    ).toHaveAttribute("aria-valuenow", "0");
    await expect(dialog.getByText(/已使用一次重置机会/)).toBeVisible();
    expect(consumeCount()).toBe(1);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  });
}

test("count-only reset credits allow confirmed server selection", async ({
  page,
}) => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  server = createMockServer({ resetCreditsCountOnly: true });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Missing mock address");
  serverUrl = `ws://127.0.0.1:${address.port}`;
  await openThread(page);
  const dialog = await settings(page);
  await expect(dialog.getByText(/服务端仅提供次数/)).toBeVisible();
  await dialog
    .getByRole("button", { name: "使用一次重置机会", exact: true })
    .click();
  const confirm = page.getByRole("dialog", {
    name: "确认使用额度重置",
    exact: true,
  });
  await expect(
    confirm.getByText("由服务端选择一个可用重置机会", { exact: true }),
  ).toBeVisible();
  await confirm
    .getByRole("button", { name: "确认使用一次", exact: true })
    .click();
  await expect(confirm).toBeHidden();
  await expect(
    dialog.getByRole("heading", { name: "主动重置额度", exact: true }),
  ).toHaveCount(0);
});
