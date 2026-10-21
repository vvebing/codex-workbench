import { expect, test, type Page } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";

let server: ReturnType<typeof createMockServer>;
let url: string;
let grepAvailable = true;
let progressive = false;
let grepCalls = 0;
const source =
  "// Search fixture\nexport const literal = 'Needle.*';\nexport const lower = 'needle.*';\n";

test.beforeEach(async ({ page }) => {
  grepAvailable = true;
  progressive = false;
  grepCalls = 0;
  server = createMockServer({
    responseDelayMs: (method) =>
      progressive && method === "command/exec" && grepCalls === 2 ? 2000 : 0,
    commandExec: ({ command }) => {
      if (
        command[0] === "git" &&
        command.includes("ls-files") &&
        command.includes("--cached") &&
        command.includes("--others")
      )
        return {
          stdout: progressive
            ? [
                "src/app.ts",
                ...Array.from(
                  { length: 64 },
                  (_, index) => `src/extra-${index}.ts`,
                ),
              ].join("\0") + "\0"
            : "src/app.ts\0",
        };
      if (command[0] !== "grep") return undefined;
      grepCalls++;
      if (progressive && grepCalls > 1) return { stdout: "", exitCode: 1 };
      if (!grepAvailable)
        return { stdout: "", stderr: "grep: command not found", exitCode: 127 };
      const query = command[command.indexOf("-e") + 1];
      const sensitive = !command.includes("-i");
      const rows = source.split("\n").flatMap((line, index) => {
        const text = sensitive ? line : line.toLowerCase();
        const needle = sensitive ? query : query.toLowerCase();
        return text.includes(needle)
          ? [`./src/app.ts\0${index + 1}:${line}\n`]
          : [];
      });
      return { stdout: rows.join(""), exitCode: rows.length ? 0 : 1 };
    },
  });
  server.setFile("/demo/atlas-web/src/app.ts", source);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing listener");
  url = `ws://127.0.0.1:${address.port}`;
  await page.addInitScript(() => {
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

async function openProject(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "连接工作环境", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "连接与设置" });
  await settings.getByRole("tab", { name: "工作环境", exact: true }).click();
  await settings.getByLabel("App-server 地址").fill(url);
  await settings.getByRole("button", { name: "连接", exact: true }).click();
  await expect(settings).toBeHidden();
  await page.keyboard.press("Control+k");
  const sessions = page.getByRole("dialog", { name: "搜索会话" });
  await sessions
    .getByPlaceholder("搜索标题、摘要或工作区…")
    .fill("工作区导航与搜索 · 1");
  await page.keyboard.press("Enter");
  await expect(sessions).toBeHidden();
  await expect(
    page.locator("[data-slot=conversation-turn]").first(),
  ).toBeAttached();
}

test("quick open finds project files by keyboard and remembers opened files", async ({
  page,
}) => {
  await openProject(page);
  await page.keyboard.press("ControlOrMeta+p");
  const dialog = page.getByRole("dialog", { name: "快速打开文件" });
  const input = dialog.getByRole("combobox", { name: "快速打开文件" });
  await expect(input).toBeFocused();
  await input.fill("app:2:8");
  await expect(
    dialog.getByRole("option", { name: "src/app.ts", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("option", { name: /node_modules|app.log/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  const editor = page.getByRole("region", { name: "文件编辑工作区" });
  await expect(editor.locator(".view-lines")).toContainText("Needle.*");
  await expect(editor).toContainText("第 2 行，第 8 列");
  // The shortcut must also override Monaco's shortcut while the editor is focused.
  await editor.locator(".view-lines").click({ position: { x: 80, y: 10 } });
  await page.keyboard.press("ControlOrMeta+p");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("");
  await expect(
    dialog.getByRole("option", { name: "src/app.ts", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("content search uses literal text, groups matches and opens the matching position", async ({
  page,
}) => {
  await openProject(page);
  await page.keyboard.press("ControlOrMeta+Shift+f");
  const search = page.getByRole("region", { name: "项目内容搜索" });
  const input = search.getByRole("textbox", { name: "搜索文件内容" });
  await expect(input).toBeFocused();
  await input.fill("Needle.*");
  await input.press("Enter");
  await expect(search.getByRole("status")).toContainText(
    "2 个匹配行，位于 1 个文件中",
  );
  const panel = page.getByRole("complementary", { name: "项目面板" });
  await panel.getByRole("tab", { name: "文件", exact: true }).click();
  await expect(search).toBeHidden();
  await panel.getByRole("tab", { name: "搜索", exact: true }).click();
  await expect(input).toHaveValue("Needle.*");
  await expect(search.getByRole("status")).toContainText(
    "2 个匹配行，位于 1 个文件中",
  );
  const group = search.getByRole("button", {
    name: "src/app.ts 2",
    exact: true,
  });
  await group.click();
  await expect(
    search.getByRole("button", { name: /src\/app.ts，第 2 行/ }),
  ).toBeHidden();
  await group.click();
  await search.getByRole("button", { name: /src\/app.ts，第 2 行/ }).click();
  const editor = page.getByRole("region", { name: "文件编辑工作区" });
  await expect(editor.locator(".view-lines")).toContainText("Needle.*");
  await expect(editor).toContainText("第 2 行，第 25 列");
  await page.keyboard.press("ControlOrMeta+Shift+f");
  await expect(input).toBeFocused();
  await search.getByRole("button", { name: "区分大小写", exact: true }).click();
  await expect(search.getByRole("status")).toContainText("搜索条件已更改");
  await input.press("Enter");
  await expect(search.getByRole("status")).toContainText(
    "1 个匹配行，位于 1 个文件中",
  );
  await input.fill("absent literal");
  await input.press("Enter");
  await expect(search.getByRole("status")).toContainText(
    "0 个匹配行，位于 0 个文件中",
  );
});

test("content search works when the host does not provide grep", async ({
  page,
}) => {
  grepAvailable = false;
  await openProject(page);
  await page.getByRole("button", { name: "搜索文件内容", exact: true }).click();
  const search = page.getByRole("region", { name: "项目内容搜索" });
  await search.getByRole("textbox", { name: "搜索文件内容" }).fill("Needle.*");
  await search.getByRole("button", { name: "搜索内容", exact: true }).click();
  await expect(search.getByRole("status")).toContainText(
    "2 个匹配行，位于 1 个文件中",
  );
  await expect(
    search.getByRole("button", { name: /src\/app.ts，第 3 行/ }),
  ).toBeVisible();
  expect(
    server.requestLog.some(
      (entry) =>
        entry.method === "fs/readFile" &&
        entry.path === "/demo/atlas-web/src/app.ts",
    ),
  ).toBe(true);
});

test("narrow workspace keeps search actions and results accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProject(page);
  const action = page.getByRole("button", {
    name: "搜索文件内容",
    exact: true,
  });
  await expect(action).toBeVisible();
  await action.click();
  const search = page.getByRole("region", { name: "项目内容搜索" });
  const input = search.getByRole("textbox", { name: "搜索文件内容" });
  await expect(input).toBeVisible();
  await input.fill("Needle.*");
  await input.press("Enter");
  await expect(search.getByRole("status")).toContainText(
    "2 个匹配行，位于 1 个文件中",
  );
  await expect(
    search.getByRole("button", { name: /src\/app.ts，第 2 行/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("content search shows matching files while later batches are still running", async ({
  page,
}) => {
  progressive = true;
  await openProject(page);
  await page.keyboard.press("ControlOrMeta+Shift+f");
  const search = page.getByRole("region", { name: "项目内容搜索" });
  const input = search.getByRole("textbox", { name: "搜索文件内容" });
  await input.fill("Needle.*");
  await input.press("Enter");
  await expect(search.getByRole("status")).toContainText(
    "正在搜索…已找到 2 个匹配行，位于 1 个文件中",
  );
  await expect(
    search.getByRole("button", { name: /src\/app.ts，第 2 行/ }),
  ).toBeVisible();
  await expect(
    search.getByRole("button", { name: "取消内容搜索", exact: true }),
  ).toBeVisible();
  await expect(
    search.getByRole("button", { name: "搜索内容", exact: true }),
  ).toBeVisible();
  await expect(search.getByRole("status")).toContainText(
    "2 个匹配行，位于 1 个文件中",
  );
  expect(grepCalls).toBe(2);
});
