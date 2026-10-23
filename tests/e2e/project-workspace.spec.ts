import { expect, test, type Page } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";

let fixture: ReturnType<typeof createMockServer>;

test.beforeEach(async ({ page }) => {
  fixture = createMockServer();
  fixture.listen(0, "127.0.0.1");
  await once(fixture, "listening");
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  await page.addInitScript((url) => {
    localStorage.setItem(
      "codex-environments",
      JSON.stringify([
        { id: "local", name: "本机", kind: "local", url, autoConnect: true },
      ]),
    );
  }, `ws://127.0.0.1:${address.port}`);
  await page.goto("/?env=local&session=mock-thread-001");
  await expect(page.locator('[data-slot="conversation-turn"]')).toHaveCount(2);
  await openWorkspace(page);
});

test.afterEach(async () => {
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
});

async function openWorkspace(page: Page) {
  const toggle = page.getByRole("button", {
    name: "打开项目面板",
    exact: true,
  });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("tab", { name: "工作区", exact: true }).click();
}

function workspace(page: Page) {
  return page.getByRole("region", { name: "工作区", exact: true });
}

async function selectThread(page: Page, title: string) {
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "搜索会话" });
  await search.getByPlaceholder("搜索标题、摘要或工作区…").fill(title);
  await search.getByRole("option").filter({ hasText: title }).first().click();
  await expect(search).toBeHidden();
  await openWorkspace(page);
}

function executions() {
  return fixture.requestLog.filter(
    (request) =>
      request.method === "command/exec" && request.command?.[0] === "/bin/sh",
  );
}

// Uses protocol fixtures only; never executes a user's project command.
test("workspace follows each session cwd and only explicitly runs its current command", async ({
  page,
}) => {
  const panel = workspace(page);
  const tabs = page
    .getByRole("complementary", { name: "项目面板" })
    .getByRole("tab");
  await expect(tabs).toHaveText(["文件", "搜索", "Git", "工作区"]);
  await expect(
    page.getByRole("tab", { name: /^(会话|项目空间)$/ }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: /^(使用当前会话目录|添加项目)$/ }),
  ).toHaveCount(0);
  await expect(panel).toContainText("/demo/atlas-web");
  await panel
    .getByRole("textbox", { name: "test 命令", exact: true })
    .fill("printf atlas-fixture");
  await panel.getByText("项目默认设置", { exact: true }).click();
  await panel
    .getByRole("textbox", { name: "项目说明", exact: true })
    .fill("atlas description");
  await panel
    .getByRole("textbox", { name: "默认模型", exact: true })
    .fill("fixture-model");
  await expect(panel).toContainText("仅用于新建会话");
  expect(executions()).toHaveLength(0);

  await selectThread(page, "设计令牌与暗色模式 · 2");
  await expect(panel).toContainText("/demo/design-system");
  await expect(
    panel.getByRole("textbox", { name: "test 命令", exact: true }),
  ).toHaveValue("");
  await panel
    .getByRole("textbox", { name: "test 命令", exact: true })
    .fill("printf design-fixture");
  expect(executions()).toHaveLength(0);
  await panel.getByRole("button", { name: "运行 test", exact: true }).click();
  await expect.poll(() => executions().length).toBe(1);
  expect(executions()[0]).toMatchObject({
    cwd: "/demo/design-system",
    command: ["/bin/sh", "-lc", "printf design-fixture"],
  });
  await expect(panel.getByText(/状态未知/).first()).toBeVisible();
  await expect(panel.getByText(/退出码 0/)).toHaveCount(0);

  await selectThread(page, "工作区导航与搜索 · 1");
  await expect(
    panel.getByRole("textbox", { name: "test 命令", exact: true }),
  ).toHaveValue("printf atlas-fixture");
  await page.reload();
  await openWorkspace(page);
  await panel.getByText("项目默认设置", { exact: true }).click();
  await expect(
    panel.getByRole("textbox", { name: "项目说明", exact: true }),
  ).toHaveValue("atlas description");
  await expect(
    panel.getByRole("textbox", { name: "默认模型", exact: true }),
  ).toHaveValue("fixture-model");
  expect(executions()).toHaveLength(1);
});

