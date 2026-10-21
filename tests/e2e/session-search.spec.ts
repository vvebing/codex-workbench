import { expect, test } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";

test("session search defaults to the current environment, expands scope, and finds only already loaded messages", async ({
  page,
}) => {
  const fixtures = [createMockServer(), createMockServer()];
  try {
    const urls = await Promise.all(
      fixtures.map(async (fixture) => {
        fixture.listen(0, "127.0.0.1");
        await once(fixture, "listening");
        const address = fixture.address();
        if (!address || typeof address === "string") throw Error("No listener");
        return `ws://127.0.0.1:${address.port}`;
      }),
    );
    await page.route("**/codex-release", (route) =>
      route.fulfill({ json: { version: "0.160.0" } }),
    );
    await page.addInitScript(
      (entries) => {
        localStorage.setItem("codex-environments", JSON.stringify(entries));
        localStorage.setItem("codex-active-environment", "local");
      },
      [
        {
          id: "local",
          name: "本机",
          kind: "local",
          url: urls[0],
          autoConnect: true,
        },
        {
          id: "remote",
          name: "远程测试",
          kind: "remote",
          url: urls[1],
          autoConnect: true,
        },
      ],
    );
    await page.goto("/");
    for (const fixture of fixtures)
      await expect
        .poll(() =>
          fixture.requestLog.some(
            (request) => request.method === "thread/list",
          ),
        )
        .toBe(true);

    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "搜索会话" });
    await expect(dialog.getByLabel("搜索范围", { exact: true })).toHaveValue(
      "local",
    );
    await expect(dialog.locator(".session-search-group")).toHaveCount(1);
    const search = dialog.getByPlaceholder("搜索标题、摘要或工作区…");
    const results = dialog
      .getByRole("listbox", { name: "会话搜索结果" })
      .getByRole("option");
    await search.fill("接口分页与错误处理 · 10");
    await expect(results).toHaveCount(1);
    await expect
      .poll(() =>
        fixtures[0].requestLog.some(
          (request) => request.searchTerm === "接口分页与错误处理 · 10",
        ),
      )
      .toBe(true);
    expect(fixtures[1].requestLog.some((request) => request.searchTerm)).toBe(
      false,
    );

    await dialog.getByRole("button", { name: "扩大到全部环境" }).click();
    await expect(dialog.getByLabel("搜索范围", { exact: true })).toHaveValue(
      "all",
    );
    await expect(results).toHaveCount(2);
    await expect
      .poll(() =>
        fixtures[1].requestLog.some(
          (request) => request.searchTerm === "接口分页与错误处理 · 10",
        ),
      )
      .toBe(true);
    await search.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(page.locator("[data-slot=breadcrumb] strong")).toHaveText(
      "接口分页与错误处理 · 10",
    );
    await expect(
      page
        .locator("#main [data-slot=conversation-timeline]")
        .getByText("补充边界情况和验证结果", { exact: true }),
    ).toBeVisible();

    await page.keyboard.press("Control+k");
    await expect(dialog.getByLabel("搜索范围", { exact: true })).toHaveValue(
      "local",
    );
    await expect(
      dialog.getByPlaceholder("搜索标题、摘要或工作区…"),
    ).toHaveValue("");
    await expect(results.first()).toContainText("最近访问");
    const hydrationCount = () =>
      fixtures.reduce(
        (count, fixture) =>
          count +
          fixture.requestLog.filter(
            (request) =>
              request.method === "thread/turns/list" ||
              request.method === "thread/items/list" ||
              request.method === "thread/read",
          ).length,
        0,
      );
    const before = hydrationCount();
    await dialog
      .getByPlaceholder("搜索标题、摘要或工作区…")
      .fill("补充边界情况和验证结果");
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText("已加载对话");
    await expect(results.first()).toContainText("接口分页与错误处理 · 10");
    await expect(dialog.getByText("正在搜索历史标题…")).toBeHidden();
    expect(hydrationCount()).toBe(before);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  } finally {
    await Promise.all(
      fixtures.map(
        (fixture) =>
          new Promise<void>((resolve) => fixture.close(() => resolve())),
      ),
    );
  }
});
