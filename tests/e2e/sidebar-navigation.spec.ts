import { expect, test, type Page } from "@playwright/test";
import { once } from "node:events";
import { createMockServer, type MockOptions } from "../fixtures/app-server";
import { placeholderThread } from "../../src/lib/state";

const servers: ReturnType<typeof createMockServer>[] = [];
async function server(options: MockOptions = {}) {
  const fixture = createMockServer(options);
  servers.push(fixture);
  fixture.listen(0, "127.0.0.1");
  await once(fixture, "listening");
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  return { fixture, url: `ws://127.0.0.1:${address.port}` };
}
async function open(page: Page, targets: Awaited<ReturnType<typeof server>>[]) {
  await page.route("**/codex-release", (route) =>
    route.fulfill({ json: { version: "0.163.0" } }),
  );
  await page.addInitScript(
    (profiles) => {
      if (!localStorage.getItem("codex-environments"))
        localStorage.setItem("codex-environments", JSON.stringify(profiles));
    },
    targets.map((target, index) => ({
      id: index ? "remote" : "local",
      name: index ? "远程测试" : "本机",
      kind: index ? "remote" : "local",
      url: target.url,
      autoConnect: true,
    })),
  );
  await page.goto("/");
  await expect
    .poll(() =>
      targets[0].fixture.requestLog.some(
        (request) => request.method === "thread/list" && request.params?.cursor,
      ),
    )
    .toBe(true);
}
const rows = (page: Page) => page.locator("[data-slot=thread-row]");
const projects = (page: Page) => page.locator("[data-slot=workspace-toggle]");
const views = (page: Page) =>
  page.getByRole("tablist", { name: "会话视图", exact: true });
const link = (page: Page, title: string) =>
  page
    .locator("[data-slot=thread-link]")
    .filter({ has: page.getByText(title, { exact: true }) });
async function expandProjects(page: Page) {
  await expect(projects(page)).toHaveCount(3);
  for (const project of await projects(page).all())
    if ((await project.getAttribute("aria-expanded")) !== "true")
      await project.click();
  const remaining = page.locator(
    '[data-slot="project-history-toggle"][aria-expanded="false"]',
  );
  while (await remaining.count()) await remaining.first().click();
}
async function status(page: Page, label: string) {
  await page.getByRole("combobox", { name: "会话状态", exact: true }).click();
  await page
    .getByRole("option", { name: new RegExp(`^${label}(?: · \\d+)?$`) })
    .click();
}
async function menu(page: Page, title: string) {
  await link(page, title).hover();
  await page
    .getByRole("button", { name: `会话操作：${title}`, exact: true })
    .click();
  return page.getByRole("menu");
}
test.afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (fixture) =>
          new Promise<void>((resolve) => fixture.close(() => resolve())),
      ),
  );
});

