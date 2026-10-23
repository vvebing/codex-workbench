import { expect, test } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";

test("first local draft message keeps its DOM through thread creation and promotion", async ({
  page,
}) => {
  const fixture = createMockServer({
    responseDelayMs: (method) => (method === "thread/start" ? 1500 : 0),
    rejectEmptyThreadRead: true,
    delayedUserEchoMs: 1200,
  });
  fixture.listen(0, "127.0.0.1");
  await once(fixture, "listening");
  const address = fixture.address();
  if (!address || typeof address === "string") throw Error("No listener");
  try {
    await page.route("**/codex-release", (route) =>
      route.fulfill({ json: { version: "0.160.0" } }),
    );
    await page.addInitScript(
      (url) =>
        localStorage.setItem(
          "codex-environments",
          JSON.stringify([
            {
              id: "local",
              name: "本机",
              kind: "local",
              url,
              autoConnect: true,
            },
          ]),
        ),
      `ws://127.0.0.1:${address.port}`,
    );
    await page.goto("/");
    await expect
      .poll(() =>
        fixture.requestLog.some((request) => request.method === "thread/list"),
      )
      .toBe(true);
    await page.keyboard.press("Control+Shift+o");
    const dialog = page.getByRole("dialog", { name: "新建会话" });
    await dialog.getByLabel("工作目录").fill("/demo/atlas-web");
    await dialog.getByRole("button", { name: "创建会话", exact: true }).click();
    await expect(dialog).toBeHidden();
    const editor = page.getByRole("textbox", { name: "消息输入框" });
    const text =
      "slow local first identity " + "第一条消息布局稳定。".repeat(35);
    await editor.fill(text);
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const local = page.locator('[data-slot="local-message"]');
    await expect(local).toHaveAttribute("data-delivery-status", "creating");
    const bubble = page.locator("[data-prompt-id]").filter({ hasText: text });
    const before = await bubble.evaluate((node) => {
      node.setAttribute("data-draft-continuity", "original");
      node
        .closest("[data-turn-id]")!
        .setAttribute("data-draft-parent", "original");
      node
        .closest('[data-slot="conversation-timeline-shell"]')!
        .setAttribute("data-draft-timeline", "original");
      const rect = node.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        padding: getComputedStyle(node).padding,
      };
    });
    await expect
      .poll(() =>
        fixture.requestLog.some((request) => request.method === "turn/start"),
      )
      .toBe(true);
    await expect(local).toHaveCount(0);
    const early = page.locator(
      '[data-slot="conversation-tool"][data-reading-id^="early-"]',
    );
    await expect(early).toBeVisible();
    await expect(page.locator('[data-slot="conversation-turn"]')).toHaveCount(
      1,
    );
    await expect(bubble).toHaveAttribute("data-draft-continuity", "original");
    await expect(
      bubble.locator('[data-slot="local-delivery-status"]'),
    ).toBeVisible();
    expect(
      await bubble.evaluate((node) => {
        const turn = node.closest("[data-turn-id]")!;
        const tool = turn.querySelector('[data-slot="conversation-tool"]')!;
        return !!(
          node.compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_FOLLOWING
        );
      }),
    ).toBe(true);
    await expect(
      bubble.locator('[data-slot="local-delivery-status"]'),
    ).toHaveCount(0);

    await expect(bubble).toHaveAttribute("data-draft-continuity", "original");
    await expect(page.locator('[data-draft-parent="original"]')).toHaveCount(1);
    await expect(page.locator('[data-draft-timeline="original"]')).toHaveCount(
      1,
    );
    const after = await bubble.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        padding: getComputedStyle(node).padding,
      };
    });
    expect(after).toEqual(before);
  } finally {
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
});
