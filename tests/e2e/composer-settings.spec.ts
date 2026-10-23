import { expect, test, type Page } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";
import type { Model } from "../../src/generated/v2/Model";

const models = [
  {
    id: "mock-codex",
    model: "mock-codex",
    displayName: "Settings model",
    description: "Settings fixture",
    isDefault: true,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [
      { reasoningEffort: "medium", description: "Medium" },
    ],
    inputModalities: ["text"],
    serviceTiers: [
      { id: "priority", name: "优先档位", description: "目录中的优先服务说明" },
      { id: "default", name: "标准档位", description: "标准服务说明" },
    ],
    defaultServiceTier: "default",
  },
  {
    id: "other",
    model: "other",
    displayName: "Other model",
    description: "No tiers",
    isDefault: false,
    supportedReasoningEfforts: [],
    serviceTiers: [],
    defaultServiceTier: null,
    inputModalities: ["text"],
  },
] as Model[];
let server: ReturnType<typeof createMockServer>;
async function setup(page: Page) {
  server = createMockServer({ models, streamGate: new Promise(() => {}) });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing listener");
  await page.route("**/codex-release", (route) =>
    route.fulfill({ json: { version: "0.160.0" } }),
  );
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
  await page.goto("/");
  await page.getByRole("button", { name: "连接工作环境", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "连接与设置" });
  await dialog.getByRole("tab", { name: "工作环境", exact: true }).click();
  await dialog
    .getByLabel("App-server 地址")
    .fill(`ws://127.0.0.1:${address.port}`);
  await dialog.getByRole("button", { name: "连接", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "开始新会话", exact: true }).click();
  await page
    .getByRole("dialog", { name: "新建会话" })
    .getByRole("button", { name: "创建会话", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "消息输入框" })).toBeVisible();
  await page.locator('[data-slot="model-choice"]').click();
  await page.getByRole("menuitemradio", { name: /Settings model/ }).click();
}
async function chooseTier(page: Page, name: string) {
  await page.locator('[data-slot="service-tier-choice"]').click();
  await page.getByRole("menuitemradio", { name }).click();
}
async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "消息输入框" }).fill(text);
  await page.keyboard.press("Enter");
}
test.afterEach(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
});

test("composer settings show server approval and next overrides, and snapshot queue tiers", async ({
  page,
}) => {
  await setup(page);
  await expect(page.locator('[data-slot="policy-choice"]')).toContainText(
    "尚未获取",
  );
  await chooseTier(page, "优先档位");
  await send(page, "first settings task");
  await expect
    .poll(
      () =>
        server.requestLog.filter((entry) => entry.method === "turn/start")
          .length,
    )
    .toBe(1);
  const first = server.requestLog.find(
    (entry) => entry.method === "turn/start",
  )!;
  expect(first.params).toMatchObject({ serviceTier: "priority" });
  expect(first.params).not.toHaveProperty("serviceTierForTurn");
  expect(
    server.requestLog.find((entry) => entry.method === "thread/start")?.params,
  ).not.toHaveProperty("serviceTier");
  await expect(page.locator('[data-slot="policy-choice"]')).toContainText(
    "审批：按需审批",
  );
  await page.locator('[data-slot="service-tier-choice"]').click();
  await expect(page.getByText(/当前会话（服务端）：服务端默认/)).toBeVisible();
  await page.keyboard.press("Escape");
  const threadId = first.params!.threadId;
  server.publish({
    method: "thread/settings/updated",
    params: {
      threadId,
      threadSettings: {
        approvalPolicy: "never",
        serviceTier: "priority",
        model: "mock-codex",
        cwd: "/demo/atlas-web",
        effort: "medium",
      },
    },
  });
  await expect(page.locator('[data-slot="policy-choice"]')).toContainText(
    "审批：不请求审批",
  );
  await page.locator('[data-slot="policy-choice"]').click();
  await expect(
    page.getByText("当前会话（服务端）：不请求审批", { exact: true }),
  ).toBeVisible();
  await page.getByRole("menuitemradio", { name: /按需审批/ }).click();
  await expect(page.locator('[data-slot="policy-choice"]')).toContainText(
    "下次：按需审批",
  );
  await chooseTier(page, "标准档位");
  await send(page, "queued settings task");
  await expect(
    page.getByText("queued settings task", { exact: true }).first(),
  ).toBeVisible();
  await chooseTier(page, "优先档位");
  await page.getByRole("button", { name: "停止执行", exact: true }).click();
  await expect(page.getByRole("button", { name: /继续队列/ })).toBeVisible();
  await page.getByRole("button", { name: /继续队列/ }).click();
  await expect
    .poll(
      () =>
        server.requestLog.filter((entry) => entry.method === "turn/start")
          .length,
    )
    .toBe(2);
  expect(
    server.requestLog.filter((entry) => entry.method === "turn/start")[1]
      .params,
  ).toMatchObject({ serviceTier: "default", approvalPolicy: "on-request" });
});

test("composer settings reject incompatible tier selections after a model switch", async ({
  page,
}) => {
  await setup(page);
  await chooseTier(page, "优先档位");
  await page.locator('[data-slot="model-choice"]').click();
  await page.getByRole("menuitemradio", { name: /Other model/ }).click();
  await page.locator('[data-slot="service-tier-choice"]').click();
  await expect(
    page.getByText("当前模型未声明可选服务档位。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("之前选择的档位不适用于当前模型，本次将沿用会话设置。", {
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await send(page, "other model settings");
  await expect
    .poll(
      () =>
        server.requestLog.filter((entry) => entry.method === "turn/start")
          .length,
    )
    .toBe(1);
  const params = server.requestLog.find(
    (entry) => entry.method === "turn/start",
  )!.params;
  expect(params).toMatchObject({ model: "other" });
  expect(params).not.toHaveProperty("serviceTier");
});

test("composer settings remain within a 390px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await expect(
    page.getByRole("button", { name: "上下文：暂无数据" }),
  ).toBeVisible();
  const composer = page.locator('[data-slot="conversation-composer"]');
  await expect(composer).toBeVisible();
  expect(
    await composer.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.locator('[data-slot="service-tier-choice"]').click();
  await expect(
    page.getByRole("menuitemradio", { name: /优先档位/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
