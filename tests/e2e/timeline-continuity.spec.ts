import { expect, test } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";

test("optimistic long messages retain their DOM and rollback requires a scoped confirmation", async ({
  page,
}) => {
  const fixture = createMockServer({
    paginatedHistory: true,
    imageInput: true,
  });
  fixture.listen(0, "127.0.0.1");
  await once(fixture, "listening");
  const address = fixture.address();
  if (!address || typeof address === "string") throw Error("No listener");
  let releaseSend!: () => void;
  const sendGate = new Promise<void>((resolve) => {
    releaseSend = resolve;
  });
  try {
    // Keep the optimistic state observable until its DOM and layout are captured.
    await page.routeWebSocket("**/bridge", (socket) => {
      const upstream = socket.connectToServer();
      socket.onMessage(async (message) => {
        const frame = JSON.parse(message.toString()) as { method?: string };
        if (frame.method === "turn/start") await sendGate;
        upstream.send(message);
      });
    });
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
      .poll(() => fixture.requestLog.some((r) => r.method === "thread/list"))
      .toBe(true);
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", { name: "搜索会话" });
    await search
      .getByPlaceholder("搜索标题、摘要或工作区…")
      .fill("工作区导航与搜索 · 1");
    await page.keyboard.press("Enter");
    await expect(search).toBeHidden();
    const editor = page.getByRole("textbox", { name: "消息输入框" });
    const text = "slow identity " + "长消息换行保持气泡尺寸。".repeat(60);
    await editor.fill(text);
    await editor.evaluate((element) => {
      const data = new DataTransfer();
      const bytes =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
      data.items.add(
        new File(
          [Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0))],
          "continuity.png",
          { type: "image/png" },
        ),
      );
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect(page.locator('[data-slot="attachment"]')).toHaveCount(1);

    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const bubble = page.locator("[data-prompt-id]").filter({ hasText: text });
    await expect(bubble).toHaveCount(1);
    await expect(page.locator('[data-slot="local-message"]')).toBeVisible();
    await expect(
      bubble.locator('[data-slot="local-delivery-status"]'),
    ).toBeVisible();
    const placement = await bubble
      .locator('[data-slot="local-delivery-status"]')
      .evaluate((node) => {
        const status = node.getBoundingClientRect();
        const message = node
          .closest("[data-prompt-id]")!
          .getBoundingClientRect();
        return (
          status.top >= message.top &&
          status.bottom <= message.bottom &&
          status.left >= message.left + message.width / 2
        );
      });
    expect(placement).toBe(true);
    await expect(bubble.locator("img")).toHaveCount(1);
    await expect
      .poll(() =>
        bubble
          .locator("img")
          .evaluate((node) => (node as HTMLImageElement).complete),
      )
      .toBe(true);
    const initial = await bubble.evaluate((node) => {
      node.setAttribute("data-continuity-test", "original");
      const rect = node.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        padding: getComputedStyle(node).padding,
      };
    });
    releaseSend();
    await expect(
      page.locator('[data-slot="local-delivery-status"]'),
    ).toHaveCount(0);
    await expect(bubble).toHaveAttribute("data-continuity-test", "original");
    const final = await bubble.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        padding: getComputedStyle(node).padding,
      };
    });
    expect(final).toEqual(initial);
    const turn = bubble.locator("xpath=ancestor::section[@data-turn-id]");
    await expect(
      turn.locator('[data-slot="conversation-turn-footer"]'),
    ).toContainText("已完成");
    await expect(
      turn
        .locator('[data-slot="conversation-turn-footer"]')
        .getByRole("button", { name: "复制最终回答", exact: true }),
    ).toHaveCount(1);
    await expect(
      turn.locator(
        '[data-slot="assistant-answer"] :is([data-slot="answer-actions"], [data-slot="final-answer-actions"])',
      ),
    ).toHaveCount(0);
    await expect(
      turn.locator(
        '[data-slot="assistant-final-answer"] :is([data-slot="answer-actions"], [data-slot="final-answer-actions"])',
      ),
    ).toHaveCount(0);
    const process = turn.getByRole("button", { name: "展开执行过程" });
    await expect(process).toBeVisible();
    await expect(process).toHaveAttribute("aria-expanded", "false");
    await bubble.locator("[data-rollback]").click();
    const confirm = page.getByRole("dialog", { name: "确认回滚对话？" });
    await expect(confirm).toContainText("已修改的文件会保留");
    expect(
      fixture.requestLog.filter((r) => r.method === "thread/revert"),
    ).toHaveLength(0);
    await confirm.getByRole("button", { name: "取消", exact: true }).click();
    await expect(bubble).toBeVisible();
    await bubble.locator("[data-rollback]").click();
    await confirm
      .getByRole("button", { name: "确认回滚", exact: true })
      .click();
    await expect(bubble).toHaveCount(0);
  } finally {
    releaseSend();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
});
