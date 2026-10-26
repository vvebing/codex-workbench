import { expect, test, type Page } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";
let server: ReturnType<typeof createMockServer>;
let url: string;
const root = "/demo/atlas-web";
const MB = 1024 * 1024;
// Keep individual lines and line count modest: this exercises byte size limits.
const payloadLine = "x".repeat(127) + "\n";
const largeText = payloadLine.repeat(8193);
const readonlyMarkdown = "# Large markdown\n" + payloadLine.repeat(40961);

test.beforeEach(async ({ page }) => {
  server = createMockServer({
    base64Files: {
      [`${root}/large.txt`]: Buffer.from(largeText).toString("base64"),
      [`${root}/readonly.md`]: Buffer.from(readonlyMarkdown).toString("base64"),
      [`${root}/too-large.txt`]: Buffer.alloc(8 * MB + 1, 97).toString(
        "base64",
      ),
    },
  });
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

async function openFile(page: Page, name: string) {
  await openFirst(page);
  await page.getByRole("button", { name: "打开项目面板" }).click();
  const panel = page.getByRole("complementary", { name: "项目面板" });
  await panel.getByRole("button", { name, exact: true }).click();
  return page.getByRole("region", { name: "文件编辑工作区" });
}

test("large editable files simplify rendering and recover unsaved edits before saving", async ({
  page,
}) => {
  const workspace = await openFile(page, "large.txt");
  await expect(workspace.getByText(/大文件简化模式/)).toBeVisible();
  await expect(workspace.locator(".monaco-editor")).toBeVisible();
  await expect(
    workspace.getByRole("button", { name: "比较未保存更改", exact: true }),
  ).toBeHidden();
  await workspace.locator(".view-lines").click({ position: { x: 80, y: 10 } });
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.insertText("RECOVERED-LARGE-FILE\n");
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeEnabled();
  await expect(workspace.locator(".view-lines")).toContainText(
    "RECOVERED-LARGE-FILE",
  );
  expect(server.fileText(`${root}/large.txt`)).toBe(largeText);
  await expect(
    workspace.getByText(
      "\u5927\u6587\u4ef6\u8349\u7a3f\u5df2\u4fdd\u5b58\u5230\u6d4f\u89c8\u5668",
      { exact: true },
    ),
  ).toBeVisible();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await page.getByRole("button", { name: /^返回文件编辑器/ }).click();
  await expect(
    workspace.getByText(/已从浏览器恢复未保存的编辑内容/),
  ).toBeVisible();
  await expect(workspace.locator(".view-lines")).toContainText(
    "RECOVERED-LARGE-FILE",
  );
  expect(
    server.requestLog.filter((entry) => entry.method === "fs/writeFile"),
  ).toHaveLength(0);
  await workspace.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(() => server.fileText(`${root}/large.txt`))
    .toBe(`RECOVERED-LARGE-FILE\n${largeText}`);
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  await workspace
    .getByRole("button", { name: "重新加载", exact: true })
    .click();
  await expect(workspace.locator(".view-lines")).toContainText(
    "RECOVERED-LARGE-FILE",
  );
});

test("markdown above five MB opens readonly without preview or diff controls", async ({
  page,
}) => {
  const workspace = await openFile(page, "readonly.md");
  await expect(workspace.getByText(/大文件只读模式/)).toBeVisible();
  await expect(
    workspace.getByText(/文件超过 5 MB，仅支持查看和下载/),
  ).toBeVisible();
  await expect(
    workspace.getByRole("group", { name: "Markdown 显示方式" }),
  ).toBeHidden();
  await expect(
    workspace.getByRole("button", { name: "比较未保存更改", exact: true }),
  ).toBeHidden();
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  await expect(workspace.locator(".view-lines")).toContainText(
    "Large markdown",
  );
  await workspace.locator(".monaco-editor textarea").focus();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.insertText("SHOULD-NOT-EDIT");
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  expect(server.fileText(`${root}/readonly.md`)).toBe(readonlyMarkdown);
  expect(
    server.requestLog.filter((entry) => entry.method === "fs/writeFile"),
  ).toHaveLength(0);
});

test("files above eight MB are rejected without rendering a partial editor", async ({
  page,
}) => {
  const workspace = await openFile(page, "too-large.txt");
  await expect(workspace.getByText(/8 MB/)).toBeVisible();
  await expect(workspace.locator(".monaco-editor")).toBeHidden();
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  expect(
    server.requestLog.filter((entry) => entry.method === "fs/writeFile"),
  ).toHaveLength(0);
});

test("small markdown retains preview and editing modes", async ({ page }) => {
  const workspace = await openFile(page, "README.md");
  await expect(
    workspace.getByRole("group", { name: "Markdown 显示方式" }),
  ).toBeVisible();
  await expect(
    workspace.getByText(/大文件简化模式|大文件只读模式/),
  ).toBeHidden();
  await workspace.getByRole("button", { name: "预览", exact: true }).click();
  await expect(
    workspace.getByRole("heading", { name: "Demo project" }),
  ).toBeVisible();
  await workspace.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(workspace.locator(".monaco-editor")).toBeVisible();
});
