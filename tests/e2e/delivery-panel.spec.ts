import { expect, test } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";

test("turn changes stay hidden until a diff arrives and export a scoped patch", async ({
  page,
}) => {
  const fixture = createMockServer();
  fixture.listen(0, "127.0.0.1");
  await once(fixture, "listening");
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("No listener");
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
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", { name: "搜索会话" });
    await search
      .getByPlaceholder("搜索标题、摘要或工作区…")
      .fill("工作区导航与搜索 · 1");
    await page.keyboard.press("Enter");
    await expect(search).toBeHidden();
    await expect
      .poll(() =>
        fixture.requestLog.some((request) => request.method === "thread/read"),
      )
      .toBe(true);
    await expect(page.locator('[data-slot="turn-results"]')).toHaveCount(0);
    const request = fixture.requestLog.find(
      (request) => request.method === "thread/read",
    );
    const threadId = request?.threadId as string;
    expect(threadId).toBeTruthy();
    fixture.publish({
      method: "turn/completed",
      params: {
        threadId,
        turn: {
          id: "changes",
          items: [],
          itemsView: "full",
          status: "completed",
          rootTurnId: null,
          error: null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
        },
      },
    });
    fixture.publish({
      method: "turn/diff/updated",
      params: {
        threadId,
        turnId: "changes",
        diff: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n+new\n",
      },
    });
    const panel = page.locator('[data-slot="turn-results"]');
    await panel.getByRole("button", { name: /本轮变更 ·/ }).click();
    await expect(
      panel.getByRole("button", { name: "a.ts", exact: true }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "本轮变更操作", exact: true })
      .click();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "导出本轮补丁" }).click();
    expect((await download).suggestedFilename()).toBe("turn-changes.patch");
  } finally {
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
});
