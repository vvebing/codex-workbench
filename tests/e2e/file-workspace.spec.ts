import { expect, test, type Page } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";

let server: ReturnType<typeof createMockServer>;
let url: string;
let directoryDelay = 0;
let writeDelay = 0;
const root = "/demo/atlas-web";
const original = "# Demo project\nProject file preview.\n";

test.beforeEach(async ({ page }) => {
  directoryDelay = 0;
  writeDelay = 0;
  server = createMockServer({
    base64Files: {
      ...(test.info().title.startsWith("file list scrolls")
        ? Object.fromEntries(
            Array.from({ length: 80 }, (_, index) => [
              `${root}/scroll-file-${String(index).padStart(3, "0")}.txt`,
              "dGVzdA==",
            ]),
          )
        : {}),
      "/demo/atlas-web/screenshot.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    },
    responseDelayMs: (method) =>
      method === "fs/readDirectory"
        ? directoryDelay
        : method === "fs/writeFile"
          ? writeDelay
          : 0,
    initialGitFiles: test.info().title.startsWith("Git file actions")
      ? [
          ["src/app.ts", ".M"],
          ["package.json", "M."],
          ["new-file.txt", "??"],
          ["gone.txt", ".D"],
          ["staged-gone.txt", "D."],
        ]
      : undefined,
    mermaidAnswer:
      "[Open source](src/app.ts:2:3)\n\n`src/this-is-not-a-link.ts`",
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

async function openReadme(page: Page) {
  await openFirst(page);
  await page.getByRole("button", { name: "打开项目面板" }).click();
  const panel = page.getByRole("complementary", { name: "项目面板" });
  await panel.getByRole("button", { name: /^README\.md(?:，|$)/ }).click();
  const workspace = page.getByRole("region", { name: "文件编辑工作区" });
  await expect(workspace.locator(".monaco-editor")).toBeVisible();
  await expect(workspace.locator(".view-lines")).toContainText("Demo project");
  return { panel, workspace };
}

test("file list scrolls independently of its toolbar and retains its position across tabs", async ({
  page,
}) => {
  await openFirst(page);
  await page.getByRole("button", { name: "打开项目面板" }).click();
  const panel = page.getByRole("complementary", { name: "项目面板" });
  const files = panel.getByRole("region", { name: "项目文件" });
  const viewport = files.locator("[data-radix-scroll-area-viewport]");
  const search = files.getByRole("textbox", { name: "搜索项目文件" });
  await expect(
    files.getByRole("button", { name: /^scroll-file-079.txt/ }),
  ).toBeAttached();
  expect(
    await viewport.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  const headerY = (await search.boundingBox())!.y;
  await viewport.hover();
  await page.mouse.wheel(0, 600);
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(100);
  expect((await search.boundingBox())!.y).toBe(headerY);
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    files.getByRole("button", { name: /^scroll-file-079.txt/ }),
  ).toBeInViewport();
  const position = await viewport.evaluate((element) => element.scrollTop);
  const tabs = panel.getByRole("tablist", { name: "项目工具" });
  await tabs.getByRole("tab", { name: "Git", exact: true }).click();
  await tabs.getByRole("tab", { name: "文件", exact: true }).click();
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBe(position);
});

async function edit(page: Page, text: string) {
  const editor = page
    .getByRole("region", { name: "文件编辑工作区" })
    .locator(".monaco-editor");
  await editor.locator(".view-lines").click({ position: { x: 80, y: 10 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

test("unsaved file edits survive reload without writing to disk", async ({
  page,
}) => {
  const { workspace } = await openReadme(page);
  await edit(page, "Recovered unsaved content");
  await expect(workspace.locator(".view-lines")).toContainText(
    "Recovered unsaved content",
  );
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await page.getByRole("button", { name: /^返回文件编辑器/ }).click();
  const restored = page.getByRole("region", { name: "文件编辑工作区" });
  await expect(
    restored.getByText(
      "已从浏览器恢复未保存的编辑内容，尚未写入文件。保存前会重新核对磁盘内容。",
    ),
  ).toBeVisible();
  await expect(restored.locator(".view-lines")).toContainText(
    "Recovered unsaved content",
  );
  expect(
    server.requestLog.filter((entry) => entry.method === "fs/writeFile"),
  ).toHaveLength(0);
  await restored.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(
      () =>
        server.requestLog.filter((entry) => entry.method === "fs/writeFile")
          .length,
    )
    .toBe(1);
});

test("file discard confirmations use shared dialogs and preserve drafts when cancelled", async ({
  page,
}) => {
  const nativeDialogs: string[] = [];
  page.on("dialog", (dialog) => {
    nativeDialogs.push(dialog.type());
    void dialog.dismiss();
  });
  const { workspace } = await openReadme(page);
  await edit(page, "Unsaved confirmation draft");
  const reload = workspace.getByRole("button", {
    name: "重新加载",
    exact: true,
  });
  await reload.click();
  const confirmation = page.getByRole("dialog", {
    name: "重新加载文件",
    exact: true,
  });
  await expect(confirmation).toHaveAttribute("data-slot", "modal");
  await expect(confirmation).toContainText(`${root}/README.md`);
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(reload).toBeFocused();
  await expect(workspace.locator(".view-lines")).toContainText(
    "Unsaved confirmation draft",
  );
  await reload.click();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(workspace.locator(".view-lines")).toContainText(
    "Unsaved confirmation draft",
  );
  await reload.click();
  await confirmation
    .getByRole("button", { name: "放弃修改并重新加载", exact: true })
    .click();
  await expect(workspace.locator(".view-lines")).toContainText("Demo project");
  await edit(page, "Another unsaved draft");
  const close = workspace.getByRole("button", {
    name: `关闭 ${root}/README.md`,
    exact: true,
  });
  await close.click();
  const closing = page.getByRole("dialog", { name: "关闭文件", exact: true });
  await closing.getByRole("button", { name: "取消", exact: true }).click();
  await expect(workspace.locator(".view-lines")).toContainText(
    "Another unsaved draft",
  );
  await close.click();
  await closing
    .getByRole("button", { name: "放弃修改并关闭", exact: true })
    .click();
  await expect(workspace).toBeHidden();
  expect(nativeDialogs).toEqual([]);
  expect(server.fileText(`${root}/README.md`)).toBe(original);
  expect(
    server.requestLog.some((request) => request.method === "fs/writeFile"),
  ).toBe(false);
});

test("save-as uses the shared modal and cannot dismiss an in-flight file operation", async ({
  page,
}) => {
  const { workspace } = await openReadme(page);
  await edit(page, "Preserved file copy");
  server.setFile(`${root}/README.md`, "# External version\n");
  await expect(
    workspace.getByRole("alert").filter({ hasText: "磁盘文件已改变" }),
  ).toBeVisible();
  await workspace.getByRole("button", { name: "另存为", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "另存为新文件",
    exact: true,
  });
  await expect(dialog).toHaveAttribute("data-slot", "modal");
  await dialog.getByLabel("新文件绝对路径").fill(`${root}/preserved-copy.md`);
  writeDelay = 1000;
  await dialog.getByRole("button", { name: "创建副本", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "关闭", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(server.fileText(`${root}/preserved-copy.md`)).toBe(
    "Preserved file copy",
  );
  expect(server.fileText(`${root}/README.md`)).toBe("# External version\n");
});

test("image tabs render inline and preserve text undo history", async ({
  page,
}) => {
  const { panel, workspace } = await openReadme(page);
  await edit(page, "Changed text");
  await panel
    .getByRole("button", { name: "screenshot.png", exact: true })
    .click();
  const image = workspace.getByRole("img", {
    name: "screenshot.png",
    exact: true,
  });
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBe(1);
  await expect(workspace.locator(".monaco-editor")).toBeHidden();
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "screenshot.png", exact: true }),
  ).toHaveCount(0);
  await workspace.getByRole("tab", { name: /README.md/ }).click();
  await expect(workspace.locator(".view-lines")).toContainText("Changed text");
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.keyboard.press("ControlOrMeta+z");
    if (
      (await workspace.locator(".view-lines").innerText()).includes(
        "Demo project",
      )
    )
      break;
  }
  await expect(workspace.locator(".view-lines")).toContainText("Demo project");
  expect(
    server.requestLog.some((request) => request.method === "fs/writeFile"),
  ).toBe(false);
});

test("files open in main Monaco workspace and save back to the same host path", async ({
  page,
}) => {
  const { panel, workspace } = await openReadme(page);
  await expect(panel.locator(".monaco-editor, pre")).toHaveCount(0);
  await expect(
    workspace.getByRole("tab", { name: "README.md", exact: true }),
  ).toBeVisible();
  const text = "# Saved from Monaco\nUTF-8 中文\n";
  await edit(page, text);
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeEnabled();
  expect(server.fileText(`${root}/README.md`)).toBe(original);
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => server.fileText(`${root}/README.md`)).toBe(text);
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  expect(
    server.requestLog
      .filter((request) => request.method === "fs/writeFile")
      .at(-1)?.path,
  ).toBe(`${root}/README.md`);
});

test("external file changes preserve the editor draft and prevent silent overwrite", async ({
  page,
}) => {
  const { workspace } = await openReadme(page);
  const draft = "# My unsaved draft\n";
  await edit(page, draft);
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeEnabled();
  await expect
    .poll(() =>
      server.requestLog.some(
        (request) =>
          request.method === "fs/watch" && request.path === `${root}/README.md`,
      ),
    )
    .toBe(true);
  const external = "# Changed externally\n";
  server.setFile(`${root}/README.md`, external);
  await expect(
    workspace.getByRole("alert").filter({ hasText: "磁盘文件已改变" }),
  ).toBeVisible();
  await workspace
    .getByRole("button", { name: "比较磁盘内容", exact: true })
    .click();
  await expect(workspace.locator(".file-comparison")).toContainText(
    draft.trim(),
  );
  await expect(workspace.locator(".file-comparison")).toContainText(
    external.trim(),
  );
  await workspace.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    workspace.getByRole("alert").filter({ hasText: "磁盘文件已改变" }),
  ).toBeVisible();
  expect(server.fileText(`${root}/README.md`)).toBe(external);
  expect(
    server.requestLog.filter((request) => request.method === "fs/writeFile"),
  ).toHaveLength(0);
  await expect(
    workspace.locator(
      ".monaco-diff-editor .modified .view-lines:not(.line-delete)",
    ),
  ).toContainText("My unsaved draft");
});

test("file create copy and delete use explicit host operations and refresh the tree", async ({
  page,
}) => {
  const { panel } = await openReadme(page);
  await panel.getByRole("button", { name: "新建文件", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "新建文件", exact: true });
  await dialog.getByLabel("相对于项目根目录的路径").fill("created.txt");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => server.fileText(`${root}/created.txt`)).toBe("");
  await panel.getByRole("button", { name: "created.txt", exact: true }).click();
  await panel
    .getByRole("button", { name: "更多操作：created.txt", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "复制文件", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "复制到新路径", exact: true });
  await dialog.getByLabel("相对于项目根目录的路径").fill("copied.txt");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => server.fileText(`${root}/copied.txt`)).toBe("");
  expect(
    server.requestLog.findLast((request) => request.method === "fs/copy")
      ?.params,
  ).toEqual({
    sourcePath: `${root}/created.txt`,
    destinationPath: `${root}/copied.txt`,
    recursive: false,
  });
  await panel.getByRole("button", { name: "copied.txt", exact: true }).click();
  await panel
    .getByRole("button", { name: "更多操作：copied.txt", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "删除文件", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "永久删除", exact: true });
  expect(server.fileText(`${root}/copied.txt`)).toBe("");
  await dialog
    .getByRole("button", { name: "确认永久删除", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => server.fileText(`${root}/copied.txt`))
    .toBeUndefined();
  await expect(
    panel.getByRole("button", { name: "copied.txt", exact: true }),
  ).toHaveCount(0);
  expect(
    server.requestLog.findLast((request) => request.method === "fs/remove")
      ?.params,
  ).toEqual({ path: `${root}/copied.txt`, recursive: false, force: false });
});

test("directory creation and recursive copy or removal send explicit flags", async ({
  page,
}) => {
  const { panel } = await openReadme(page);
  await panel.getByRole("button", { name: "新建目录", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "新建目录", exact: true });
  await dialog.getByLabel("相对于项目根目录的路径").fill("created-dir");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(
    server.requestLog.findLast(
      (request) => request.method === "fs/createDirectory",
    )?.params,
  ).toEqual({ path: `${root}/created-dir`, recursive: false });
  server.setFile(`${root}/created-dir/child.txt`, "keep child\n");
  await panel.getByRole("button", { name: "created-dir", exact: true }).click();
  await panel
    .getByRole("button", { name: "更多操作：created-dir", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "复制目录", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "复制到新路径", exact: true });
  await dialog.getByLabel("相对于项目根目录的路径").fill("copied-dir");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(server.fileText(`${root}/copied-dir/child.txt`)).toBe("keep child\n");
  expect(
    server.requestLog.findLast((request) => request.method === "fs/copy")
      ?.params?.recursive,
  ).toBe(true);
  await panel.getByRole("button", { name: "copied-dir", exact: true }).click();
  await panel
    .getByRole("button", { name: "更多操作：copied-dir", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "删除目录", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "永久删除", exact: true });
  await dialog
    .getByRole("button", { name: "确认永久删除", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  expect(server.fileText(`${root}/copied-dir/child.txt`)).toBeUndefined();
  expect(server.fileText(`${root}/created-dir/child.txt`)).toBe("keep child\n");
  expect(
    server.requestLog.findLast((request) => request.method === "fs/remove")
      ?.params,
  ).toEqual({ path: `${root}/copied-dir`, recursive: true, force: false });
});

test("conversation Markdown file links open against their source thread cwd", async ({
  page,
}) => {
  server.setFile(
    `${root}/src/app.ts`,
    "// first line\nexport const source = true;\n",
  );
  await openFirst(page);
  await page
    .getByRole("textbox", { name: "消息输入框" })
    .fill("Show the source link");
  await page.locator("[data-slot=composer-action]").click();
  const link = page.getByRole("link", { name: "Open source", exact: true });
  await expect(link).toBeVisible();
  await link.click();
  const workspace = page.getByRole("region", { name: "文件编辑工作区" });
  await expect(workspace.locator(".monaco-editor")).toBeVisible();
  await expect(workspace.locator(".view-lines")).toContainText("source = true");
  await expect(workspace.locator(".file-status")).toContainText(
    "第 2 行，第 3 列",
  );
  expect(
    server.requestLog.some(
      (request) =>
        request.method === "fs/readFile" &&
        request.path === `${root}/src/app.ts`,
    ),
  ).toBe(true);
});

test("dirty file tabs survive chat and read-only Git panel switches", async ({
  page,
}) => {
  const { panel, workspace } = await openReadme(page);
  await edit(page, "unsaved across panels\n");
  await panel
    .getByRole("button", { name: "更多操作：README.md", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "引用到输入框", exact: true })
    .click();
  await workspace
    .getByRole("button", { name: "返回会话", exact: true })
    .click();
  const input = page.getByRole("textbox", { name: "消息输入框" });
  await expect(input).toContainText("README.md");
  await input
    .locator('[data-composer-reference="file"]')
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(workspace.locator(".view-lines")).toContainText(
    "unsaved across panels",
  );
  await panel.getByRole("tab", { name: "Git", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: /切换分支|暂存|提交|推送/ }),
  ).toHaveCount(0);
  expect(
    server.requestLog.some((request) => request.command?.includes("switch")),
  ).toBe(false);
  await expect(
    workspace.getByRole("tab", { name: "● README.md", exact: true }),
  ).toBeVisible();
  expect(server.fileText(`${root}/README.md`)).toBe(original);
});

test("Monaco retains BOM CRLF and undo while typing", async ({ page }) => {
  const source = "\ufeff# Demo project\r\nProject file preview.\r\n";
  server.setFile(`${root}/README.md`, source);
  const { workspace } = await openReadme(page);
  await workspace.locator(".view-lines").click({ position: { x: 80, y: 10 } });
  const bottom = await page.evaluate(() =>
    /Mac/.test(navigator.platform) ? "Meta+ArrowDown" : "Control+End",
  );
  await page.keyboard.press(bottom);
  await expect(workspace.locator(".file-status")).toContainText(
    "第 3 行，第 1 列",
  );
  await page.keyboard.type("added");
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press(bottom);
  await expect(workspace.locator(".file-status")).toContainText(
    "第 3 行，第 1 列",
  );
  await page.keyboard.type("kept");
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(() => server.fileText(`${root}/README.md`))
    .toBe(`${source}kept`);
});

test("mobile file viewing uses the main area and closes the project drawer on every open", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFirst(page);
  await page.getByRole("button", { name: "打开项目面板" }).click();
  const drawer = page.getByRole("dialog", { name: "项目面板", exact: true });
  await drawer
    .getByRole("button", { name: "更多操作：README.md", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "复制文件", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await drawer.getByRole("button", { name: "README.md", exact: true }).click();
  await expect(drawer).toBeHidden();
  const workspace = page.getByRole("region", { name: "文件编辑工作区" });
  await expect(workspace.locator(".file-readonly")).toContainText(
    "Demo project",
  );
  await expect(workspace.locator(".monaco-editor")).toHaveCount(0);
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "打开项目面板" }).click();
  await drawer.getByRole("button", { name: "README.md", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(workspace.locator(".file-readonly")).toBeVisible();
  await workspace.getByRole("button", { name: "预览", exact: true }).click();
  await expect(
    workspace.getByRole("heading", { name: "Demo project", exact: true }),
  ).toBeVisible();
  await expect(workspace.locator(".monaco-editor")).toHaveCount(0);
});

test("JSON editing loads the local language worker and supports find", async ({
  page,
}) => {
  server.setFile(`${root}/package.json`, '{"name":"workbench"}\n');
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { panel, workspace } = await openReadme(page);
  await panel.getByRole("button", { name: /^package\.json(?:，|$)/ }).click();
  await expect(workspace.locator(".file-status")).toContainText("json");
  await edit(page, '{"name": }');
  await expect(workspace.locator(".squiggly-error").first()).toBeVisible();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(
    workspace.getByRole("textbox", { name: "Find", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("Monaco async diff lifecycle survives file switches mode changes and close reopen", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const readmeBaseline =
    "# Demo project\n" +
    Array.from({ length: 120 }, (_, index) => `baseline line ${index}\n`).join(
      "",
    );
  const jsonBaseline = JSON.stringify(
    {
      name: "baseline",
      entries: Array.from({ length: 120 }, (_, index) => `entry ${index}`),
    },
    null,
    2,
  );
  server.setGitBaseline(`${root}/README.md`, readmeBaseline);
  server.setGitBaseline(`${root}/package.json`, jsonBaseline);
  server.setFile(
    `${root}/README.md`,
    readmeBaseline.replace("baseline line 0", "working line 0"),
  );
  server.setFile(
    `${root}/package.json`,
    jsonBaseline.replace('"baseline"', '"working"'),
  );
  const { panel, workspace } = await openReadme(page);
  const replaceLargeDocument = async (text: string) => {
    await workspace
      .locator(".monaco-editor")
      .click({ position: { x: 120, y: 40 } });
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await expect(workspace.locator(".view-lines")).toHaveText("");
    await page.keyboard.insertText(text);
  };
  const gutter = workspace.locator(".git-gutter-modified").first();
  await expect(gutter).toBeVisible();
  await panel.getByRole("button", { name: /^package\.json(?:，|$)/ }).click();
  await expect(gutter).toBeVisible();

  for (const revision of [1, 2, 3]) {
    await replaceLargeDocument(
      jsonBaseline.replace('"baseline"', `"draft-${revision}"`),
    );
    await workspace.getByRole("tab", { name: /README\.md$/ }).click();
    await replaceLargeDocument(
      readmeBaseline.replace("baseline line 0", `draft line ${revision}`),
    );
    await workspace
      .getByRole("button", { name: "比较未保存更改", exact: true })
      .click();
    await expect(workspace.locator(".monaco-diff-editor")).toBeVisible();
    await workspace.getByRole("tab", { name: /package\.json$/ }).click();
    await workspace
      .getByRole("button", { name: "比较未保存更改", exact: true })
      .click();
    await expect(workspace.locator(".monaco-diff-editor")).toBeVisible();
    await workspace
      .getByRole("button", { name: "返回编辑", exact: true })
      .click();
    await replaceLargeDocument(
      jsonBaseline.replace('"baseline"', `"closing-${revision}"`),
    );
    await workspace
      .getByRole("button", { name: `关闭 ${root}/package.json`, exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "关闭文件", exact: true })
      .getByRole("button", { name: "放弃修改并关闭", exact: true })
      .click();
    await expect(
      workspace.getByRole("tab", { name: /package\.json$/ }),
    ).toHaveCount(0);
    await panel.getByRole("button", { name: /^package\.json(?:，|$)/ }).click();
    await expect(workspace.locator(".file-status")).toContainText("json");
    await expect(gutter).toBeVisible();
  }

  await replaceLargeDocument('{"name": }');
  await expect(workspace.locator(".squiggly-error").first()).toBeVisible();
  const saved = '{"name":"lifecycle-survived"}\n';
  await replaceLargeDocument(saved);
  await expect(workspace.locator(".squiggly-error")).toHaveCount(0);
  await expect(gutter).toBeVisible();
  await workspace
    .getByRole("button", { name: "比较未保存更改", exact: true })
    .click();
  await expect(
    workspace.locator(".monaco-diff-editor .modified .char-insert").first(),
  ).toBeVisible();
  await workspace
    .getByRole("button", { name: "返回编辑", exact: true })
    .click();
  await expect(gutter).toBeVisible();
  await workspace.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => server.fileText(`${root}/package.json`)).toBe(saved);
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test("file tree shares a context menu without opening files and keeps creation in the toolbar", async ({
  page,
}) => {
  await openFirst(page);
  await page.getByRole("button", { name: "打开项目面板" }).click();
  const panel = page.getByRole("complementary", { name: "项目面板" });
  const readme = panel.getByRole("button", { name: "README.md", exact: true });
  await expect(readme).toBeVisible();
  const refresh = await panel
    .getByRole("button", { name: "刷新项目文件" })
    .boundingBox();
  for (const name of ["新建文件", "新建目录"]) {
    const button = await panel
      .getByRole("button", { name, exact: true })
      .boundingBox();
    expect(button!.y).toBe(refresh!.y);
  }
  await readme.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "文件操作" });
  await expect(menu).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "文件编辑工作区" }),
  ).toBeHidden();
  expect(
    server.requestLog.filter(
      (request) =>
        request.method === "fs/readFile" &&
        request.path === `${root}/README.md`,
    ),
  ).toHaveLength(0);
  await menu.getByRole("menuitem", { name: "删除文件", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "永久删除" });
  await expect(confirmation).toContainText("README.md");
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  expect(server.fileText(`${root}/README.md`)).toBe(original);
  await readme.focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(readme).toBeFocused();
  const directory = panel.getByRole("button", { name: /^src，/ });
  await directory.click({ button: "right" });
  await expect(
    menu.getByRole("menuitem", { name: "复制目录", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(directory).toHaveAttribute("aria-expanded", "false");
});

test("unsaved diff shares the draft and preserves undo across editor modes", async ({
  page,
}) => {
  const { workspace } = await openReadme(page);
  const draft = "# Draft for comparison\n";
  await edit(page, draft);
  await workspace
    .getByRole("button", { name: "比较未保存更改", exact: true })
    .click();
  const diff = workspace.locator(".monaco-diff-editor");
  await expect(diff).toBeVisible();
  await expect(diff.locator(".original .view-lines")).toContainText(
    "Demo project",
  );
  await expect(
    diff.locator(".modified .view-lines:not(.line-delete)"),
  ).toContainText("Draft for comparison");
  expect(server.fileText(`${root}/README.md`)).toBe(original);
  await diff
    .locator(".modified .view-lines:not(.line-delete)")
    .click({ position: { x: 80, y: 10 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("EditedInDiff");
  await workspace
    .getByRole("button", { name: "返回编辑", exact: true })
    .click();
  await expect(workspace.locator(".view-lines")).toContainText("EditedInDiff");
  await workspace.locator(".view-lines").click({ position: { x: 80, y: 10 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(workspace.locator(".view-lines")).toContainText(
    "Draft for comparison",
  );
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => server.fileText(`${root}/README.md`)).toBe(draft);
});

test("Markdown preview and split render the unsaved buffer without discarding undo", async ({
  page,
}) => {
  const imageRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("preview-local.png"))
      imageRequests.push(request.url());
  });
  const { workspace } = await openReadme(page);
  await edit(
    page,
    "# Live preview\n\n| Name | Value |\n| --- | --- |\n| draft | unsaved |\n\n<script>window.previewScriptRan = true</script>\n\n![Local illustration][local]\n\n[local]: ./preview-local.png\n",
  );
  await workspace.getByRole("button", { name: "预览", exact: true }).click();
  await expect(
    workspace.getByRole("heading", { name: "Live preview" }),
  ).toBeVisible();
  await expect(
    workspace.getByRole("cell", { name: "unsaved", exact: true }),
  ).toBeVisible();
  await expect(workspace.locator(".monaco-editor")).toBeHidden();
  expect(await page.evaluate(() => "previewScriptRan" in window)).toBe(false);
  await expect(
    workspace.getByRole("img", { name: "Local illustration" }),
  ).toContainText("本地图片暂不支持预览");
  expect(imageRequests).toEqual([]);
  expect(server.fileText(`${root}/README.md`)).toBe(original);
  await workspace.getByRole("button", { name: "分屏", exact: true }).click();
  await expect(workspace.locator(".monaco-editor")).toBeVisible();
  await workspace.locator(".view-lines").click({ position: { x: 80, y: 10 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("UpdatedLive");
  await expect(
    workspace
      .getByRole("region", { name: "Markdown 预览" })
      .getByText("UpdatedLive", { exact: true }),
  ).toBeVisible();
  await workspace.getByRole("button", { name: "编辑", exact: true }).click();
  await workspace.locator(".view-lines").click({ position: { x: 80, y: 10 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(workspace.locator(".view-lines")).toContainText("Live preview");
});

test("Markdown preview resolves nested file links against the Markdown directory", async ({
  page,
}) => {
  server.setFile(
    `${root}/src/guide.md`,
    "# Nested guide\n\n[Open sibling](app.ts:2:3)\n",
  );
  server.setFile(
    `${root}/src/app.ts`,
    "// first\nexport const nested = true;\n",
  );
  const { workspace } = await openReadme(page);
  await edit(page, "# Jump\n\n[Open guide](src/guide.md)\n");
  await workspace.getByRole("button", { name: "预览", exact: true }).click();
  await workspace
    .getByRole("link", { name: "Open guide", exact: true })
    .click();
  await expect(
    workspace.getByRole("tab", { name: "guide.md", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await workspace.getByRole("button", { name: "预览", exact: true }).click();
  await workspace
    .getByRole("link", { name: "Open sibling", exact: true })
    .click();
  await expect(workspace.locator(".view-lines")).toContainText("nested = true");
  await expect(workspace.locator(".file-status")).toContainText(
    "第 2 行，第 3 列",
  );
  expect(
    server.requestLog.some(
      (request) =>
        request.method === "fs/readFile" &&
        request.path === `${root}/src/app.ts`,
    ),
  ).toBe(true);
});

test("remote directory refresh keeps expanded rows mounted while a file is open", async ({
  page,
}) => {
  const { panel, workspace } = await openReadme(page);
  const folder = panel.locator('[data-file-entry="src"] > button').first();
  await folder.click();
  const child = panel.locator('[data-file-entry="src/app.ts"]');
  await expect(child).toBeVisible();
  await child.locator("button").first().click();
  await expect(
    workspace.getByRole("tab", { name: "app.ts", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await panel.evaluate((element) => {
    const tracked = [
      ...element.querySelectorAll(
        '[data-file-entry="src"], [data-file-entry="src/app.ts"], [data-file-entry="README.md"]',
      ),
    ];
    const observer = new MutationObserver(() => {
      if (tracked.some((row) => !row.isConnected))
        element.setAttribute("data-tree-detached", "true");
    });
    observer.observe(element, { childList: true, subtree: true });
  });
  directoryDelay = 1000;
  server.setFile(`${root}/src/remote-added.ts`, "export const added = true;\n");
  await expect(
    panel.locator('[data-file-entry="src/remote-added.ts"]'),
  ).toBeVisible();
  await expect(folder).toHaveAttribute("aria-expanded", "true");
  await expect(panel).not.toHaveAttribute("data-tree-detached", "true");
  await panel
    .getByRole("button", { name: "刷新项目文件", exact: true })
    .click();
  await expect(child).toBeVisible();
  await expect(panel).not.toHaveAttribute("data-tree-detached", "true");
});

test("Git diff opens in the editor separately from an unsaved working draft", async ({
  page,
}) => {
  const { panel, workspace } = await openReadme(page);
  await panel.locator('[data-file-entry="src"] > button').first().click();
  await panel
    .locator('[data-file-entry="src/app.ts"] > button')
    .first()
    .click();
  await edit(page, "unsaved app draft");
  await panel.getByRole("tab", { name: "Git", exact: true }).click();
  await panel.getByRole("button", { name: "src/app.ts", exact: true }).click();
  await expect(workspace.locator(".monaco-diff-editor")).toBeVisible();
  await expect(
    workspace.locator(
      ".monaco-diff-editor .modified .view-lines:not(.line-delete)",
    ),
  ).toContainText('app = "demo"');
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  await expect(panel.locator(".monaco-diff-editor, .git-diff")).toHaveCount(0);
  await panel
    .getByRole("button", { name: "打开当前文件：src/app.ts", exact: true })
    .click();
  await expect(workspace.locator(".view-lines")).toContainText(
    "unsaved app draft",
  );
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeEnabled();
});

test("Git file actions open working files directly and keep deleted files in diff", async ({
  page,
}) => {
  const { panel, workspace } = await openReadme(page);
  await edit(page, "unsaved README draft");
  await panel.getByRole("tab", { name: "Git", exact: true }).click();
  for (const path of ["src/app.ts", "package.json", "new-file.txt"]) {
    await panel
      .getByRole("button", { name: `打开当前文件：${path}`, exact: true })
      .click();
    await expect(workspace.locator(".monaco-editor")).toBeVisible();
    await expect(workspace.locator(".monaco-diff-editor")).toHaveCount(0);
    await expect(
      workspace.getByRole("tab", {
        name: path.split("/").at(-1)!,
        exact: true,
      }),
    ).toHaveAttribute("aria-selected", "true");
  }
  for (const path of ["gone.txt", "staged-gone.txt"]) {
    const action = panel.getByRole("button", {
      name: `打开当前文件：${path}`,
      exact: true,
    });
    await expect(action).toBeDisabled();
    await expect(action).toHaveAttribute(
      "title",
      "文件已删除，可点击文件名查看差异",
    );
  }
  await panel.getByRole("button", { name: "src/app.ts", exact: true }).click();
  await expect(workspace.locator(".monaco-diff-editor")).toBeVisible();
  await panel.getByRole("button", { name: "切换为列表视图" }).click();
  await panel
    .getByRole("button", { name: "打开当前文件：src/app.ts", exact: true })
    .click();
  await expect(workspace.locator(".monaco-diff-editor")).toHaveCount(0);
  await workspace
    .getByRole("tab", { name: "● README.md", exact: true })
    .click();
  await expect(workspace.locator(".view-lines")).toContainText(
    "unsaved README draft",
  );
  expect(
    server.requestLog.some((request) => request.method === "fs/writeFile"),
  ).toBe(false);
});

test("Git gutter marks index changes and unsaved edits, then refreshes after staging", async ({
  page,
}) => {
  const baseline =
    "# Demo project\nold line\nkeep A1\nkeep A2\nkeep A3\nkeep A4\ndelete this\nkeep B1\nkeep B2\nkeep B3\nkeep B4\n";
  server.setGitBaseline(`${root}/README.md`, baseline);
  server.setFile(
    `${root}/README.md`,
    "# Demo project\nchanged line\nkeep A1\nkeep A2\nkeep A3\nkeep A4\nkeep B1\nkeep B2\nkeep B3\nkeep B4\nadded line\n",
  );
  const { workspace, panel } = await openReadme(page);
  await expect(workspace.locator(".git-gutter-modified").first()).toBeVisible();
  await expect(workspace.locator(".git-gutter-added").first()).toBeVisible();
  await expect(workspace.locator(".git-gutter-deleted").first()).toBeVisible();
  await workspace.locator(".git-gutter-modified").first().click();
  await expect(workspace.locator(".monaco-diff-editor")).toBeVisible();
  await expect(workspace.locator(".file-comparison-labels")).toContainText(
    "Git 暂存区",
  );
  await workspace
    .getByRole("button", { name: "返回编辑", exact: true })
    .click();
  await edit(page, baseline);
  await expect(workspace.locator('[class*="git-gutter-"]')).toHaveCount(0);
  await edit(page, baseline + "unsaved\n");
  await expect(workspace.locator(".git-gutter-added").first()).toBeVisible();
  // Updating the index must not replace the editor draft.
  server.setGitBaseline(`${root}/README.md`, baseline + "unsaved\n");
  await panel
    .getByRole("button", { name: "刷新项目文件", exact: true })
    .click();
  await expect(workspace.locator('[class*="git-gutter-"]')).toHaveCount(0);
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeEnabled();
  await expect(workspace.locator(".view-lines")).toContainText("unsaved");
});

test("Git gutter handles boundary deletions and clears across files and unavailable baselines", async ({
  page,
}) => {
  server.setGitBaseline(
    `${root}/README.md`,
    "removed first\n# Demo project\nkeep 1\nkeep 2\nkeep 3\nkeep 4\nremoved last\n",
  );
  server.setFile(
    `${root}/README.md`,
    "# Demo project\nkeep 1\nkeep 2\nkeep 3\nkeep 4\n",
  );
  const { workspace, panel } = await openReadme(page);
  await expect(workspace.locator(".git-gutter-before")).toBeVisible();
  await expect(workspace.locator(".git-gutter-deleted")).toHaveCount(2);
  await panel.getByRole("button", { name: /^new-file\.txt(?:，|$)/ }).click();
  await expect(workspace.locator(".git-gutter-added").first()).toBeVisible();
  await expect(workspace.locator(".git-gutter-deleted")).toHaveCount(0);
  await panel.getByRole("button", { name: /^README\.md(?:，|$)/ }).click();
  await expect(workspace.locator(".git-gutter-deleted")).toHaveCount(2);
  server.setGitBaseline(`${root}/README.md`, "x".repeat(256 * 1024 + 1));
  await panel
    .getByRole("button", { name: "刷新项目文件", exact: true })
    .click();
  await expect(workspace.locator(".file-status")).toContainText(
    "Git 行标记不可用",
  );
  await expect(workspace.locator('[class*="git-gutter-"]')).toHaveCount(0);
  await expect(workspace.locator(".view-lines")).toContainText("Demo project");
});

test("ignored tree files and folders stay visible and usable with muted styling", async ({
  page,
}) => {
  server.setDirectory(`${root}/node_modules`);
  server.setFile(`${root}/node_modules/app.ts`, "// ignored dependency\n");
  const { panel } = await openReadme(page);
  const folder = panel.locator('[data-file-entry="node_modules"]');
  await expect(folder).toHaveAttribute("data-git-ignored", "true");
  const folderButton = folder.locator("button").first();
  await expect(folderButton).toHaveClass(/text-muted/);
  await expect(folderButton).toBeEnabled();
  await folderButton.click();
  const ignoredFile = panel.locator('[data-file-entry="node_modules/app.ts"]');
  await expect(ignoredFile).toHaveAttribute("data-git-ignored", "true");
  await ignoredFile.locator("button").first().click();
  await expect(
    page
      .getByRole("region", { name: "文件编辑工作区" })
      .getByRole("tab", { name: "app.ts", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    panel.locator('[data-file-entry="README.md"]'),
  ).not.toHaveAttribute("data-git-ignored", "true");
});

test("editor shares appearance tokens and keeps accessible icon controls", async ({
  page,
}) => {
  const { workspace } = await openReadme(page);
  // Layer order must keep Tailwind's reset below feature component rules.
  await expect(workspace.locator(".file-toolbar")).toHaveCSS(
    "padding",
    "0px 8px",
  );
  await expect(workspace.locator(".file-toolbar")).toHaveCSS(
    "border-bottom-width",
    "1px",
  );
  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await expect
      .poll(() =>
        workspace
          .locator(".monaco-editor")
          .first()
          .evaluate(
            (editor, expected) => editor.classList.contains(expected),
            theme === "dark" ? "vs-dark" : "vs",
          ),
      )
      .toBe(true);
    const background = await page.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor,
    );
    await expect(workspace.locator(".monaco-editor").first()).toHaveCSS(
      "background-color",
      background,
    );
  }
  const lines = workspace.locator(".view-lines").first();
  await expect(lines).toHaveCSS("font-size", "13px");
  await page.evaluate(() => {
    const style = document.documentElement.style;
    style.setProperty("--font-scale", "1.25");
    style.setProperty("--code-font-size", "19.5px");
    style.setProperty("--font-mono", '"Courier New", monospace');
  });
  await expect(lines).toHaveCSS("font-size", "19.5px");
  // Monaco appends its platform fallbacks after the configured font stack.
  await expect(lines).toHaveCSS("font-family", /^"Courier New", monospace/);
  // Theme/typography changes update the existing editor without discarding undo.
  // A single word is one Monaco typing undo group (spaces can split groups).
  await edit(page, "appearanceSafeDraft");
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--code-font-size", "16.25px");
  });
  await expect(lines).toHaveCSS("font-size", "16.25px");
  await expect(lines).toContainText("appearanceSafeDraft");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(lines).toContainText("Demo project");
  const modes = workspace.getByRole("group", { name: "Markdown 显示方式" });
  await expect(
    modes.getByRole("button", { name: "编辑", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await modes.getByRole("button", { name: "分屏", exact: true }).click();
  await expect(
    modes.getByRole("button", { name: "分屏", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const selected = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--selected)";
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  await expect(
    modes.getByRole("button", { name: "分屏", exact: true }),
  ).toHaveCSS("background-color", selected);
  await expect(workspace.locator(".file-markdown-preview")).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect
    .poll(() =>
      workspace
        .locator(".file-toolbar")
        .evaluate((toolbar) => toolbar.scrollWidth <= toolbar.clientWidth),
    )
    .toBe(true);
});

test("Git previews replace one temporary tab and can be pinned without replacing drafts", async ({
  page,
}) => {
  const { panel, workspace } = await openReadme(page);
  await edit(page, "preview-safe draft");
  await panel.getByRole("tab", { name: "Git", exact: true }).click();
  const openDiff = (path: string) =>
    panel.getByRole("button", { name: path, exact: true }).click();
  await openDiff("src/app.ts");
  await expect(workspace.getByRole("tab")).toHaveCount(2);
  await expect(workspace.getByRole("tab", { name: /app.ts/ })).toHaveClass(
    /is-preview/,
  );
  await openDiff("package.json");
  await expect(workspace.getByRole("tab")).toHaveCount(2);
  await expect(workspace.getByRole("tab", { name: /app.ts/ })).toHaveCount(0);
  await workspace.getByRole("button", { name: "固定当前标签" }).click();
  await openDiff("new-file.txt");
  await expect(workspace.getByRole("tab")).toHaveCount(3);
  await workspace.getByRole("tab", { name: /new-file.txt/ }).dblclick();
  await expect(
    workspace.getByRole("button", { name: "固定当前标签" }),
  ).toHaveCount(0);
  await openDiff("src/app.ts");
  await expect(workspace.getByRole("tab")).toHaveCount(4);
  await workspace
    .getByRole("tab", { name: "● README.md", exact: true })
    .click();
  await expect(workspace.locator(".view-lines")).toContainText(
    "preview-safe draft",
  );
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeEnabled();
});

test("wide editor splits from chat and preserves scroll draft and undo across layouts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  const { workspace } = await openReadme(page);
  await page
    .getByRole("button", { name: "关闭项目面板", exact: true })
    .first()
    .click();
  const layout = page.locator(".conversation-workspace");
  const chat = page.getByRole("region", { name: "会话内容", exact: true });
  await expect(layout).toHaveAttribute("data-layout", "split");
  await expect(chat).toBeVisible();
  const composer = page.getByRole("textbox", { name: "消息输入框" });
  await composer.fill("conversation draft");
  await edit(page, "layout-safe draft");
  await workspace.locator(".monaco-editor").evaluate((editor) => {
    editor.setAttribute("data-mount-witness", "same");
  });
  const handle = page.getByRole("separator", {
    name: "调整会话与编辑器宽度",
    exact: true,
  });
  const before = (await chat.boundingBox())!.width;
  expect(
    Math.abs(before - (await workspace.boundingBox())!.width),
  ).toBeLessThan(3);
  await handle.press("ArrowRight");
  await expect
    .poll(async () => (await chat.boundingBox())!.width)
    .toBeGreaterThan(before);
  const after = (await chat.boundingBox())!.width;
  const content = chat.locator("[data-slot=conversation-content]");
  const composerBox = chat.locator("[data-slot=conversation-composer]");
  // Wide panes keep a readable text measure while sharing the available space.
  const contentWidth = (await content.boundingBox())!.width;
  expect(contentWidth).toBeLessThanOrEqual(after);
  expect((await composerBox.boundingBox())!.width).toBeCloseTo(contentWidth, 0);
  expect(await chat.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  const timeline = chat.locator(
    '[data-slot="conversation-timeline"] > [data-radix-scroll-area-viewport]',
  );
  // Only user scroll intent pauses automatic following, not programmatic scroll.
  await timeline.hover();
  await page.mouse.wheel(0, -10000);
  await expect
    .poll(() => timeline.evaluate((element) => element.scrollTop))
    .toBe(0);
  await workspace
    .getByRole("button", { name: "专注编辑", exact: true })
    .click();
  await expect(chat).toBeHidden();
  await expect(layout).toHaveAttribute("data-layout", "editor");
  await workspace
    .getByRole("button", { name: "并排查看会话", exact: true })
    .click();
  await expect(layout).toHaveAttribute("data-layout", "split");
  await expect(composer).toHaveText("conversation draft");
  await expect
    .poll(() => timeline.evaluate((element) => element.scrollTop))
    .toBe(0);
  await expect
    .poll(async () => Math.abs((await chat.boundingBox())!.width - after))
    .toBeLessThan(3);
  await expect(workspace.locator(".monaco-editor")).toHaveAttribute(
    "data-mount-witness",
    "same",
  );
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(layout).toHaveAttribute("data-layout", "editor");
  await expect(chat).toBeHidden();
  await page.setViewportSize({ width: 1920, height: 1000 });
  await expect(layout).toHaveAttribute("data-layout", "split");
  await workspace.locator(".view-lines").click({ position: { x: 80, y: 10 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(workspace.locator(".view-lines")).not.toContainText(
    "layout-safe draft",
  );
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(workspace.locator(".view-lines")).toContainText(
    "layout-safe draft",
  );
  await workspace
    .getByRole("button", { name: "返回会话", exact: true })
    .click();
  await expect(layout).toHaveAttribute("data-layout", "conversation");
  await expect(workspace).toBeHidden();
  await page.getByRole("button", { name: /返回文件编辑器/ }).click();
  await expect(workspace.locator(".view-lines")).toContainText(
    "layout-safe draft",
  );
  await expect(composer).toHaveText("conversation draft");
});

async function selectWorkspaceSession(page: Page, title: string) {
  // Monaco reserves Ctrl+K on Linux/Windows while the editor has focus.
  await page.getByRole("button", { name: /^搜索会话/ }).click();
  const search = page.getByRole("dialog", { name: "搜索会话" });
  await search.getByPlaceholder("搜索标题、摘要或工作区…").fill(title);
  await search.getByRole("option").filter({ hasText: title }).first().click();
  await expect(search).toBeHidden();
  await expect(page.locator("#main")).toHaveAttribute("aria-label", title);
}

test("same-project editor keeps its DOM, unsaved draft and undo when cwd fallback matches", async ({
  page,
}) => {
  const { workspace } = await openReadme(page);
  const editor = workspace.locator(".monaco-editor");
  const originalEditor = await editor.elementHandle();
  await edit(page, "same-project unsaved draft");
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeEnabled();
  await selectWorkspaceSession(page, "审批流程演示 · 4");
  await expect(workspace).toBeVisible();
  expect(await originalEditor!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(workspace.locator(".view-lines")).toContainText(
    "same-project unsaved draft",
  );
  await workspace.locator(".view-lines").click({ position: { x: 80, y: 10 } });
  let undoSteps = 0;
  while (undoSteps < 4) {
    await page.keyboard.press("ControlOrMeta+z");
    undoSteps++;
    if (
      (await workspace.locator(".view-lines").innerText()).includes(
        "Demo project",
      )
    )
      break;
  }
  await expect(workspace.locator(".view-lines")).toContainText("Demo project");
  for (let step = 0; step < undoSteps; step++)
    await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(workspace.locator(".view-lines")).toContainText(
    "same-project unsaved draft",
  );
  await selectWorkspaceSession(page, "工作区导航与搜索 · 1");
  await expect(workspace).toBeVisible();
  expect(await originalEditor!.evaluate((node) => node.isConnected)).toBe(true);
  expect(server.fileText(`${root}/README.md`)).toBe(original);
  expect(
    server.requestLog.some((request) => request.method === "fs/writeFile"),
  ).toBe(false);
});

test("same-project editor remains visible across different cwd values with a canonical project", async ({
  page,
}) => {
  server.setProject("mock-thread-001", "shared-project");
  server.setProject("mock-thread-002", "shared-project");
  const { workspace } = await openReadme(page);
  const originalEditor = await workspace
    .locator(".monaco-editor")
    .elementHandle();
  await edit(page, "canonical project draft");
  await selectWorkspaceSession(page, "设计令牌与暗色模式 · 2");
  await expect(workspace).toBeVisible();
  expect(await originalEditor!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(workspace.locator(".view-lines")).toContainText(
    "canonical project draft",
  );
  await expect(
    workspace.getByRole("tab", { name: "● README.md", exact: true }),
  ).toBeVisible();
});

test("cross-project selection hides the editor even when cwd is identical", async ({
  page,
}) => {
  server.setProject("mock-thread-001", "project-a");
  server.setProject("mock-thread-004", "project-b");
  const { workspace } = await openReadme(page);
  await edit(page, "cross-project retained draft");
  await selectWorkspaceSession(page, "审批流程演示 · 4");
  await expect(workspace).toBeHidden();
  await expect(
    page.getByRole("button", { name: /返回文件编辑器/ }),
  ).toBeVisible();
  expect(server.fileText(`${root}/README.md`)).toBe(original);
});

test("same-project navigation preserves an explicitly hidden editor", async ({
  page,
}) => {
  const { workspace } = await openReadme(page);
  await workspace
    .getByRole("button", { name: "返回会话", exact: true })
    .click();
  await expect(workspace).toBeHidden();
  await selectWorkspaceSession(page, "审批流程演示 · 4");
  await expect(workspace).toBeHidden();
  await expect(
    page.getByRole("button", { name: /返回文件编辑器/ }),
  ).toBeVisible();
  await selectWorkspaceSession(page, "工作区导航与搜索 · 1");
  await expect(workspace).toBeHidden();
});

test("file selection remembers the creation directory across panel tabs", async ({
  page,
}) => {
  const { panel } = await openReadme(page);
  const src = panel.getByRole("button", { name: /^src(?:，|$)/ });
  await src.click();
  await expect(src).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("tab", { name: "Git", exact: true }).click();
  await panel.getByRole("tab", { name: "文件", exact: true }).click();
  await expect(src).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "新建文件", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "新建文件", exact: true });
  await expect(dialog.getByLabel("相对于项目根目录的路径")).toHaveValue("src/");
  await dialog.getByLabel("相对于项目根目录的路径").fill("src/selected.txt");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => server.fileText(`${root}/src/selected.txt`)).toBe("");
  await expect(
    panel.getByRole("button", { name: "src/selected.txt", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "新建目录", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "新建目录", exact: true });
  await expect(dialog.getByLabel("相对于项目根目录的路径")).toHaveValue("src/");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await panel.getByRole("button", { name: "选择项目根目录" }).click();
  await panel.getByRole("button", { name: "新建文件", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "新建文件", exact: true });
  await expect(dialog.getByLabel("相对于项目根目录的路径")).toHaveValue("");
});

test("split remembers user ratio and supports keyboard reset to equal widths", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("codex-workbench-editor-ratio", "65"),
  );
  await page.setViewportSize({ width: 1920, height: 1000 });
  const { workspace } = await openReadme(page);
  await page
    .getByRole("button", { name: "关闭项目面板", exact: true })
    .first()
    .click();
  const chat = page.getByRole("region", { name: "会话内容", exact: true });
  const handle = page.getByRole("separator", {
    name: "调整会话与编辑器宽度",
    exact: true,
  });
  await expect
    .poll(
      async () =>
        (await chat.boundingBox())!.width /
        ((await chat.boundingBox())!.width +
          (await workspace.boundingBox())!.width),
    )
    .toBeCloseTo(0.65, 2);
  await handle.press("Enter");
  await expect
    .poll(async () =>
      Math.abs(
        (await chat.boundingBox())!.width -
          (await workspace.boundingBox())!.width,
      ),
    )
    .toBeLessThan(3);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(localStorage.getItem("codex-workbench-editor-ratio")),
      ),
    )
    .toBeCloseTo(50, 1);
});

test("project files upload, keep both names, reference and download binary bytes", async ({
  page,
}) => {
  await openFirst(page);
  await page.getByRole("button", { name: "打开项目面板" }).click();
  const panel = page.getByRole("complementary", { name: "项目面板" });
  const files = panel.getByRole("region", { name: "项目文件" });
  const input = files.getByLabel("选择上传文件");
  const bytes = Buffer.from([0, 255, 128, 10]);
  await input.setInputFiles([
    { name: "sample.bin", mimeType: "application/octet-stream", buffer: bytes },
  ]);
  await expect(
    files.getByRole("button", { name: /^sample.bin/ }),
  ).toBeVisible();
  await input.setInputFiles([
    { name: "sample.bin", mimeType: "application/octet-stream", buffer: bytes },
  ]);
  const conflict = page.getByRole("dialog", { name: "文件已存在" });
  await conflict.getByRole("button", { name: "保留两者" }).click();
  await expect(
    files.getByRole("button", { name: /^sample \(1\).bin/ }),
  ).toBeVisible();
  await files.getByRole("button", { name: "添加上传文件到会话" }).click();
  await expect(page.getByRole("textbox", { name: "消息输入框" })).toContainText(
    "sample (1).bin",
  );
  await files
    .getByRole("button", { name: /^sample.bin/ })
    .click({ button: "right" });
  const downloaded = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "下载文件" }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("sample.bin");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks)).toEqual(bytes);
});

test("editor reveals filtered project file and adds selected code to conversation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  const { workspace } = await openReadme(page);
  const panel = page.getByRole("complementary", { name: "项目面板" });
  await panel.getByPlaceholder("搜索文件…").fill("unrelated");
  await page
    .getByRole("button", { name: "关闭项目面板", exact: true })
    .first()
    .click();
  await workspace
    .getByRole("button", { name: "在文件列表中显示", exact: true })
    .click();
  await expect(panel).toBeVisible();
  await expect(panel.getByPlaceholder("搜索文件…")).toHaveValue("");
  await expect(panel.locator('[data-file-entry="README.md"]')).toHaveAttribute(
    "data-selected",
    "true",
  );
  await workspace.locator(".view-lines").click({ position: { x: 80, y: 10 } });
  await page.keyboard.press("ControlOrMeta+a");
  await workspace
    .getByRole("button", { name: "添加选中代码到会话", exact: true })
    .click();
  const composer = page.getByRole("textbox", { name: "消息输入框" });
  await expect(composer).toContainText("Demo project");
  await expect(composer).toContainText("README.md");
});

test("dirty file download distinguishes disk version from saved editor changes", async ({
  page,
}) => {
  const { panel, workspace } = await openReadme(page);
  await edit(page, "download current draft");
  await panel
    .getByRole("button", { name: /^README\.md(?:，|$)/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "下载文件", exact: true }).click();
  let dialog = page.getByRole("dialog", {
    name: "文件有未保存修改",
    exact: true,
  });
  const diskEvent = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "下载已保存版本", exact: true })
    .click();
  const disk = await diskEvent;
  const diskChunks: Buffer[] = [];
  for await (const chunk of await disk.createReadStream())
    diskChunks.push(Buffer.from(chunk));
  expect(Buffer.concat(diskChunks).toString()).toBe(original);
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeEnabled();
  await panel
    .getByRole("button", { name: /^README\.md(?:，|$)/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "下载文件", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "文件有未保存修改", exact: true });
  const savedEvent = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "保存并下载", exact: true }).click();
  const saved = await savedEvent;
  const savedChunks: Buffer[] = [];
  for await (const chunk of await saved.createReadStream())
    savedChunks.push(Buffer.from(chunk));
  expect(Buffer.concat(savedChunks).toString()).toBe("download current draft");
  expect(server.fileText(`${root}/README.md`)).toBe("download current draft");
});

test("project files upload via directory drop and drag references into composer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  const { panel } = await openReadme(page);
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(["drop content"], "dropped.txt", { type: "text/plain" }),
    );
    return data;
  });
  const directory = panel.locator('[data-file-entry="src"]');
  await directory.dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(panel).toContainText("释放以上传到：src");
  await directory.dispatchEvent("drop", { dataTransfer: transfer });
  await expect
    .poll(() => server.fileText(`${root}/src/dropped.txt`))
    .toBe("drop content");
  const row = panel.locator('[data-file-entry="src/dropped.txt"]');
  await expect(row).toBeVisible();
  const composer = page.locator('[data-slot="conversation-composer"]');
  const fileTransfer = await page.evaluateHandle(() => new DataTransfer());
  await row.dispatchEvent("dragstart", { dataTransfer: fileTransfer });
  await composer
    .locator("form")
    .dispatchEvent("drop", { dataTransfer: fileTransfer });
  await expect(
    composer.locator('[data-composer-reference="file"]'),
  ).toContainText("src/dropped.txt");
  expect(
    server.requestLog.filter((entry) => entry.method === "fs/writeFile"),
  ).toHaveLength(1);
});
