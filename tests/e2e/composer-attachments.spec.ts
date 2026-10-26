import { expect, test, type Page } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";
let server: ReturnType<typeof createMockServer>;
let url: string;
test.beforeEach(async ({ page }) => {
  server = createMockServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing listener");
  url = `ws://127.0.0.1:${address.port}`;
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
});
test.afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
async function openFirst(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "连接工作环境", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "连接与设置" });
  await dialog.getByRole("tab", { name: "工作环境", exact: true }).click();
  await dialog.getByLabel("App-server 地址").fill(url);
  await dialog.getByRole("button", { name: "连接", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "搜索会话" });
  await search
    .getByPlaceholder("搜索标题、摘要或工作区…")
    .fill("工作区导航与搜索 · 1");
  await page.keyboard.press("Enter");
  await expect(search).toBeHidden();
  await expect(
    page.locator("[data-slot=conversation-turn]").first(),
  ).toBeAttached();
}

test("local document attachments persist as project file references and survive reload", async ({
  page,
}) => {
  await openFirst(page);
  const composer = page.locator('[data-slot="conversation-composer"]');
  await expect(composer).not.toContainText("文件附件保存到项目");
  await composer.locator('input[type="file"]').setInputFiles({
    name: "requirements.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-demo"),
  });
  await expect(
    composer.locator('[data-composer-reference="file"]'),
  ).toContainText("requirements.pdf");
  const writes = server.requestLog.filter(
    (entry) => entry.method === "fs/writeFile",
  );
  expect(writes).toHaveLength(1);
  expect(writes[0].params).toMatchObject({
    path: expect.stringMatching(
      /^\/demo\/atlas-web\/\.codex-workbench\/attachments\/[^/]+\/requirements.pdf$/,
    ),
    dataBase64: Buffer.from("%PDF-demo").toString("base64"),
  });
  await page.reload();
  await expect(page.locator('[data-composer-reference="file"]')).toContainText(
    "requirements.pdf",
  );
});
