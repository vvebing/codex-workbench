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
async function open(
  page: Page,
  targets: Awaited<ReturnType<typeof server>>[],
  names?: string[],
) {
  await page.route("**/codex-release", (route) =>
    route.fulfill({ json: { version: "0.163.0" } }),
  );
  await page.addInitScript(
    (profiles) => {
      if (!localStorage.getItem("codex-environments"))
        localStorage.setItem("codex-environments", JSON.stringify(profiles));
    },
    targets.map((target, index) => ({
      id: index > 1 ? `remote-${index}` : index ? "remote" : "local",
      name: names?.[index] ?? (index ? "远程测试" : "本机"),
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
async function resizeNavigation(page: Page, width: number) {
  const panel = page.locator('[data-panel-id="navigation"]');
  const bounds = (await panel.boundingBox())!;
  const handle = (await page
    .getByRole("separator", { name: "调整导航宽度", exact: true })
    .boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 80);
  await page.mouse.down();
  await page.mouse.move(bounds.x + width + handle.width / 2, handle.y + 80, {
    steps: 12,
  });
  await page.mouse.up();
  await expect
    .poll(async () => Math.abs((await panel.boundingBox())!.width - width))
    .toBeLessThan(1);
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

test("keeps newly created sessions at the front after switching environment scopes without reloading", async ({
  page,
}) => {
  const local = await server();
  const remote = await server();
  await open(page, [local, remote]);
  await page.getByRole("button", { name: /^新建会话/ }).click();
  const create = page.getByRole("dialog", { name: "新建会话", exact: true });
  await create.getByLabel("工作目录", { exact: true }).fill("/demo/atlas-web");
  await create.getByRole("button", { name: "创建会话", exact: true }).click();
  const composer = page.getByRole("textbox", {
    name: "消息输入框",
    exact: true,
  });
  const scope = page.getByRole("tablist", {
    name: "按工作环境筛选会话",
    exact: true,
  });
  await composer.fill("新建会话切换环境后立即可见");
  await scope.getByRole("tab", { name: "远程测试", exact: true }).click();
  await scope.getByRole("tab", { name: "本机", exact: true }).click();
  await expect(rows(page).first()).toContainText("草稿 · 未发送");
  await expect(composer).toHaveText("新建会话切换环境后立即可见");
  await page.locator('[data-slot="composer-action"]').click();
  const title = "新建会话切换环境后立即可见";
  await expect(link(page, title)).toHaveAttribute("aria-current", "page");
  await scope.getByRole("tab", { name: "远程测试", exact: true }).click();
  await scope.getByRole("tab", { name: "本机", exact: true }).click();
  await expect(rows(page).first()).toContainText(title);
  await expect(link(page, title)).toBeInViewport();
  await views(page).getByRole("tab", { name: "最近", exact: true }).click();
  await expect(rows(page).first()).toContainText(title);
  await scope.getByRole("tab", { name: "全部", exact: true }).click();
  await expect(rows(page).first()).toContainText(title);
  await scope.getByRole("tab", { name: "本机", exact: true }).click();
  await views(page).getByRole("tab", { name: "项目", exact: true }).click();
  await expect(rows(page).first()).toContainText(title);
});

test("unnamed sessions keep task titles across diagnostic previews, navigation and reloads", async ({
  page,
}) => {
  const target = await server({ diagnosticTitlePreviews: true });
  await open(page, [target]);
  const unnamed = page
    .locator('[data-slot="thread-link"]')
    .filter({ hasText: "未命名会话" });
  await expect(unnamed).toHaveCount(2);
  expect(
    target.fixture.requestLog.filter(
      (request) => request.method === "thread/read",
    ),
  ).toHaveLength(0);
  await unnamed.first().click();
  await expect(link(page, "分析 Session 频繁请求")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page).toHaveTitle("分析 Session 频繁请求 · Codex 工作台");
  await unnamed.click();
  await expect(link(page, "分析接口 401 与安全更新的关系")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.reload();
  await expect(link(page, "分析 Session 频繁请求")).toBeVisible();
  await expect(link(page, "分析接口 401 与安全更新的关系")).toBeVisible();
  await page.getByRole("button", { name: /^搜索会话 (?:⌘|Ctrl) K$/ }).click();
  const search = page.getByRole("dialog", { name: "搜索会话", exact: true });
  await search
    .getByPlaceholder("搜索标题、摘要或工作区…")
    .fill("Session 频繁请求");
  await expect(
    search
      .getByRole("listbox", { name: "会话搜索结果" })
      .getByRole("option")
      .first(),
  ).toContainText("分析 Session 频繁请求");
  expect(
    target.fixture.requestLog.some(
      (request) => request.method === "thread/name/set",
    ),
  ).toBe(false);
  await search.getByRole("button", { name: "关闭", exact: true }).click();
  await (
    await menu(page, "分析 Session 频繁请求")
  )
    .getByRole("menuitem", { name: "重命名", exact: true })
    .click();
  const rename = page.getByRole("dialog", { name: "重命名会话", exact: true });
  await rename.getByLabel("会话标题", { exact: true }).fill("登录鉴权排查");
  await rename.getByRole("button", { name: "确认", exact: true }).click();
  await expect(link(page, "登录鉴权排查")).toBeVisible();
  await page.reload();
  await expect(link(page, "登录鉴权排查")).toBeVisible();
});

test("uses a bounded environment selector when full names do not fit", async ({
  page,
}) => {
  const targets = [await server(), await server(), await server()];
  const remoteName = "生产代理环境 · 这是用于验证窄侧栏截断的较长环境名称";
  await open(page, targets, ["本机", "远程测试", remoteName]);
  const selector = page.getByRole("combobox", {
    name: "按工作环境筛选会话",
    exact: true,
  });
  await expect(selector).toHaveText("本机");
  await expect(
    page.getByRole("tablist", { name: "按工作环境筛选会话" }),
  ).toHaveCount(0);
  const list = page.getByLabel("会话列表", { exact: true });
  const initial = (await list.boundingBox())!;
  await selector.click();
  await expect(page.getByRole("option")).toHaveCount(4);
  await page.getByRole("option", { name: remoteName, exact: true }).click();
  await expect(selector).toHaveText(remoteName);
  await expect(rows(page)).toHaveCount(15);
  await expect(rows(page).first()).toHaveAttribute(
    "data-environment-id",
    "remote-2",
  );
  await expect
    .poll(() =>
      selector.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    )
    .toBe(true);
  expect((await list.boundingBox())!.y).toBe(initial.y);
  await selector.click();
  await expect(
    page.getByRole("option", { name: remoteName, exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("option", { name: "全部环境 · 3", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(selector).toHaveText("全部环境 · 3");
  await expect(rows(page)).toHaveCount(45);
  await page.reload();
  await expect(selector).toHaveText("全部环境 · 3");
});

test("two environments with long names use a dropdown without horizontal scrolling", async ({
  page,
}) => {
  await open(
    page,
    [await server(), await server()],
    ["本机测试环境名称较长", "远程测试环境名称也较长"],
  );
  const selector = page.getByRole("combobox", {
    name: "按工作环境筛选会话",
    exact: true,
  });
  await expect(selector).toHaveText("本机测试环境名称较长");
  await resizeNavigation(page, 240);
  await selector.click();
  await page
    .getByRole("option", { name: "远程测试环境名称也较长", exact: true })
    .click();
  await expect(selector).toHaveText("远程测试环境名称也较长");
  expect(
    await selector.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
});

test("environment filtering adapts to sidebar resizing without changing scope or list height", async ({
  page,
}) => {
  await open(page, [await server(), await server()]);
  const tabs = page.getByRole("tablist", {
    name: "按工作环境筛选会话",
    exact: true,
  });
  const selector = page.getByRole("combobox", {
    name: "按工作环境筛选会话",
    exact: true,
  });
  await tabs.getByRole("tab", { name: "远程测试", exact: true }).click();
  await expect(page.getByText(/正在补齐历史/)).toHaveCount(0);
  const viewport = page.getByLabel("会话列表", { exact: true });
  const initial = (await viewport.boundingBox())!;
  await resizeNavigation(page, 240);
  await expect(selector).toHaveText("远程测试");
  await expect(tabs).toHaveCount(0);
  expect((await viewport.boundingBox())!.y).toBe(initial.y);
  expect((await viewport.boundingBox())!.height).toBe(initial.height);
  await selector.click();
  await page.getByRole("option", { name: "全部环境 · 2", exact: true }).click();
  await expect(selector).toHaveText("全部环境 · 2");
  await expect(rows(page)).toHaveCount(30);
  await resizeNavigation(page, 400);
  await expect(
    tabs.getByRole("tab", { name: "全部", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(selector).toHaveCount(0);
  expect((await viewport.boundingBox())!.y).toBe(initial.y);
  expect((await viewport.boundingBox())!.height).toBe(initial.height);
  await resizeNavigation(page, 240);
  await expect(selector).toHaveText("全部环境 · 2");
  expect(
    await page
      .locator('[data-panel-id="navigation"]')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.reload();
  await expect(selector).toHaveText("全部环境 · 2");
});

test("three environments use full tabs when the sidebar is wide enough", async ({
  page,
}) => {
  await open(
    page,
    [await server(), await server(), await server()],
    ["本机", "开发", "预发"],
  );
  const tabs = page.getByRole("tablist", {
    name: "按工作环境筛选会话",
    exact: true,
  });
  const selector = page.getByRole("combobox", {
    name: "按工作环境筛选会话",
    exact: true,
  });
  await expect(selector).toHaveText("本机");
  await resizeNavigation(page, 400);
  await expect(tabs.getByRole("tab")).toHaveCount(4);
  await tabs.getByRole("tab", { name: "预发", exact: true }).click();
  await resizeNavigation(page, 240);
  await expect(selector).toHaveText("预发");
  await selector.click();
  await expect(
    page.getByRole("option", { name: "预发", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(selector).toBeFocused();
});

test("environment filtering follows font size and preserves focus when changing controls", async ({
  page,
}) => {
  await open(page, [await server(), await server()]);
  const tabs = page.getByRole("tablist", {
    name: "按工作环境筛选会话",
    exact: true,
  });
  const selector = page.getByRole("combobox", {
    name: "按工作环境筛选会话",
    exact: true,
  });
  const current = tabs.getByRole("tab", { name: "本机", exact: true });
  await current.focus();
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--font-scale", "1.5"),
  );
  await expect(selector).toBeFocused();
  await selector.click();
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--font-scale", "1"),
  );
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(tabs).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(current).toBeFocused();
});

test("locates the current session from the view toolbar without moving the list viewport", async ({
  page,
}) => {
  const local = await server();
  const remote = await server();
  await open(page, [local, remote]);
  const locate = page.getByRole("button", {
    name: "定位当前会话",
    exact: true,
  });
  await expect(locate).toBeDisabled();
  await expect(locate).toHaveText("");
  await link(page, "工作区导航与搜索 · 1").click();
  const scope = page.getByRole("tablist", {
    name: "按工作环境筛选会话",
    exact: true,
  });
  const viewport = page.getByLabel("会话列表", { exact: true });
  const highlight = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.hidden = true;
    probe.style.color = "var(--accent)";
    probe.style.backgroundColor = "var(--selected)";
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const colors = { color: style.color, background: style.backgroundColor };
    probe.remove();
    return colors;
  });
  for (const view of ["项目", "最近"]) {
    await views(page).getByRole("tab", { name: view, exact: true }).click();
    await expect(page.getByText(/正在补齐历史/)).toHaveCount(0);
    const tabs = (await views(page).boundingBox())!;
    const icon = (await locate.boundingBox())!;
    expect(icon.x).toBeGreaterThanOrEqual(tabs.x + tabs.width);
    expect(
      Math.abs(icon.y + icon.height / 2 - tabs.y - tabs.height / 2),
    ).toBeLessThan(1);
    const initial = (await viewport.boundingBox())!;
    await scope.getByRole("tab", { name: "远程测试", exact: true }).click();
    await expect
      .poll(() =>
        remote.fixture.requestLog.some(
          (request) =>
            request.method === "thread/list" && request.params?.cursor,
        ),
      )
      .toBe(true);
    await expect(page.getByText(/正在补齐历史/)).toHaveCount(0);
    await expect(locate).toHaveAttribute(
      "title",
      "当前会话不在此范围 · 定位当前会话",
    );
    await expect(locate).toHaveAttribute("data-highlighted", "true");
    await expect(locate).toHaveCSS("color", highlight.color);
    await expect(locate).toHaveCSS("background-color", highlight.background);
    await locate.hover();
    await expect(locate).toHaveCSS("color", highlight.color);
    await expect(
      page.getByText("当前会话不在此范围 · 定位当前会话", { exact: true }),
    ).toHaveCount(0);
    const hidden = (await viewport.boundingBox())!;
    expect(hidden.y).toBe(initial.y);
    expect(hidden.height).toBe(initial.height);
    await locate.click();
    await expect(
      scope.getByRole("tab", { name: "本机", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(link(page, "工作区导航与搜索 · 1")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(link(page, "工作区导航与搜索 · 1")).toBeInViewport();
    await expect(locate).toHaveAttribute("title", "定位当前会话");
    await expect(locate).not.toHaveAttribute("data-highlighted");
    const revealed = (await viewport.boundingBox())!;
    expect(revealed.y).toBe(hidden.y);
    expect(revealed.height).toBe(hidden.height);
    expect((await locate.boundingBox())!.y).toBe(icon.y);
  }
  await scope.getByRole("tab", { name: "全部", exact: true }).click();
  await locate.click();
  await expect(
    scope.getByRole("tab", { name: "全部", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.locator(
      '[data-environment-id="local"] [data-slot="thread-link"][aria-current="page"]',
    ),
  ).toBeInViewport();
});

test("locates offscreen, collapsed and filtered sessions while retaining the toolbar layout", async ({
  page,
}) => {
  const target = await server();
  await open(page, [target]);
  const current = link(page, "工作区导航与搜索 · 1");
  await current.click();
  const locate = page.getByRole("button", {
    name: "定位当前会话",
    exact: true,
  });
  await views(page).getByRole("tab", { name: "最近", exact: true }).click();
  const viewport = page.getByLabel("会话列表", { exact: true });
  const bounds = (await viewport.boundingBox())!;
  await viewport.evaluate((element) => {
    element.scrollTop = 1200;
  });
  await expect(current).not.toBeInViewport();
  await expect(locate).toHaveAttribute("data-highlighted", "true");
  await expect(locate).toHaveAttribute(
    "title",
    "当前会话不在可见区域 · 定位当前会话",
  );
  await locate.click();
  await expect(current).toBeInViewport();
  await expect(locate).not.toHaveAttribute("data-highlighted");
  const visibleTop = await viewport.evaluate((element) => element.scrollTop);
  await locate.click();
  expect(await viewport.evaluate((element) => element.scrollTop)).toBe(
    visibleTop,
  );
  await viewport.evaluate((element) => {
    element.scrollTop = 1200;
  });
  await expect(current).not.toBeInViewport();
  await status(page, "未读结果");
  await expect(rows(page)).toHaveCount(0);
  await expect(locate).toHaveAttribute("data-highlighted", "true");
  await locate.click();
  await expect(current).toBeInViewport();
  expect((await viewport.boundingBox())!.y).toBe(bounds.y);
  await views(page).getByRole("tab", { name: "项目", exact: true }).click();
  const project = projects(page).filter({ hasText: "atlas-web" });
  await project.click();
  await expect(current).toHaveCount(0);
  await expect(locate).toHaveAttribute("data-highlighted", "true");
  await locate.click();
  await expect(project).toHaveAttribute("aria-expanded", "true");
  await expect(current).toBeInViewport();
  await expect(locate).not.toHaveAttribute("data-highlighted");
});

test("recent session order and activity times stay unchanged when switching conversations", async ({
  page,
}) => {
  const local = await server({ historicalTurnTimes: true });
  await open(page, [local]);
  await views(page).getByRole("tab", { name: "最近", exact: true }).click();
  await expect(rows(page)).toHaveCount(90);
  const activityList = () =>
    rows(page).evaluateAll((elements) =>
      elements.map((element) => ({
        title: element
          .querySelector('[data-slot="thread-link"]')
          ?.getAttribute("title"),
        activityAt: element.querySelector("time")?.getAttribute("datetime"),
      })),
    );
  const before = await activityList();
  for (const title of [
    "接口分页与错误处理 · 3",
    "失败恢复演示 · 6",
    "接口分页与错误处理 · 3",
  ]) {
    await link(page, title).click();
    await expect(link(page, title)).toHaveAttribute("aria-current", "page");
    await expect.poll(activityList).toEqual(before);
  }
  await views(page).getByRole("tab", { name: "项目", exact: true }).click();
  await views(page).getByRole("tab", { name: "最近", exact: true }).click();
  await expect.poll(activityList).toEqual(before);
  await page.reload();
  await expect(rows(page)).toHaveCount(90);
  await expect.poll(activityList).toEqual(before);

  await page
    .getByRole("textbox", { name: "消息输入框", exact: true })
    .fill("实际发送消息后才更新活动排序");
  await page.locator('[data-slot="composer-action"]').click();
  await expect(rows(page).first()).toContainText("接口分页与错误处理 · 3");
});

test("recent sessions react immediately to newer activity", async ({
  page,
}) => {
  const local = await server();
  await open(page, [local]);
  await link(page, "工作区导航与搜索 · 1").click();
  await expect(
    page.getByRole("textbox", { name: "消息输入框", exact: true }),
  ).toBeVisible();
  await views(page).getByRole("tab", { name: "最近", exact: true }).click();
  await expect(rows(page).first()).toContainText("工作区导航与搜索 · 1");
  local.fixture.publish({
    method: "thread/started",
    params: {
      thread: {
        ...placeholderThread("mock-thread-090"),
        name: "失败恢复演示 · 90",
        cwd: "/demo/api-service",
        updatedAt: Math.floor(Date.now() / 1000) + 60,
      },
    },
  });
  await expect(rows(page).first()).toContainText("失败恢复演示 · 90");
  await views(page).getByRole("tab", { name: "项目", exact: true }).click();
  await expect(rows(page).first()).toContainText("失败恢复演示 · 90");
});

test("reaches the next project without traversing a long history and reveals older selections", async ({
  page,
}) => {
  const target = await server({ historicalTurnTimes: true });
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
  await expect(rows(page).first()).toContainText("待审批");
  await status(page, "运行中");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("接口分页与错误处理 · 10");
  await expect(
    rows(page).first().locator('[data-slot="thread-description"]'),
  ).toContainText("本机");
  await expect(
    rows(page).first().locator('[data-slot="thread-description"]'),
  ).toContainText("atlas-web");
  await expect(
    rows(page).first().locator('[data-slot="thread-description"]'),
  ).not.toContainText("运行中");
  await expect(
    rows(page).first().getByRole("img", { name: "运行中", exact: true }),
  ).toBeVisible();
  await views(page).getByRole("tab", { name: "项目", exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(
    rows(page).first().getByRole("img", { name: "运行中", exact: true }),
  ).toBeVisible();
  await expect(
    rows(page).first().locator('[data-slot="thread-description"]'),
  ).toHaveCount(0);
  await views(page).getByRole("tab", { name: "最近", exact: true }).click();
  await status(page, "未读结果");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("用户问题演示 · 12");
  for (const view of ["项目", "最近"]) {
    await views(page).getByRole("tab", { name: view, exact: true }).click();
    const completed = rows(page).first();
    const indicator = completed.getByRole("img", {
      name: "已完成，结果未读",
      exact: true,
    });
    await expect(indicator).toBeVisible();
    const icon = (await indicator.boundingBox())!;
    const title = (await completed
      .locator('[data-slot="thread-title"]')
      .boundingBox())!;
    expect(icon.x + icon.width).toBeLessThan(title.x);
    expect(icon.width).toBeGreaterThanOrEqual(12);
    expect(
      Math.abs(icon.y + icon.height / 2 - (title.y + title.height / 2)),
    ).toBeLessThan(2);
  }
  await link(page, "用户问题演示 · 12").click();
  await expect(rows(page)).toHaveCount(0);
  await status(page, "全部会话");
  await expect(rows(page)).toHaveCount(90);
});

test("status icons are absolute and show opening and initialization without shifting titles", async ({
  page,
}) => {
  const target = await server({
    historicalTurnTimes: true,
    responseDelayMs: (method) =>
      ["thread/read", "thread/resume"].includes(method) ? 800 : 0,
  });
  await open(page, [target]);
  for (const [view, title] of [
    ["项目", "工作区导航与搜索 · 1"],
    ["最近", "设计令牌与暗色模式 · 2"],
  ]) {
    await views(page).getByRole("tab", { name: view, exact: true }).click();
    const button = link(page, title);
    const titleElement = button.locator('[data-slot="thread-title"]');
    const statusElement = button.locator('[data-slot="thread-status"]');
    await expect(statusElement).toHaveCount(0);
    const before = (await titleElement.boundingBox())!;
    await button.click();
    await expect(
      button.getByRole("img", { name: "正在打开", exact: true }),
    ).toBeVisible();
    await expect(statusElement).toHaveCSS("position", "absolute");
    await expect(statusElement.locator("svg")).toHaveCount(1);
    const loading = (await titleElement.boundingBox())!;
    expect(loading.x).toBe(before.x);
    await expect(statusElement).toHaveCount(0);
    const after = (await titleElement.boundingBox())!;
    expect(after.x).toBe(before.x);
  }
  const current = link(page, "设计令牌与暗色模式 · 2");
  const titleElement = current.locator('[data-slot="thread-title"]');
  const before = (await titleElement.boundingBox())!;
  await page
    .getByRole("textbox", { name: "消息输入框", exact: true })
    .fill("初始化期间也保留明确反馈");
  await page.locator('[data-slot="composer-action"]').click();
  await expect(
    current.getByRole("img", { name: "正在初始化", exact: true }),
  ).toBeVisible();
  await expect(
    current.locator('[data-slot="thread-status"] > svg'),
  ).toHaveCount(1);
  expect((await titleElement.boundingBox())!.x).toBe(before.x);
  await expect(
    current.getByRole("img", { name: "运行中", exact: true }),
  ).toBeVisible();
  await expect(
    current.locator('[data-slot="initializing-indicator"]'),
  ).toHaveCount(0);
  expect((await titleElement.boundingBox())!.x).toBe(before.x);
});

test("current activity replaces unread completion without clearing unread results", async ({
  page,
}) => {
  const target = await server();
  await open(page, [target]);
  await status(page, "未读结果");
  await expect(rows(page)).toHaveCount(0);
  const publishTurn = (
    id: string,
    status: "inProgress" | "completed" | "failed",
  ) =>
    target.fixture.publish({
      method: status === "inProgress" ? "turn/started" : "turn/completed",
      params: {
        threadId: "mock-thread-012",
        turn: {
          id,
          rootTurnId: null,
          items: [],
          itemsView: "full",
          status,
          error: null,
          startedAt: 1,
          completedAt: status === "inProgress" ? null : 2,
          durationMs: status === "inProgress" ? null : 1000,
        },
      },
    });
  const expectStatus = async (label: string) => {
    for (const view of ["项目", "最近"]) {
      await views(page).getByRole("tab", { name: view, exact: true }).click();
      // The unread filter continues to find this thread while its current
      // execution or action state temporarily replaces the completion icon.
      await expect(rows(page)).toHaveCount(1);
      const row = rows(page).first();
      await expect(row).toContainText("用户问题演示 · 12");
      const slot = row.locator('[data-slot="thread-status"]');
      await expect(slot.locator("svg")).toHaveCount(1);
      await expect(slot.getByLabel(label, { exact: true })).toBeVisible();
      await expect(slot).toHaveCSS("width", "14px");
      if (label !== "已完成，结果未读")
        await expect(
          row.getByRole("img", { name: "已完成，结果未读", exact: true }),
        ).toHaveCount(0);
    }
  };
  publishTurn("queued-first", "completed");
  await expectStatus("已完成，结果未读");
  publishTurn("queued-second", "inProgress");
  await expectStatus("运行中");
  publishTurn("queued-second", "failed");
  await expectStatus("执行失败");
  publishTurn("queued-third", "inProgress");
  await expectStatus("运行中");
  publishTurn("queued-third", "completed");
  await expectStatus("已完成，结果未读");
  target.fixture.publish({
    id: "background-unread-approval",
    method: "item/permissions/requestApproval",
    params: {
      threadId: "mock-thread-012",
      turnId: "queued-third",
      itemId: "background-unread-approval",
      environmentId: null,
      startedAtMs: Date.now(),
      cwd: "/demo/api-service",
      reason: "检查未读会话的后续操作",
      permissions: { network: { enabled: true }, fileSystem: null },
    },
  });
  await expectStatus("待审批");
  await link(page, "用户问题演示 · 12").click();
  await expect(rows(page)).toHaveCount(0);
});

for (const view of ["项目", "最近"])
  for (const threadCount of [90, 1000])
    test(`stays at the top during repeated activity reordering in ${view} with ${threadCount} sessions`, async ({
      page,
    }) => {
      const target = await server({ threadCount });
      await open(page, [target]);
      if (threadCount === 1000) await expandProjects(page);
      await views(page).getByRole("tab", { name: view, exact: true }).click();
      await expect(page.getByText(/正在补齐历史/)).toHaveCount(0);
      const viewport = page.getByLabel("会话列表", { exact: true });
      expect(
        await viewport.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        ),
      ).toBeGreaterThan(0);
      await expect
        .poll(() => viewport.evaluate((element) => element.scrollTop))
        .toBe(0);
      const now = Math.floor(Date.now() / 1000);
      for (const [index, [id, cwd]] of [
        ["mock-thread-090", "/demo/api-service"],
        ["mock-thread-089", "/demo/design-system"],
        ["mock-thread-088", "/demo/atlas-web"],
        ["mock-thread-090", "/demo/api-service"],
      ].entries()) {
        const name = `执行中的会话 · ${index + 1}`;
        target.fixture.publish({
          method: "thread/started",
          params: {
            thread: {
              ...placeholderThread(id),
              name,
              cwd,
              updatedAt: now + 100 + index,
              status: { type: "active", activeFlags: [] },
            },
          },
        });
        await expect(rows(page).first()).toContainText(name);
        await expect
          .poll(() => viewport.evaluate((element) => element.scrollTop))
          .toBe(0);
      }
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
