import { expect, test } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";

const servers: ReturnType<typeof createMockServer>[] = [];
test.afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});
async function server(subagentSessions = false) {
  const fixture = createMockServer({ subagentSessions });
  servers.push(fixture);
  fixture.listen(0, "127.0.0.1");
  await once(fixture, "listening");
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  return { fixture, url: `ws://127.0.0.1:${address.port}` };
}
function permission(fixture: ReturnType<typeof createMockServer>) {
  fixture.publish({
    id: "permission",
    method: "item/permissions/requestApproval",
    params: {
      threadId: "mock-thread-010",
      turnId: "turn",
      itemId: "permission",
      environmentId: null,
      startedAtMs: Date.now(),
      cwd: "/demo/atlas-web",
      reason: "读取共享文档",
      permissions: { network: { enabled: true }, fileSystem: null },
    },
  });
}
test("task center separates equal request ids across environments and updates after handling", async ({
  page,
}) => {
  const first = await server();
  const second = await server();
  await page.route("**/codex-release", (route) =>
    route.fulfill({ json: { version: "0.160.0" } }),
  );
  await page.addInitScript(
    (profiles) =>
      localStorage.setItem("codex-environments", JSON.stringify(profiles)),
    [
      {
        id: "local",
        name: "本机",
        kind: "local",
        url: first.url,
        autoConnect: true,
      },
      {
        id: "remote",
        name: "远程测试",
        kind: "remote",
        url: second.url,
        autoConnect: true,
      },
    ],
  );
  await page.goto("/");
  for (const { fixture } of [first, second])
    await expect
      .poll(() =>
        fixture.requestLog.some((request) => request.method === "thread/list"),
      )
      .toBe(true);
  permission(first.fixture);
  permission(second.fixture);
  await page.getByRole("button", { name: "待办中心", exact: true }).click();
  const center = page.getByRole("dialog", { name: "待办中心" });
  await expect(
    center.getByRole("button", { name: /权限申请待审批/ }),
  ).toHaveCount(2);
  await center
    .getByRole("region", { name: "远程测试待办" })
    .getByRole("button", { name: /权限申请待审批/ })
    .click();
  await expect(center).toBeHidden();
  await page
    .getByRole("button", { name: "本轮允许所选权限", exact: true })
    .click();
  await expect
    .poll(() =>
      second.fixture.responseLog.some((reply) => reply.id === "permission"),
    )
    .toBe(true);
  expect(
    first.fixture.responseLog.some((reply) => reply.id === "permission"),
  ).toBe(false);
  await page.getByRole("button", { name: "待办中心", exact: true }).click();
  await expect(
    center
      .getByRole("region", { name: "远程测试待办" })
      .getByRole("button", { name: /权限申请待审批/ }),
  ).toHaveCount(0);
  await expect(
    center
      .getByRole("region", { name: "本机待办" })
      .getByRole("button", { name: /权限申请待审批/ }),
  ).toHaveCount(1);
});
test("task center opens a child approval in the agent drawer", async ({
  page,
}) => {
  const child = await server(true);
  await page.route("**/codex-release", (route) =>
    route.fulfill({ json: { version: "0.160.0" } }),
  );
  await page.addInitScript(
    (url) =>
      localStorage.setItem(
        "codex-environments",
        JSON.stringify([
          { id: "local", name: "本机", kind: "local", url, autoConnect: true },
        ]),
      ),
    child.url,
  );
  await page.goto("/");
  await expect
    .poll(() =>
      child.fixture.requestLog.some(
        (request) => request.method === "thread/list",
      ),
    )
    .toBe(true);
  permission(child.fixture);
  await page.getByRole("button", { name: "待办中心", exact: true }).click();
  await page
    .getByRole("dialog", { name: "待办中心" })
    .getByRole("button", { name: /权限申请待审批/ })
    .click();
  const drawer = page.locator('[data-slot="agent-drawer"]');
  await expect(drawer).toBeVisible();
  await drawer
    .getByRole("button", { name: "本轮允许所选权限", exact: true })
    .click();
  await expect
    .poll(() =>
      child.fixture.responseLog.some((reply) => reply.id === "permission"),
    )
    .toBe(true);
});
test("draft reload restores unsent text and send policy inherits until explicitly overridden", async ({
  page,
}) => {
  const target = await server();
  const frames: { method?: string; params?: Record<string, unknown> }[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      try {
        frames.push(JSON.parse(String(frame.payload)));
      } catch {
        /* bridge frame */
      }
    }),
  );
  await page.route("**/codex-release", (route) =>
    route.fulfill({ json: { version: "0.160.0" } }),
  );
  await page.addInitScript(
    (url) =>
      localStorage.setItem(
        "codex-environments",
        JSON.stringify([
          { id: "local", name: "本机", kind: "local", url, autoConnect: true },
        ]),
      ),
    target.url,
  );
  await page.goto("/");
  await expect
    .poll(() =>
      target.fixture.requestLog.some(
        (request) => request.method === "thread/list",
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: /^新建会话/ }).click();
  const creation = page.getByRole("dialog", { name: "新建会话" });
  await creation.getByLabel("工作目录").fill("/demo/atlas-web");
  await creation.getByRole("button", { name: "创建会话", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "消息输入框" });
  await editor.fill("刷新前保留的普通草稿");
  await page.reload();
  await expect(editor).toHaveText("刷新前保留的普通草稿");
  expect(
    frames.filter(
      (frame) =>
        frame.method === "thread/start" || frame.method === "turn/start",
    ),
  ).toHaveLength(0);
  await expect(page.locator('[data-slot="policy-choice"]')).toContainText(
    "继承会话策略",
  );
  await page.locator('[data-slot="composer-action"]').click();
  await expect
    .poll(() => frames.filter((frame) => frame.method === "turn/start").length)
    .toBe(1);
  const start = frames.find((frame) => frame.method === "thread/start")?.params;
  expect(start).toBeDefined();
  expect(start).not.toHaveProperty("sandbox");
  expect(start).not.toHaveProperty("approvalPolicy");
  expect(
    frames.find((frame) => frame.method === "turn/start")?.params,
  ).not.toHaveProperty("approvalPolicy");
  await expect(
    page.getByRole("status").filter({ hasText: "准备就绪" }),
  ).toBeVisible();
  await page.locator('[data-slot="policy-choice"]').click();
  await page.getByRole("menuitemradio", { name: /谨慎审批/ }).click();
  await editor.fill("显式覆盖策略发送");
  await page.locator('[data-slot="composer-action"]').click();
  await expect
    .poll(() => frames.filter((frame) => frame.method === "turn/start").length)
    .toBe(2);
  expect(
    frames.filter((frame) => frame.method === "turn/start").at(-1)?.params,
  ).toHaveProperty("approvalPolicy", "untrusted");
});