for (const width of [320, 390, 1440]) {
  test(`project switcher at ${width}px keeps field spacing, type and actions consistent outside the workspace portal`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() =>
      document.documentElement.style.setProperty(
        "--font-scale",
        "1.1428571428571428",
      ),
    );
    await openWorkspace(page);
    const panel = workspace(page);
    await panel
      .getByRole("textbox", { name: "test 命令", exact: true })
      .fill("printf fixture");
    await panel
      .getByRole("button", { name: "切换项目／新建会话", exact: true })
      .click();
    const switcher = page.getByRole("dialog", {
      name: "切换项目／新建会话",
      exact: true,
    });
    const selector = switcher.getByRole("combobox", {
      name: "已保存项目",
      exact: true,
    });
    const directory = switcher.getByRole("textbox", {
      name: "项目目录",
      exact: true,
    });
    const savedLabel = switcher.locator('label[for="saved-project"]');
    const directoryLabel = switcher.locator(
      'label[for="project-switcher-directory"]',
    );
    await expect(savedLabel).toHaveText("已保存项目");
    await expect(directoryLabel).toHaveText("项目目录");
    const fontSize = await directory.evaluate(
      (element) => getComputedStyle(element).fontSize,
    );
    await expect(selector).toHaveCSS("font-size", fontSize);
    for (const [label, field] of [
      [savedLabel, selector],
      [directoryLabel, directory],
    ]) {
      const title = (await label.boundingBox())!;
      const control = (await field.boundingBox())!;
      expect(control.y - title.y - title.height).toBeGreaterThanOrEqual(7.5);
    }
    const selectionBounds = (await selector.boundingBox())!;
    const inputBounds = (await directory.boundingBox())!;
    expect(Math.abs(selectionBounds.x - inputBounds.x)).toBeLessThan(1);
    expect(Math.abs(selectionBounds.width - inputBounds.width)).toBeLessThan(1);
    const cancel = switcher.getByRole("button", { name: "取消", exact: true });
    expect(
      (await cancel.boundingBox())!.y - inputBounds.y - inputBounds.height,
    ).toBeGreaterThanOrEqual(16);
    await selector.click();
    const option = page.getByRole("option", {
      name: "/demo/atlas-web",
      exact: true,
    });
    await expect(option).toHaveCSS("font-size", fontSize);
    await option.click();
    await expect(directory).toHaveValue("/demo/atlas-web");
    await directory.fill(`/demo/${"long-project-directory-".repeat(15)}`);
    await expect
      .poll(() =>
        switcher.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      )
      .toBe(true);
    await page.setViewportSize({ width, height: 420 });
    await expect
      .poll(async () => {
        const bounds = await switcher.boundingBox();
        return (
          !!bounds &&
          bounds.x >= 0 &&
          bounds.y >= 0 &&
          bounds.x + bounds.width <= width &&
          bounds.y + bounds.height <= 420
        );
      })
      .toBe(true);
    await cancel.scrollIntoViewIfNeeded();
    await expect(cancel).toBeInViewport();
    await cancel.click();
    await expect(switcher).toBeHidden();
    expect(executions()).toHaveLength(0);
    expect(
      fixture.requestLog.filter((request) => request.method === "thread/start"),
    ).toHaveLength(0);
  });
}

test("switching projects is staged until new-session confirmation and cancellation preserves the active session", async ({
  page,
}) => {
  const panel = workspace(page);
  await panel
    .getByRole("textbox", { name: "test 命令", exact: true })
    .fill("printf original");
  const before = fixture.requestLog.length;
  await panel
    .getByRole("button", { name: "切换项目／新建会话", exact: true })
    .click();
  const switcher = page.getByRole("dialog", {
    name: "切换项目／新建会话",
    exact: true,
  });
  await switcher
    .getByRole("textbox", { name: "项目目录", exact: true })
    .fill("/demo/api-service");
  await switcher.getByRole("button", { name: "取消", exact: true }).click();
  await expect(panel).toContainText("/demo/atlas-web");
  await expect(
    panel.getByRole("textbox", { name: "test 命令", exact: true }),
  ).toHaveValue("printf original");
  await panel
    .getByRole("button", { name: "切换项目／新建会话", exact: true })
    .click();
  await switcher
    .getByRole("textbox", { name: "项目目录", exact: true })
    .fill("/demo/api-service");
  await switcher.getByRole("button", { name: "新建会话", exact: true }).click();
  const creation = page.getByRole("dialog", { name: "新建会话", exact: true });
  await expect(creation.getByLabel("工作目录")).toHaveValue(
    "/demo/api-service",
  );
  await creation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(panel).toContainText("/demo/atlas-web");
  expect(
    fixture.requestLog
      .slice(before)
      .filter((request) => request.method === "thread/start"),
  ).toHaveLength(0);
  expect(executions()).toHaveLength(0);
});

