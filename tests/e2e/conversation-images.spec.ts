import { expect, test } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
let server: ReturnType<typeof createMockServer>;

test.beforeEach(async ({ page }) => {
  server = createMockServer({
    initialImageMessage: {
      input: [
        { type: "image", url: `data:image/png;base64,${png}` },
        { type: "image", url: "https://images.example.test/remote.png" },
        { type: "localImage", path: "/demo/atlas-web/screenshot.png" },
        { type: "localImage", path: "/demo/atlas-web/missing.png" },
        { type: "image", url: "https://images.example.test/broken.png" },
      ],
      answer:
        "![设计截图](https://images.example.test/remote.png)\n\n[![带链接图片](https://images.example.test/remote.png)](https://example.com/reference)",
    },
    base64Files: { "/demo/atlas-web/screenshot.png": png },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture address");
  await page.addInitScript(
    (url) =>
      localStorage.setItem(
        "codex-environments",
        JSON.stringify([
          { id: "local", name: "本机", kind: "local", url, autoConnect: false },
        ]),
      ),
    `ws://127.0.0.1:${address.port}`,
  );
  await page.route("https://images.example.test/**", (route) =>
    route.request().url().endsWith("broken.png")
      ? route.fulfill({ status: 404 })
      : route.fulfill({
          contentType: "image/png",
          body: Buffer.from(png, "base64"),
        }),
  );
});
test.afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

for (const width of [1440, 390]) {
  test(`conversation images ${width}px are compact and preview with keyboard focus restored`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "连接工作环境", exact: true })
      .click();
    const settings = page.getByRole("dialog", { name: "连接与设置" });
    await settings.getByRole("tab", { name: "工作环境", exact: true }).click();
    await settings.getByRole("button", { name: "连接", exact: true }).click();
    await expect(settings).toBeHidden();
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", { name: "搜索会话" });
    await search
      .getByPlaceholder("搜索标题、摘要或工作区…")
      .fill("工作区导航与搜索 · 1");
    await page.keyboard.press("Enter");
    await expect(search).toBeHidden();
    const turn = page.locator('[data-slot="conversation-turn"]').first();
    for (const name of [
      "对话附件 1",
      "对话附件 2",
      "screenshot.png",
      "设计截图",
    ]) {
      const trigger = turn.getByRole("button", {
        name: `预览图片 ${name}`,
        exact: true,
      });
      await expect(trigger).toBeVisible();
      await trigger.scrollIntoViewIfNeeded();
      const thumb = trigger.getByRole("img", { name, exact: true });
      await expect
        .poll(() =>
          thumb.evaluate((image) => (image as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
      const box = (await thumb.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(132);
      expect(box.height).toBeLessThanOrEqual(100);
      await trigger.focus();
      await trigger.press("Enter");
      const viewer = page.getByRole("dialog", { name, exact: true });
      await expect(
        viewer.getByRole("img", { name, exact: true }),
      ).toBeVisible();
      const bounds = (await viewer.boundingBox())!;
      expect(bounds.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await expect(viewer).toBeHidden();
      await expect(trigger).toBeFocused();
    }
    await expect(
      turn.getByRole("button", {
        name: "重新加载图片 missing.png",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      turn.getByRole("button", { name: "预览图片 对话附件 5", exact: true }),
    ).toContainText("图片无法加载");
    await expect(
      turn.locator('a[href="https://example.com/reference"] button'),
    ).toHaveCount(0);
    const retries = server.requestLog.filter(
      (request) =>
        request.method === "fs/readFile" &&
        request.path?.endsWith("/missing.png"),
    ).length;
    await turn
      .getByRole("button", { name: "重新加载图片 missing.png", exact: true })
      .click();
    await expect
      .poll(
        () =>
          server.requestLog.filter(
            (request) =>
              request.method === "fs/readFile" &&
              request.path?.endsWith("/missing.png"),
          ).length,
      )
      .toBeGreaterThan(retries);
    await turn
      .getByRole("button", { name: "预览图片 对话附件 5", exact: true })
      .click();
    const failedViewer = page.getByRole("dialog", {
      name: "对话附件 5",
      exact: true,
    });
    await expect(failedViewer.getByRole("status")).toContainText(
      "图片无法加载",
    );
    await page.keyboard.press("Escape");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    expect(
      server.requestLog.some((request) => request.method === "fs/writeFile"),
    ).toBe(false);
  });
}
