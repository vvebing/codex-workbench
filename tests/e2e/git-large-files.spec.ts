import { expect, test, type Page } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";
let server: ReturnType<typeof createMockServer>;
let url: string;
const root = "/demo/atlas-web";
const oid = "a".repeat(40);
const body = ("x".repeat(126) + "\n").repeat(8300);
const original = `INDEX VERSION\n${body}`;
const modified = `WORKTREE VERSION\n${body}`;

test.beforeEach(async ({ page }) => {
  server = createMockServer({
    initialGitFiles: [["large.txt", ".M"]],
    base64Files: {
      [`${root}/large.txt`]: Buffer.from(modified).toString("base64"),
    },
    commandExec: ({ command }) => {
      if (command.includes("--verify") && command.at(-1) === ":large.txt")
        return { stdout: `${oid}\n` };
      if (command.includes("cat-file") && command.at(-1) === oid) {
        if (command.includes("-s"))
          return {
            stdout: `${test.info().title.includes("above eight MB") ? 8 * 1024 * 1024 + 1 : Buffer.byteLength(original)}\n`,
          };
        return { stdout: original };
      }
      return undefined;
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing listener");
  url = `ws://127.0.0.1:${address.port}`;
  await page.addInitScript(
    (configuredDiffBytes) => {
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
              fileLimits: {
                normalBytes: 1048576,
                editableBytes: 5242880,
                viewBytes: 8388608,
                diffBytes: configuredDiffBytes,
              },
            },
          ]),
        );
    },
    test.info().title.includes("configured one MB") ? 1048576 : 8388608,
  );
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

async function openGitDiff(page: Page) {
  await openFirst(page);
  await page.getByRole("button", { name: "打开项目面板" }).click();
  const panel = page.getByRole("complementary", { name: "项目面板" });
  await panel.getByRole("tab", { name: "Git", exact: true }).click();
  await panel.getByRole("button", { name: "large.txt", exact: true }).click();
  return page.getByRole("region", { name: "文件编辑工作区" });
}

test("Git diff streams files above one MB without the former 256KB limit", async ({
  page,
}) => {
  const workspace = await openGitDiff(page);
  await expect(workspace.locator(".monaco-diff-editor")).toBeVisible();
  await expect(workspace.locator(".monaco-diff-editor")).toContainText(
    "INDEX VERSION",
  );
  await expect(workspace.locator(".monaco-diff-editor")).toContainText(
    "WORKTREE VERSION",
  );
  await expect(
    workspace.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  const blobs = server.requestLog.filter(
    (entry) =>
      entry.method === "command/exec" &&
      (entry.params?.command as string[] | undefined)?.includes("blob"),
  );
  expect(blobs.length).toBeGreaterThan(0);
  expect(blobs[0].params).toMatchObject({
    streamStdoutStderr: true,
    outputBytesCap: 8 * 1024 * 1024 + 1,
  });
  expect(
    server.requestLog.filter((entry) => entry.method === "fs/writeFile"),
  ).toHaveLength(0);
});

test("Git diff rejects blobs above eight MB before reading content", async ({
  page,
}) => {
  const workspace = await openGitDiff(page);
  await expect(
    workspace.getByText(/Git 差异的每个版本最多 8 MB/),
  ).toBeVisible();
  await expect(workspace.locator(".monaco-diff-editor")).toBeHidden();
  expect(
    server.requestLog.filter(
      (entry) =>
        entry.method === "command/exec" &&
        (entry.params?.command as string[] | undefined)?.includes("blob"),
    ),
  ).toHaveLength(0);
});

test("Git diff honors the configured one MB limit for each revision", async ({
  page,
}) => {
  const workspace = await openGitDiff(page);
  await expect(
    workspace.getByText(/Git 差异的每个版本最多 1 MB/),
  ).toBeVisible();
  await expect(workspace.locator(".monaco-diff-editor")).toBeHidden();
  expect(
    server.requestLog.filter(
      (entry) =>
        entry.method === "command/exec" &&
        (entry.params?.command as string[] | undefined)?.includes("blob"),
    ),
  ).toHaveLength(0);
});