test("deleting current project configuration leaves empty defaults across reload without recreating it", async ({
  page,
}) => {
  const panel = workspace(page);
  await panel
    .getByRole("textbox", { name: "test 命令", exact: true })
    .fill("printf fixture");
  await panel.getByText("项目默认设置", { exact: true }).click();
  await panel
    .getByRole("textbox", { name: "项目说明", exact: true })
    .fill("fixture description");
  await panel
    .getByRole("textbox", { name: "默认模型", exact: true })
    .fill("fixture-model");
  const before = fixture.requestLog.length;
  await panel
    .getByRole("button", { name: "删除本地项目配置", exact: true })
    .click();
  await expect(panel).toContainText("/demo/atlas-web");
  await expect(
    panel.getByRole("textbox", { name: "test 命令", exact: true }),
  ).toHaveValue("");
  await expect(
    panel.getByRole("textbox", { name: "项目说明", exact: true }),
  ).toHaveValue("");
  await expect(
    panel.getByRole("textbox", { name: "默认模型", exact: true }),
  ).toHaveValue("");
  await page.reload();
  await openWorkspace(page);
  await expect(
    panel.getByRole("textbox", { name: "test 命令", exact: true }),
  ).toHaveValue("");
  await panel
    .getByRole("button", { name: "切换项目／新建会话", exact: true })
    .click();
  const switcher = page.getByRole("dialog", {
    name: "切换项目／新建会话",
    exact: true,
  });
  await switcher
    .getByRole("combobox", { name: "已保存项目", exact: true })
    .click();
  await expect(
    page.getByRole("option", { name: "/demo/atlas-web", exact: true }),
  ).toHaveCount(0);
  expect(
    fixture.requestLog
      .slice(before)
      .filter(
        (request) =>
          ["fs/remove", "fs/writeFile"].includes(request.method) ||
          (request.method === "command/exec" &&
            request.command?.[0] === "/bin/sh"),
      ),
  ).toHaveLength(0);
});

test("saved project defaults populate a new draft without sending or changing the original session", async ({
  page,
}) => {
  const panel = workspace(page);
  await panel.getByText("项目默认设置", { exact: true }).click();
  await panel
    .getByRole("textbox", { name: "项目说明", exact: true })
    .fill("fixture project instructions");
  await panel
    .getByRole("textbox", { name: "默认模型", exact: true })
    .fill("fixture-model");
  await panel
    .getByRole("button", { name: "切换项目／新建会话", exact: true })
    .click();
  const switcher = page.getByRole("dialog", {
    name: "切换项目／新建会话",
    exact: true,
  });
  await switcher
    .getByRole("combobox", { name: "已保存项目", exact: true })
    .click();
  await page
    .getByRole("option", { name: "/demo/atlas-web", exact: true })
    .click();
  await switcher.getByRole("button", { name: "新建会话", exact: true }).click();
  const creation = page.getByRole("dialog", { name: "新建会话", exact: true });
  await expect(creation).toContainText("项目默认模型：fixture-model");
  await expect(creation).toContainText("fixture project instructions");
  await creation.getByRole("button", { name: "创建会话", exact: true }).click();
  await expect(creation).toBeHidden();
  await expect(
    page.getByRole("textbox", { name: "消息输入框", exact: true }),
  ).toContainText(/项目说明：\s*fixture project instructions\s*任务：/);
  await expect(page.locator('[data-slot="model-choice"]')).toContainText(
    "fixture-model",
  );
  await openWorkspace(page);
  await expect(panel.getByText("会话目标", { exact: true })).toHaveCount(0);
  expect(
    fixture.requestLog.filter((request) =>
      ["thread/start", "turn/start"].includes(request.method),
    ),
  ).toHaveLength(0);
  expect(executions()).toHaveLength(0);
});

test("new session draft has project controls without current-session tools", async ({
  page,
}) => {
  await page.getByRole("button", { name: /^新建会话/ }).click();
  const creation = page.getByRole("dialog", { name: "新建会话", exact: true });
  await creation.getByLabel("工作目录").fill("/demo/api-service");
  await creation.getByRole("button", { name: "创建会话", exact: true }).click();
  await expect(creation).toBeHidden();
  await openWorkspace(page);
  const panel = workspace(page);
  await expect(panel).toContainText("/demo/api-service");
  await expect(
    panel.getByRole("textbox", { name: "test 命令", exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("会话目标", { exact: true })).toHaveCount(0);
  expect(executions()).toHaveLength(0);
  expect(
    fixture.requestLog.filter((request) => request.method === "thread/start"),
  ).toHaveLength(0);
});
