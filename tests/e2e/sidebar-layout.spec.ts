import { expect, test } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";

test("sidebars keep pixel preferences across resize hide reload and reset", async ({
  page,
}) => {
  const server = createMockServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No listener");
  try {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.addInitScript(() => {
      if (!localStorage.getItem("codex-environments"))
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
        );
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: "连接工作环境", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "连接与设置" });
    await dialog.getByRole("tab", { name: "工作环境", exact: true }).click();
    await dialog
      .getByLabel("App-server 地址")
      .fill(`ws://127.0.0.1:${address.port}`);
    await dialog.getByRole("button", { name: "连接", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", { name: "搜索会话" });
    await search
      .getByPlaceholder("搜索标题、摘要或工作区…")
      .fill("接口分页与错误处理 · 10");
    await page.keyboard.press("Enter");
    await expect(search).toBeHidden();
    const left = page.locator("[data-panel-id=navigation]");
    const right = page.locator("[data-panel-id=details]");
    const nearWidth = async (locator: typeof left, value: number) => {
      await expect
        .poll(async () =>
          Math.abs((await locator.boundingBox())!.width - value),
        )
        .toBeLessThan(1);
    };
    await nearWidth(left, 280);
    await page
      .getByRole("button", { name: "打开项目面板", exact: true })
      .click();
    await nearWidth(right, 320);
    await nearWidth(left, 280);
    const navHandle = page.getByRole("separator", {
      name: "调整导航宽度",
      exact: true,
    });
    await navHandle.press("ArrowRight");
    const changed = (await left.boundingBox())!.width;
    expect(changed).toBeGreaterThan(280);
    const rightHandle = page.getByRole("separator", {
      name: "调整详情宽度",
      exact: true,
    });
    const box = (await rightHandle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x - 48, box.y + 80, { steps: 5 });
    await page.mouse.up();
    const rightChanged = (await right.boundingBox())!.width;
    expect(rightChanged).toBeGreaterThan(350);
    const stored = await page.evaluate(() =>
      localStorage.getItem("codex-workbench.sidebar-widths"),
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await nearWidth(left, changed);
    await nearWidth(right, rightChanged);
    await page.setViewportSize({ width: 1024, height: 900 });
    expect(
      await page.evaluate(() =>
        localStorage.getItem("codex-workbench.sidebar-widths"),
      ),
    ).toBe(stored);
    await page.setViewportSize({ width: 1920, height: 1000 });
    await nearWidth(left, changed);
    await nearWidth(right, rightChanged);
    await page.getByRole("button", { name: "收起导航", exact: true }).click();
    await expect(left).toBeHidden();
    await nearWidth(right, rightChanged);
    await page.getByRole("button", { name: "打开导航", exact: true }).click();
    await nearWidth(left, changed);
    await nearWidth(right, rightChanged);
    await page
      .getByRole("button", { name: "关闭项目面板", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "打开项目面板", exact: true })
      .click();
    await nearWidth(right, rightChanged);
    await page.reload();
    await nearWidth(left, changed);
    await page
      .getByRole("button", { name: "打开项目面板", exact: true })
      .click();
    await nearWidth(right, rightChanged);
    await page.setViewportSize({ width: 960, height: 900 });
    await expect(
      page.getByRole("dialog", { name: "项目面板", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.locator("[data-slot=connection-entry]").click();
    await dialog.getByRole("tab", { name: "通用", exact: true }).click();
    await dialog
      .getByRole("button", { name: "重置侧栏宽度", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await nearWidth(left, 280);
    await page
      .getByRole("button", { name: "打开项目面板", exact: true })
      .click();
    await nearWidth(right, 320);
  } finally {
    await page.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
