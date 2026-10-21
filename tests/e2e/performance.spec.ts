import { expect, test, type Page } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";

let server: ReturnType<typeof createMockServer>;
let resumeTokens: (() => void) | undefined;

test.beforeEach(async ({ page }) => {
  const countRenders = test.info().title.startsWith("token updates");
  resumeTokens = undefined;
  const streamGate = countRenders
    ? new Promise<void>((resolve) => {
        resumeTokens = resolve;
      })
    : undefined;
  server = createMockServer({ streamGate, streamIntervalMs: 200 });
  if (test.info().title.startsWith("canonical project")) {
    server.setProject("mock-thread-001", "project-a");
    server.setProject("mock-thread-002", "project-a");
    server.setProject("mock-thread-004", "project-b");
  }
  if (countRenders) {
    await page.addInitScript(() => {
      Object.assign(window, { __renderCounts: { composer: 0, sidebar: 0 } });
    });
    for (const [module, variable, name] of [
      ["composer/Composer", "chosenModel, setChosenModel", "composer"],
      ["navigation/Sidebar", "focusKey, setFocusKey", "sidebar"],
    ]) {
      await page.route(`**/src/features/${module}.tsx*`, async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const marker = `const [${variable}]`;
        if (!source.includes(marker))
          throw Error(`Missing render instrumentation marker in ${module}`);
        await route.fulfill({
          response,
          body: source.replace(
            marker,
            `window.__renderCounts.${name}++; ${marker}`,
          ),
        });
      });
    }
  }
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing listener");
  await page.addInitScript((url) => {
    localStorage.setItem(
      "codex-environments",
      JSON.stringify([
        { id: "local", name: "本机", kind: "local", url, autoConnect: true },
      ]),
    );
  }, `ws://127.0.0.1:${address.port}`);
  await page.route("**/codex-release", (route) =>
    route.fulfill({ json: { version: "0.160.0" } }),
  );
  await page.goto("/?env=local&session=mock-thread-001");
  await expect(page.locator('[data-slot="conversation-turn"]')).toHaveCount(2);
});

test.afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

async function selectThread(page: Page, title: string) {
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "搜索会话" });
  await search.getByPlaceholder("搜索标题、摘要或工作区…").fill(title);
  await search.getByRole("option").filter({ hasText: title }).first().click();
  await expect(search).toBeHidden();
  await expect(page.locator('[data-slot="conversation-turn"]')).toHaveCount(2);
}

function viewport(page: Page) {
  return page.locator(
    '[data-slot="conversation-timeline"] > [data-radix-scroll-area-viewport]',
  );
}

test("idle A-B-A restores reading position without retaining A DOM", async ({
  page,
}) => {
  const scroll = viewport(page);
  await scroll.hover();
  await scroll.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await page.mouse.wheel(0, -800);
  await expect(
    page.getByRole("button", { name: "回到底部", exact: true }),
  ).toBeVisible();
  const before = await scroll.evaluate((node) => node.scrollTop);
  const originalArticle = await page
    .locator('[data-slot="conversation-turn"] article')
    .first()
    .elementHandle();
  await selectThread(page, "设计令牌与暗色模式 · 2");
  expect(await originalArticle!.evaluate((node) => node.isConnected)).toBe(
    false,
  );
  await selectThread(page, "工作区导航与搜索 · 1");
  await expect(page.locator('[data-slot="conversation-loading"]')).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "回到底部", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      Math.abs((await scroll.evaluate((node) => node.scrollTop)) - before),
    )
    .toBeLessThan(5);
});

test("Markdown tables retain their viewport and horizontal position through parent updates", async ({
  page,
}) => {
  await page.addStyleTag({
    content: '[data-slot="markdown"] table { min-width: 1800px; }',
  });
  const table = page.locator('[data-slot="markdown"] table').last();
  await table.scrollIntoViewIfNeeded();
  const handle = await table.elementHandle();
  const tableViewport = table.locator(
    "xpath=ancestor::*[@data-radix-scroll-area-viewport][1]",
  );
  await tableViewport.evaluate((node) => {
    node.scrollLeft = 120;
  });
  await expect
    .poll(() => tableViewport.evaluate((node) => node.scrollLeft))
    .toBe(120);
  await viewport(page).hover();
  await page.mouse.wheel(0, -600);
  await expect(
    page.getByRole("button", { name: "回到底部", exact: true }),
  ).toBeVisible();
  expect(await handle!.evaluate((node) => node.isConnected)).toBe(true);
  await expect
    .poll(() => tableViewport.evaluate((node) => node.scrollLeft))
    .toBe(120);
});

