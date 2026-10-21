import { expect, test, type Page } from "@playwright/test";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createMockServer } from "../fixtures/app-server";

async function openOriginalThread(page: Page) {
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "搜索会话" });
  await search
    .getByPlaceholder("搜索标题、摘要或工作区…")
    .fill("工作区导航与搜索 · 1");
  await page.keyboard.press("Enter");
  await expect(search).toBeHidden();
}

for (const sandboxMode of ["workspace-write", "danger-full-access"] as const) {
  test(`Git tools stay read-only in ${sandboxMode}, export patches and select an existing worktree`, async ({
    page,
  }) => {
    const patch = "diff --git a/a.txt b/a.txt\n+fixture change\n";
    const fixture = createMockServer({
      sandboxMode,
      initialGitFiles: [["a.txt", "M."]],
      commandExec: ({ command }) => {
        if (command.includes("worktree") && command.includes("list"))
          return {
            stdout:
              "worktree /demo/atlas-web\0HEAD abc\0branch refs/heads/main\0\0worktree /demo/existing-worktree\0HEAD def\0detached\0\0",
          };
        if (command.includes("diff") && command.includes("--binary"))
          return { stdout: patch };
      },
    });
    fixture.listen(0, "127.0.0.1");
    await once(fixture, "listening");
    const address = fixture.address();
    if (!address || typeof address === "string")
      throw new Error("Missing listener");
    try {
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
          fixture.requestLog.some(
            (request) => request.method === "thread/list",
          ),
        )
        .toBe(true);
      await openOriginalThread(page);
      const toggle = page.getByRole("button", {
        name: "打开项目面板",
        exact: true,
      });
      if (await toggle.isVisible()) await toggle.click();
      const panel = page.getByRole("complementary", { name: "项目面板" });
      await panel.getByRole("tab", { name: "Git", exact: true }).click();
      const tools = panel.getByRole("region", { name: "Git 只读工具" });
      await expect(tools).toBeVisible();
      const forbidden =
        /^(暂存所选|取消暂存所选|预览提交|确认提交|提交|推送|确认推送当前分支|创建 worktree|创建工作树|确认创建草稿 PR|重新检查 Git 权限)$/;
      await expect(panel.getByRole("button", { name: forbidden })).toHaveCount(
        0,
      );
      await expect(
        panel.getByRole("textbox", { name: /提交说明|PR 标题|新 worktree/ }),
      ).toHaveCount(0);

      // Other settings may read config globally; the Git tools themselves need no permission probe.
      const beforeTools = fixture.requestLog.length;
      for (const [label, filename] of [
        ["导出未暂存补丁", "working-tree.patch"],
        ["导出已暂存补丁", "staged.patch"],
      ]) {
        await tools
          .getByRole("button", { name: "Git 工具", exact: true })
          .click();
        await expect(
          page.getByRole("menu", { name: "Git 工具" }).getByRole("menuitem"),
        ).toHaveCount(3);
        const downloading = page.waitForEvent("download");
        await page.getByRole("menuitem", { name: label, exact: true }).click();
        const download = await downloading;
        expect(download.suggestedFilename()).toBe(filename);
        const path = await download.path();
        expect(path).not.toBeNull();
        expect(await readFile(path!, "utf8")).toBe(patch);
      }
      await tools
        .getByRole("button", { name: "Git 工具", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "选择已有工作树", exact: true })
        .click();
      const existing = tools.getByRole("button", {
        name: "/demo/existing-worktree",
        exact: true,
      });
      await expect(existing).toBeVisible();
      expect(
        fixture.requestLog
          .slice(beforeTools)
          .filter((request) => request.method === "config/read"),
      ).toHaveLength(0);
      const commands = fixture.requestLog
        .slice(beforeTools)
        .filter((request) => request.method === "command/exec");
      expect(
        commands.some((request) => request.command?.includes("--cached")),
      ).toBe(true);
      expect(
        commands.every((request) => request.sandboxPolicy?.type === "readOnly"),
      ).toBe(true);
      expect(
        commands.some((request) =>
          request.command?.some((arg) =>
            [
              "add",
              "restore",
              "commit",
              "push",
              "create",
              "fetch",
              "ls-remote",
            ].includes(arg),
          ),
        ),
      ).toBe(false);

      await existing.click();
      const dialog = page.getByRole("dialog", {
        name: "新建会话",
        exact: true,
      });
      await expect(dialog.getByLabel("工作目录", { exact: true })).toHaveValue(
        "/demo/existing-worktree",
      );
      await dialog
        .getByRole("button", { name: "创建会话", exact: true })
        .click();
      await expect(dialog).toBeHidden();
      if (await toggle.isVisible()) await toggle.click();
      await panel.getByRole("tab", { name: "Git", exact: true }).click();
      const beforeNewExport = fixture.requestLog.length;
      await tools
        .getByRole("button", { name: "Git 工具", exact: true })
        .click();
      const newDownloading = page.waitForEvent("download");
      await page
        .getByRole("menuitem", { name: "导出未暂存补丁", exact: true })
        .click();
      await newDownloading;
      expect(
        fixture.requestLog
          .slice(beforeNewExport)
          .find((request) => request.command?.includes("--binary"))?.cwd,
      ).toBe("/demo/existing-worktree");
      // Switching back must retain the original session's directory.
      await openOriginalThread(page);
      if (await toggle.isVisible()) await toggle.click();
      await panel.getByRole("tab", { name: "Git", exact: true }).click();
      const beforeExport = fixture.requestLog.length;
      await tools
        .getByRole("button", { name: "Git 工具", exact: true })
        .click();
      const downloading = page.waitForEvent("download");
      await page
        .getByRole("menuitem", { name: "导出未暂存补丁", exact: true })
        .click();
      await downloading;
      const exported = fixture.requestLog
        .slice(beforeExport)
        .find((request) => request.command?.includes("--binary"));
      expect(exported?.cwd).toBe("/demo/atlas-web");
    } finally {
      await new Promise<void>((resolve) => fixture.close(() => resolve()));
    }
  });
}