test("defaults to five sessions per project while automatically loading complete history", async ({
  page,
}) => {
  const local = await server();
  const remote = await server();
  await open(page, [local, remote]);
  const environments = page.getByRole("tablist", {
    name: "按工作环境筛选会话",
    exact: true,
  });
  await expect(environments).toContainText("本机");
  await expect(environments).toContainText("远程测试");
  await expect(
    environments.getByRole("tab", { name: "本机", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(rows(page)).toHaveCount(15);
  await expect(
    page.locator('[data-slot="project-history-toggle"]'),
  ).toHaveCount(3);
  await expandProjects(page);
  await expect(rows(page)).toHaveCount(90);
  await expect(link(page, "失败恢复演示 · 90")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: /展开更多|加载下一页会话/ }),
  ).toHaveCount(0);
  for (const { fixture } of [local, remote]) {
    expect(
      fixture.requestLog.filter((request) => request.method === "thread/read"),
    ).toHaveLength(0);
  }
  expect(
    local.fixture.requestLog.filter(
      (request) => request.method === "thread/list" && request.params?.cursor,
    ),
  ).toHaveLength(1);
  expect(
    remote.fixture.requestLog.filter(
      (request) => request.method === "thread/list" && request.params?.cursor,
    ),
  ).toHaveLength(0);
  await environments
    .getByRole("tab", { name: "远程测试", exact: true })
    .click();
  await expect(
    environments.getByRole("tab", { name: "远程测试", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(() =>
      remote.fixture.requestLog.some(
        (request) => request.method === "thread/list" && request.params?.cursor,
      ),
    )
    .toBe(true);
  await expandProjects(page);
  await expect(rows(page)).toHaveCount(90);
});

test("reaches the next project without traversing a long history and reveals older selections", async ({
  page,
}) => {
  const target = await server();
  await open(page, [target]);
  await expect(rows(page)).toHaveCount(15);
  const viewport = page.locator('[aria-label="会话列表"]');
  const bounds = (await viewport.boundingBox())!;
  const nextProject = (await projects(page).nth(1).boundingBox())!;
  expect(nextProject.y + nextProject.height).toBeLessThan(
    bounds.y + bounds.height,
  );
  const more = page.locator('[data-slot="project-history-toggle"]').first();
  const requests = target.fixture.requestLog.length;
  await more.click();
  await expect(rows(page)).toHaveCount(40);
  await expect(more).toHaveText("收起为 5 条");
  await viewport.evaluate((element) => {
    element.scrollTop = 500;
  });
  const pinned = page.locator('[data-sticky-project="true"]');
  await expect(pinned).toHaveCount(1);
  const header = (await pinned.boundingBox())!;
  expect(Math.abs(header.y - bounds.y)).toBeLessThan(1);
  await more.click();
  await expect(rows(page)).toHaveCount(15);
  expect(
    target.fixture.requestLog
      .slice(requests)
      .some((request) => request.method === "thread/read"),
  ).toBe(false);
  await page.goto("/?env=local&session=mock-thread-090");
  await expect(link(page, "失败恢复演示 · 90")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(link(page, "失败恢复演示 · 90")).toBeInViewport();
  await expect(rows(page)).toHaveCount(40);
});

for (const threadCount of [90, 1000]) {
  test(`project headers remain pinned during native scrolling with ${threadCount} sessions`, async ({
    page,
  }) => {
    const target = await server({ threadCount });
    await open(page, [target]);
    await expect(page.getByText(/正在补齐历史/)).toHaveCount(0);
    await page.locator('[data-slot="project-history-toggle"]').first().click();
    const viewport = page.locator('[aria-label="会话列表"]');
    const offsets = await viewport.evaluate(async (element) => {
      const differences: number[] = [];
      for (const top of [120, 280, 450, 430, 700, 680]) {
        element.scrollTop = top;
        // Read in the same frame, before React processes the scroll event.
        // Sticky geometry must already be correct in the browser layout.
        const heading = element.querySelector(
          '[data-slot="workspace-heading"]',
        )!;
        differences.push(
          heading.getBoundingClientRect().top -
            element.getBoundingClientRect().top,
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      }
      return differences;
    });
    expect(Math.max(...offsets.map(Math.abs))).toBeLessThan(1);
    await expect(projects(page).first()).toBeVisible();
    await projects(page).first().click();
    await expect(projects(page).first()).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
}

test("keeps project rows compact and exposes distinct project and footer actions", async ({
  page,
}) => {
  const target = await server();
  await open(page, [target]);
  await expandProjects(page);
  const thread = link(page, "工作区导航与搜索 · 1");
  await expect(thread.locator('[data-slot="thread-description"]')).toHaveCount(
    0,
  );
  const alignment = await thread.evaluate((element) => {
    const title = element
      .querySelector('[data-slot="thread-title"]')!
      .getBoundingClientRect();
    const time = element.querySelector("time")!.getBoundingClientRect();
    return Math.abs(title.y + title.height / 2 - time.y - time.height / 2);
  });
  expect(alignment).toBeLessThan(1);

  const project = page.locator('[data-slot="workspace-heading"]').filter({
    has: page.getByRole("button", {
      name: "在 atlas-web 新建会话",
      exact: true,
    }),
  });
  await project.hover();
  await expect(project.getByRole("button", { expanded: false })).toHaveCount(0);
  await project
    .getByRole("button", { name: "收藏项目：atlas-web", exact: true })
    .click();
  await expect(
    project.getByRole("button", {
      name: "取消收藏项目：atlas-web",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await project
    .getByRole("button", { name: "在 atlas-web 新建会话", exact: true })
    .click();
  const create = page.getByRole("dialog", { name: "新建会话", exact: true });
  await expect(create.getByLabel("工作目录", { exact: true })).toHaveValue(
    "/demo/atlas-web",
  );
  await create.getByRole("button", { name: "取消", exact: true }).click();

  const footer = page.locator('[data-slot="sidebar-footer"]');
  const archived = footer.getByRole("button", {
    name: "已归档的会话",
    exact: true,
  });
  const settings = footer.getByRole("button", { name: "设置", exact: true });
  const archiveBox = (await archived.boundingBox())!;
  const settingsBox = (await settings.boundingBox())!;
  expect(archiveBox.y).toBe(settingsBox.y);
  expect(archiveBox.width).toBe(settingsBox.width);
  await expect(footer).toContainText("1 个环境已连接");
  await archived.click();
  const preferences = page.getByRole("dialog", {
    name: "连接与设置",
    exact: true,
  });
  await expect(
    preferences.getByRole("tab", { name: "已归档的会话", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await preferences.getByRole("button", { name: "关闭", exact: true }).click();
  await settings.click();
  await expect(preferences).toBeVisible();
});

test("preserves project collapse and the recent view independently of project activity ordering", async ({
  page,
}) => {
  const target = await server();
  await open(page, [target]);
  await expandProjects(page);
  await expect(rows(page)).toHaveCount(90);
  const order = await projects(page).allTextContents();
  await link(page, "设计令牌与暗色模式 · 2").click();
  await link(page, "工作区导航与搜索 · 1").click();
  await expect(projects(page)).toHaveText(order);
  const collapsed = projects(page).filter({ hasText: "api-service" });
  await collapsed.click();
  await expect(collapsed).toHaveAttribute("aria-expanded", "false");
  await views(page).getByRole("tab", { name: "最近", exact: true }).click();
  await expect(projects(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(90);
  await expect(rows(page).nth(0)).toContainText("工作区导航与搜索 · 1");
  await expect(rows(page).nth(1)).toContainText("设计令牌与暗色模式 · 2");
  await page.reload();
  await expect(
    views(page).getByRole("tab", { name: "最近", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(rows(page)).toHaveCount(90);
  await expect(rows(page).first()).toContainText("工作区导航与搜索 · 1");
  await views(page).getByRole("tab", { name: "项目", exact: true }).click();
  await expect(projects(page)).toHaveText(order);
  await expect(
    projects(page).filter({ hasText: "api-service" }),
  ).toHaveAttribute("aria-expanded", "false");
});

test("filters pending, running and unread sessions, and clears an empty filter", async ({
  page,
}) => {
  const target = await server({ initialActiveOperations: true });
  await open(page, [target]);
  await views(page).getByRole("tab", { name: "最近", exact: true }).click();
  await expect(rows(page)).toHaveCount(90);
  await status(page, "未读结果");
  await expect(rows(page)).toHaveCount(0);
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await expect(rows(page)).toHaveCount(90);
  target.fixture.publish({
    id: "sidebar-permission",
    method: "item/permissions/requestApproval",
    params: {
      threadId: "mock-thread-005",
      turnId: "sidebar-turn",
      itemId: "sidebar-permission",
      environmentId: null,
      startedAtMs: Date.now(),
      cwd: "/demo/design-system",
      reason: "检查项目文档",
      permissions: { network: { enabled: true }, fileSystem: null },
    },
  });
  target.fixture.publish({
    method: "turn/completed",
    params: {
      threadId: "mock-thread-012",
      turn: {
        id: "sidebar-completed",
        rootTurnId: null,
        items: [],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1000,
      },
    },
  });
  await status(page, "待处理");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("用户问题演示 · 5");
  await status(page, "运行中");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("接口分页与错误处理 · 10");
  await status(page, "未读结果");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("用户问题演示 · 12");
  await link(page, "用户问题演示 · 12").click();
  await expect(rows(page)).toHaveCount(0);
  await status(page, "全部会话");
  await expect(rows(page)).toHaveCount(90);
});

test("moves recently active projects first while preserving the reader's visible session", async ({
  page,
}) => {
  const target = await server();
  await open(page, [target]);
  await expandProjects(page);
  await expect(rows(page)).toHaveCount(90);
  const order = await projects(page).allTextContents();
  const viewport = page.locator('[aria-label="会话列表"]');
  await viewport.evaluate((element) => {
    element.scrollTop = 800;
  });
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBe(800);
  const anchor = await viewport.evaluate((element) => {
    const viewportTop = element.getBoundingClientRect().top;
    const row = [
      ...element.querySelectorAll<HTMLElement>(
        "[data-navigation-key]:not([data-navigation-project-group])",
      ),
    ].find((node) => node.getBoundingClientRect().top >= viewportTop)!;
    return {
      key: row.dataset.navigationKey!,
      offset: row.getBoundingClientRect().top - viewportTop,
    };
  });
  target.fixture.publish({
    method: "thread/started",
    params: {
      thread: {
        ...placeholderThread("mock-thread-090"),
        name: "失败恢复演示 · 90",
        cwd: "/demo/api-service",
        updatedAt: Math.floor(Date.now() / 1000) + 100,
        status: { type: "active", activeFlags: [] },
      },
    },
  });
  await expect(
    link(page, "失败恢复演示 · 90").locator('[data-slot="running-indicator"]'),
  ).toHaveCount(1);
  await expect(projects(page)).toHaveText([order[2], ...order.slice(0, 2)]);
  await expect
    .poll(() =>
      viewport.evaluate((element, previous) => {
        const row = [
          ...element.querySelectorAll<HTMLElement>("[data-navigation-key]"),
        ].find((node) => node.dataset.navigationKey === previous.key)!;
        return Math.abs(
          row.getBoundingClientRect().top -
            element.getBoundingClientRect().top -
            previous.offset,
        );
      }, anchor),
    )
    .toBeLessThan(1);
});

test("offers keyboard navigation without opening a session until activation", async ({
  page,
}) => {
  const target = await server();
  await open(page, [target]);
  await views(page).getByRole("tab", { name: "最近", exact: true }).click();
  await expect(rows(page)).toHaveCount(90);
  await link(page, "工作区导航与搜索 · 1").focus();
  await page.keyboard.press("End");
  await expect(link(page, "失败恢复演示 · 90")).toBeFocused();
  expect(
    target.fixture.requestLog.filter(
      (request) => request.method === "thread/read",
    ),
  ).toHaveLength(0);
  await page.keyboard.press("Home");
  await expect(link(page, "工作区导航与搜索 · 1")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(link(page, "设计令牌与暗色模式 · 2")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      target.fixture.requestLog.some(
        (request) =>
          request.method === "thread/read" &&
          request.threadId === "mock-thread-002",
      ),
    )
    .toBe(true);
});

test("selects offscreen rows with the mouse without jumping back between pointer down and click", async ({
  page,
}) => {
  const target = await server();
  await open(page, [target]);
  await page.goto("/?env=local&session=mock-thread-010");
  const original = link(page, "接口分页与错误处理 · 10");
  await expect(original).toHaveAttribute("aria-current", "page");
  await expandProjects(page);
  await original.scrollIntoViewIfNeeded();
  const composer = page.getByRole("textbox", { name: "消息输入框" });
  await expect(composer).toBeVisible();
  await composer.fill("仅属于第 10 条会话的草稿");
  const other = page
    .locator("[data-slot=thread-link]:not([aria-current=page])")
    .first();
  const otherTitle = await other
    .locator("[data-slot=thread-title]")
    .innerText();
  const viewport = page.locator('[aria-label="会话列表"]');
  await viewport.evaluate((element) => {
    element.scrollTop = 800;
  });
  await expect
    .poll(async () => {
      const row = (await other.boundingBox())!;
      const box = (await viewport.boundingBox())!;
      return row.y + row.height <= box.y;
    })
    .toBe(true);
  await other.click();
  await expect(link(page, otherTitle)).toHaveAttribute("aria-current", "page");
  await expect(composer).toHaveText("");
  await original.click();
  await expect(original).toHaveAttribute("aria-current", "page");
  await expect(composer).toHaveText("仅属于第 10 条会话的草稿");
});

test("virtualizes a 1,000-session history and opens the last session through the keyboard", async ({
  page,
}) => {
  const target = await server({ threadCount: 1000 });
  await open(page, [target]);
  const finalCursor = Buffer.from("mock-thread-950").toString("base64url");
  await expect
    .poll(() =>
      target.fixture.requestLog.some(
        (request) =>
          request.method === "thread/list" &&
          request.params?.cursor === finalCursor,
      ),
    )
    .toBe(true);
  await expect(page.getByText(/正在补齐历史/)).toHaveCount(0);
  await views(page).getByRole("tab", { name: "最近", exact: true }).click();
  await expect(link(page, "工作区导航与搜索 · 1")).toHaveCount(1);
  await expect.poll(() => rows(page).count()).toBeLessThan(100);
  expect(
    target.fixture.requestLog.filter(
      (request) =>
        request.method === "thread/read" ||
        request.method === "thread/turns/list",
    ),
  ).toHaveLength(0);
  await link(page, "工作区导航与搜索 · 1").focus();
  await page.keyboard.press("End");
  const last = link(page, "失败恢复演示 · 1000");
  await expect(last).toBeFocused();
  await expect.poll(() => rows(page).count()).toBeLessThan(100);
  expect(
    target.fixture.requestLog.filter(
      (request) =>
        request.method === "thread/read" ||
        request.method === "thread/turns/list",
    ),
  ).toHaveLength(0);
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      target.fixture.requestLog.some(
        (request) =>
          request.method === "thread/read" &&
          request.threadId === "mock-thread-1000",
      ),
    )
    .toBe(true);
  await expect(page.locator('[data-slot="conversation-turn"]')).toHaveCount(2);
});

test("persists local favorites and handles rename, archive and undo through the row menu", async ({
  page,
}) => {
  const target = await server();
  await open(page, [target]);
  await expandProjects(page);
  const title = "工作区导航与搜索 · 1";
  await (
    await menu(page, title)
  )
    .getByRole("menuitem", { name: "收藏会话", exact: true })
    .click();
  await page.reload();
  await expect(link(page, title)).toHaveCount(1);
  await expect(
    (await menu(page, title)).getByRole("menuitem", {
      name: "取消收藏",
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await (
    await menu(page, title)
  )
    .getByRole("menuitem", { name: "重命名", exact: true })
    .click();
  const rename = page.getByRole("dialog", { name: "重命名会话", exact: true });
  const renamed = "侧栏导航验收";
  await rename.getByLabel("会话标题", { exact: true }).fill(renamed);
  await rename.getByRole("button", { name: "确认", exact: true }).click();
  await expect(rename).toBeHidden();
  await expect(link(page, renamed)).toHaveCount(1);
  await (
    await menu(page, renamed)
  )
    .getByRole("menuitem", { name: "归档", exact: true })
    .click();
  await expect(link(page, renamed)).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(link(page, renamed)).toHaveCount(1);
  expect(
    target.fixture.requestLog
      .filter((request) =>
        ["thread/name/set", "thread/archive", "thread/unarchive"].includes(
          request.method,
        ),
      )
      .map((request) => request.method),
  ).toEqual(["thread/name/set", "thread/archive", "thread/unarchive"]);
});