test("same-cwd session switches retain expanded file directories", async ({
  page,
}) => {
  await page.getByRole("button", { name: "打开项目面板" }).click();
  const panel = page.getByRole("complementary", { name: "项目面板" });
  const source = panel.locator('[data-file-entry="src"] > button:first-child');
  await source.click();
  await expect(
    panel.locator('[data-file-entry="src/app.ts"] > button:first-child'),
  ).toBeVisible();
  await selectThread(page, "审批流程演示 · 4");
  await expect(
    panel.locator('[data-file-entry="src/app.ts"] > button:first-child'),
  ).toBeVisible();
  await selectThread(page, "工作区导航与搜索 · 1");
  await expect(
    panel.locator('[data-file-entry="src/app.ts"] > button:first-child'),
  ).toBeVisible();
});

test("token updates skip Composer and Sidebar renders while App processes streamed text", async ({
  page,
}) => {
  test.skip(!!process.env.E2E_PRODUCTION, "Development-module render counters");
  const input = page.getByRole("textbox", { name: "消息输入框" });
  await input.fill("render-boundary-regression");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const latest = page
    .locator('[data-slot="conversation-turn"]')
    .last()
    .locator('[data-slot="markdown"]')
    .last();
  await expect(latest).toContainText("实施结果");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const before = await page.evaluate(
    () =>
      (
        window as unknown as {
          __renderCounts: { composer: number; sidebar: number };
        }
      ).__renderCounts,
  );
  expect(before.composer).toBeGreaterThan(0);
  expect(before.sidebar).toBeGreaterThan(0);
  const initialText = await latest.innerText();
  resumeTokens!();
  await expect
    .poll(async () => (await latest.innerText()).length)
    .toBeGreaterThan(initialText.length + 160);
  const after = await page.evaluate(
    () =>
      (
        window as unknown as {
          __renderCounts: { composer: number; sidebar: number };
        }
      ).__renderCounts,
  );
  expect(after).toEqual(before);
});

test("project panel tabs restore across projects and share within the same cwd", async ({
  page,
}) => {
  await page.getByRole("button", { name: "打开项目面板" }).click();
  const panel = page.getByRole("complementary", { name: "项目面板" });
  await panel.getByRole("tab", { name: "Git", exact: true }).click();
  await expect(
    panel.getByRole("tab", { name: "Git", exact: true }),
  ).toHaveAttribute("data-state", "active");
  await selectThread(page, "设计令牌与暗色模式 · 2");
  await expect(
    panel.getByRole("tab", { name: "文件", exact: true }),
  ).toHaveAttribute("data-state", "active");
  await panel.getByRole("tab", { name: "工作区", exact: true }).click();
  await selectThread(page, "审批流程演示 · 4");
  await expect(
    panel.getByRole("tab", { name: "Git", exact: true }),
  ).toHaveAttribute("data-state", "active");
  await selectThread(page, "设计令牌与暗色模式 · 2");
  await expect(
    panel.getByRole("tab", { name: "工作区", exact: true }),
  ).toHaveAttribute("data-state", "active");
  await selectThread(page, "工作区导航与搜索 · 1");
  await expect(
    panel.getByRole("tab", { name: "Git", exact: true }),
  ).toHaveAttribute("data-state", "active");
});

