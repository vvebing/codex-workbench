import { expect, test, type Page } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";

let server: ReturnType<typeof createMockServer>;
test.beforeEach(async ({ page }) => {
  server = createMockServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing address");
  await page.addInitScript(
    (url) =>
      localStorage.setItem(
        "codex-environments",
        JSON.stringify([
          { id: "local", name: "本机", kind: "local", url, autoConnect: true },
        ]),
      ),
    `ws://127.0.0.1:${address.port}`,
  );
  await page.goto("/?env=local&session=mock-thread-001");
  await expect(page.getByRole("textbox", { name: "消息输入框" })).toBeVisible();
  await expect(page.locator("[data-prompt-id]").first()).toBeAttached();
});
test.afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "消息输入框" }).fill(text);
  const count = await page.locator('[data-slot="conversation-turn"]').count();
  await page.locator("[data-slot=composer-action]").click();
  await expect(page.locator('[data-slot="conversation-turn"]')).toHaveCount(
    count + 1,
  );
  await expect(
    page.locator('[data-slot="conversation-turn-footer"]').last(),
  ).toContainText("已完成");
}

test("prompt dots reveal titles, navigate and contain overflow on narrow screens", async ({
  page,
}) => {
  const turnId = await page
    .locator('[data-slot="conversation-turn"]')
    .last()
    .getAttribute("data-turn-id");
  for (let i = 0; i < 30; i++) {
    server.publish({
      method: "item/completed",
      params: {
        threadId: "mock-thread-001",
        turnId,
        item: {
          type: "userMessage",
          id: `dot-${i}`,
          clientId: null,
          content: [
            { type: "text", text: `导航问题 ${i + 1}`, text_elements: [] },
          ],
        },
      },
    });
  }
  const nav = page.getByRole("navigation", { name: "会话轮次导航" });
  const dots = nav.locator(".prompt-dot");
  await expect(dots).toHaveCount(32);
  const rail = nav.locator(".prompt-dot-scroll");
  await expect
    .poll(() => rail.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true);
  await dots.first().focus();
  await page.keyboard.press("Home");
  await dots.first().hover();
  await expect(page.getByRole("tooltip")).toContainText("第 1 条问题");
  await dots.first().click();
  await expect(page.locator("[data-prompt-id]").first()).toBeInViewport();
  await expect(dots.first()).toHaveAttribute("aria-current", "location");
  await page.keyboard.press("End");
  await expect(dots.last()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-prompt-id="dot-29"]')).toBeInViewport();
  await expect(dots.last()).toHaveAttribute("aria-current", "location");
  await page.setViewportSize({ width: 390, height: 600 });
  await expect(nav).toBeInViewport();
  expect(
    await nav.evaluate((el) => el.getBoundingClientRect().height),
  ).toBeLessThan(400);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await expect(page.getByRole("textbox", { name: "搜索用户问题" })).toHaveCount(
    0,
  );
});

test("long rendered prompts fold by default and expand without editing the draft", async ({
  page,
}) => {
  const text = Array.from(
    { length: 65 },
    (_, i) => `长文本第 ${i + 1} 行`,
  ).join("\n");
  await send(page, text);
  const prompt = page
    .locator("[data-prompt-id]")
    .filter({ hasText: "长文本第 65 行" });
  const toggle = prompt.getByRole("button", { name: "展开完整问题" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const folded = await prompt.evaluate(
    (el) => el.getBoundingClientRect().height,
  );
  expect(folded).toBeLessThan(300);
  await toggle.click();
  await expect(
    prompt.getByRole("button", { name: "收起问题" }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(
    await prompt.evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThan(folded + 500);
  await prompt.getByRole("button", { name: "收起问题" }).click();
  await expect(toggle).toBeVisible();
  await expect(page.getByRole("textbox", { name: "消息输入框" })).toHaveText(
    "",
  );
});

test("turn results expose file navigation and coloured patch lines without narrow-screen overflow", async ({
  page,
}) => {
  await send(page, "实现变更查看测试");
  const results = page.locator('[data-slot="turn-results"]').last();
  await results.getByRole("button", { name: /本轮变更 ·/ }).click();
  await expect(
    results.getByRole("navigation", { name: "本轮变更文件" }),
  ).toBeVisible();
  await expect(results.locator(".text-diff-added").first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    )
    .toBeLessThanOrEqual(1);
});

test("empty thinking records do not create execution controls", async ({
  page,
}) => {
  const empty = {
    type: "reasoning",
    id: "empty-thinking",
    summary: [],
    content: [],
  };
  const final = {
    type: "agentMessage",
    id: "answer-only",
    phase: "final_answer",
    text: "直接回答，没有执行过程。",
    questions: null,
    memoryCitation: null,
    delivery: null,
  };
  const turn = {
    id: "no-visible-process",
    rootTurnId: null,
    status: "completed",
    itemsView: "full",
    error: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    items: [empty, final],
  };
  server.publish({
    method: "turn/completed",
    params: { threadId: "mock-thread-001", turn },
  });
  const section = page.locator('[data-turn-id="no-visible-process"]');
  await expect(section).toContainText("直接回答，没有执行过程。");
  await expect(
    section.locator('[data-slot="turn-process-divider"]'),
  ).toHaveCount(0);
  server.publish({
    method: "turn/completed",
    params: {
      threadId: "mock-thread-001",
      turn: {
        ...turn,
        items: [
          empty,
          { type: "plan", id: "real-plan", text: "检查布局并验证" },
          final,
        ],
      },
    },
  });
  await section
    .getByRole("button", { name: "展开执行过程", exact: true })
    .click();
  await expect(
    section.getByRole("button", { name: "收起执行过程", exact: true }),
  ).toBeVisible();
  await expect(section).toContainText("执行计划");
});
