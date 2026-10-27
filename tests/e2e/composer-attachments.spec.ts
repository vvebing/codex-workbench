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

test("local document attachments persist in the execution environment home and survive reload", async ({
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
      /^\/home\/mock-user\/\.codex-workbench\/attachments\/[^/]+\/requirements.pdf$/,
    ),
    dataBase64: Buffer.from("%PDF-demo").toString("base64"),
  });
  await page.reload();
  await expect(page.locator('[data-composer-reference="file"]')).toContainText(
    "requirements.pdf",
  );
});

test("pasted documents and images are stored under the remote user home", async ({
  page,
}) => {
  await openFirst(page);
  const editor = page.getByRole("textbox", { name: "消息输入框" });
  await editor.focus();
  await editor.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.items.add(
      new File(["pasted notes"], "notes.txt", { type: "text/plain" }),
    );
    clipboard.setData("text/plain", "caption");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.locator('[data-composer-reference="file"]')).toContainText(
    "notes.txt",
  );
  await expect(editor).toContainText("caption");
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  await editor.evaluate((element, data) => {
    const clipboard = new DataTransfer();
    const bytes = Uint8Array.from(atob(data), (character) =>
      character.charCodeAt(0),
    );
    clipboard.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png);
  await expect(page.locator('[data-slot="attachment"]')).toHaveCount(1);
  const writes = server.requestLog.filter(
    (entry) => entry.method === "fs/writeFile",
  );
  expect(writes).toHaveLength(2);
  expect(writes.map((entry) => entry.params?.path)).toEqual([
    expect.stringMatching(
      /^\/home\/mock-user\/\.codex-workbench\/attachments\/[^/]+\/notes.txt$/,
    ),
    expect.stringMatching(
      /^\/home\/mock-user\/\.codex-workbench\/attachments\/[^/]+\/pasted.png$/,
    ),
  ]);
  expect(writes[1].params?.dataBase64).toBe(png);
  expect(
    writes.every((entry) => !String(entry.params?.path).startsWith("/demo/")),
  ).toBe(true);
});

async function attachmentSettings(page: Page) {
  await page.locator("[data-settings-trigger]").click();
  const dialog = page.getByRole("dialog", { name: "连接与设置" });
  await dialog.getByRole("tab", { name: "工作环境", exact: true }).click();
  await dialog.getByRole("button", { name: "附件存储", exact: true }).click();
  return dialog;
}

test("attachment directory settings validate, persist and apply to subsequent uploads", async ({
  page,
}) => {
  await openFirst(page);
  let dialog = await attachmentSettings(page);
  const field = dialog.getByLabel("附件保存路径", { exact: true });
  await expect(field).toHaveValue("~/.codex-workbench/attachments");
  await field.fill("relative/path");
  await dialog.getByRole("button", { name: "保存路径", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("绝对路径");
  await field.fill("/custom/attachment storage/");
  await dialog.getByRole("button", { name: "保存路径", exact: true }).click();
  await expect(
    dialog.getByRole("status").filter({ hasText: "已保存" }),
  ).toBeVisible();
  await expect(field).toHaveValue("/custom/attachment storage");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page
    .locator('[data-slot="conversation-composer"] input[type="file"]')
    .setInputFiles({
      name: "custom.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("custom location"),
    });
  await expect(page.locator('[data-composer-reference="file"]')).toContainText(
    "custom.txt",
  );
  expect(
    server.requestLog.findLast((entry) => entry.method === "fs/writeFile")
      ?.params?.path,
  ).toMatch(/^\/custom\/attachment storage\/[^/]+\/custom.txt$/);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "消息输入框" })).toBeVisible();
  dialog = await attachmentSettings(page);
  await expect(dialog.getByLabel("附件保存路径", { exact: true })).toHaveValue(
    "/custom/attachment storage",
  );
  await dialog
    .getByRole("button", { name: "恢复默认路径", exact: true })
    .click();
  await expect(dialog.getByLabel("附件保存路径", { exact: true })).toHaveValue(
    "~/.codex-workbench/attachments",
  );
});

test("home relative attachment settings expand on the connected host", async ({
  page,
}) => {
  await openFirst(page);
  const dialog = await attachmentSettings(page);
  await dialog.getByLabel("附件保存路径", { exact: true }).fill("~/my uploads");
  await dialog.getByRole("button", { name: "保存路径", exact: true }).click();
  await page.keyboard.press("Escape");
  await page
    .locator('[data-slot="conversation-composer"] input[type="file"]')
    .setInputFiles({
      name: "relative.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("relative location"),
    });
  await expect(page.locator('[data-composer-reference="file"]')).toContainText(
    "relative.txt",
  );
  expect(
    server.requestLog.findLast((entry) => entry.method === "fs/writeFile")
      ?.params?.path,
  ).toMatch(/^\/home\/mock-user\/my uploads\/[^/]+\/relative.txt$/);
});