test("session tool scrolling stays with the thread when project tabs are shared", async ({
  page,
}) => {
  await page.getByRole("button", { name: "打开项目面板" }).click();
  const panel = page.getByRole("complementary", { name: "项目面板" });
  await panel.getByRole("tab", { name: "工作区", exact: true }).click();
  const scroll = () =>
    panel
      .locator(
        '[data-state="active"][role="tabpanel"] > [data-radix-scroll-area-viewport], [data-state="active"][role="tabpanel"] > div > [data-radix-scroll-area-viewport]',
      )
      .first();
  await expect(panel.getByText("会话目标", { exact: true })).toBeVisible();
  // Keep the resource scrollable independently of how many optional server tools are available.
  await page.addStyleTag({
    content:
      '[role="tabpanel"][data-state="active"] [data-radix-scroll-area-viewport] > div { min-height: 1600px; }',
  });
  await scroll().evaluate((node) => {
    node.scrollTop = 300;
  });
  const before = await scroll().evaluate((node) => node.scrollTop);
  expect(before).toBeGreaterThan(50);
  await selectThread(page, "审批流程演示 · 4");
  await expect(
    panel.getByRole("tab", { name: "工作区", exact: true }),
  ).toHaveAttribute("data-state", "active");
  await expect.poll(() => scroll().evaluate((node) => node.scrollTop)).toBe(0);
  await selectThread(page, "工作区导航与搜索 · 1");
  await expect
    .poll(() => scroll().evaluate((node) => node.scrollTop))
    .toBe(before);
});

test("canonical project tabs span cwd and react to reassignment independently", async ({
  page,
}) => {
  await page.getByRole("button", { name: "打开项目面板" }).click();
  const panel = page.getByRole("complementary", { name: "项目面板" });
  await panel.getByRole("tab", { name: "Git", exact: true }).click();
  await selectThread(page, "设计令牌与暗色模式 · 2");
  await expect(
    panel.getByRole("tab", { name: "Git", exact: true }),
  ).toHaveAttribute("data-state", "active");
  await panel.getByRole("tab", { name: "工作区", exact: true }).click();
  await selectThread(page, "审批流程演示 · 4");
  await expect(
    panel.getByRole("tab", { name: "文件", exact: true }),
  ).toHaveAttribute("data-state", "active");
  await panel.getByRole("tab", { name: "Git", exact: true }).click();
  await selectThread(page, "工作区导航与搜索 · 1");
  await expect(
    panel.getByRole("tab", { name: "工作区", exact: true }),
  ).toHaveAttribute("data-state", "active");
  server.setProject("mock-thread-001", "project-b");
  await expect(
    panel.getByRole("tab", { name: "Git", exact: true }),
  ).toHaveAttribute("data-state", "active");
  await selectThread(page, "设计令牌与暗色模式 · 2");
  await expect(
    panel.getByRole("tab", { name: "工作区", exact: true }),
  ).toHaveAttribute("data-state", "active");
});

test("Git view and directory expansion persist across project panel tab unmounts", async ({
  page,
}) => {
  await page.getByRole("button", { name: "打开项目面板" }).click();
  const panel = page.getByRole("complementary", { name: "项目面板" });
  const gitTab = panel.getByRole("tab", { name: "Git", exact: true });
  const filesTab = panel.getByRole("tab", { name: "文件", exact: true });
  await gitTab.click();
  const folder = panel
    .locator(".git-folder")
    .filter({ has: page.locator('summary[title="src"]') });
  await expect(folder).toHaveAttribute("open", "");
  await panel.getByRole("button", { name: "src/app.ts", exact: true }).click();
  await folder.locator(":scope > summary").click();
  await expect(folder).not.toHaveAttribute("open");
  const staged = panel
    .locator(".git-group")
    .filter({ hasText: "已暂存" })
    .first();
  await staged.locator(":scope > summary").click();
  await expect(staged).not.toHaveAttribute("open");
  await filesTab.click();
  await gitTab.click();
  await expect(folder).not.toHaveAttribute("open");
  await expect(staged).not.toHaveAttribute("open");
  await panel
    .getByRole("button", { name: "切换为列表视图", exact: true })
    .click();
  await filesTab.click();
  await gitTab.click();
  await expect(
    panel.getByRole("button", { name: "切换为树状视图", exact: true }),
  ).toBeVisible();
  await selectThread(page, "审批流程演示 · 4");
  await expect(
    panel.getByRole("button", { name: "切换为树状视图", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "src/app.ts", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(staged).not.toHaveAttribute("open");
  await expect(panel.getByText("正在读取工作区…", { exact: true })).toHaveCount(
    0,
  );
});
