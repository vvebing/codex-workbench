import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";

let fixtureServer: ReturnType<typeof createMockServer>;
let fixtureUrl: string;
let resumeMermaidStream: () => void;
let resumeBackgroundStream: (() => void) | undefined;
test.beforeEach(async ({ page }) => {
  await page.route("**/codex-release", (route) =>
    route.fulfill({ json: { version: "0.160.0" } }),
  );
  resumeBackgroundStream = undefined;
  const streamGate = test.info().title.startsWith("mermaid rendering")
    ? new Promise<void>((resolve) => {
        resumeMermaidStream = resolve;
      })
    : test.info().title.startsWith("background completion")
      ? new Promise<void>((resolve) => {
          resumeBackgroundStream = resolve;
        })
      : test.info().title.startsWith("running work accepts steering")
        ? new Promise<void>(() => {})
        : undefined;
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
  fixtureServer = createMockServer(
    test.info().title.startsWith("local draft")
      ? {
          rejectEmptyThreadRead: true,
          failThreadStartOnce: test.info().title.includes("creation failure"),
          failFirstTurnOnce: test.info().title.includes("send failure"),
          responseDelayMs: test.info().title.includes("slow creation")
            ? (method: string) => (method === "thread/start" ? 800 : 0)
            : 0,
        }
      : test.info().title.startsWith("archived groups")
        ? { initiallyArchived: 65, sameNamedWorkspaces: true }
        : test.info().title.startsWith("composer follows session")
          ? { modelDefaultReasoningEffort: "low" }
          : test.info().title.startsWith("external activity")
            ? { externalActivity: true }
            : test.info().title.startsWith("external writer")
              ? {
                  externalWriter: true,
                  externalAsyncQuestion: test
                    .info()
                    .title.includes("async question"),
                }
              : test.info().title.startsWith("sidebar running state")
                ? { staleActiveAfterCompletion: true }
                : {
                    gitStatus: test
                      .info()
                      .title.startsWith("topbar branch changes")
                      ? (cwd: string) => {
                          const changed = fixtureServer.requestLog.some(
                            (request) => request.method === "turn/start",
                          );
                          const current = cwd === "/demo/atlas-web";
                          const count = current ? (changed ? 5 : 3) : 0;
                          return (
                            `# branch.head demo/${current ? "actual" : "other"}\0` +
                            Array.from(
                              { length: count },
                              (_, index) => `? example-${index}.txt\0`,
                            ).join("")
                          );
                        }
                      : undefined,
                    gitStatusExitCode: test
                      .info()
                      .title.startsWith("topbar unavailable Git")
                      ? 128
                      : undefined,
                    initialActiveOperations: test
                      .info()
                      .title.startsWith("initial operation history"),
                    paginatedHistory: test
                      .info()
                      .title.startsWith("revert restores"),
                    mermaidAnswer: test
                      .info()
                      .title.startsWith("mermaid rendering")
                      ? "```mermaid\nflowchart LR\n  A[开始] --> B[检查用户输入与会话状态]\n  B --> C{是否需要用户确认}\n  C -->|是| D[等待回答]\n  C -->|否| E[执行任务]\n  D --> E\n  E --> F[完成]\n```"
                      : undefined,
                    subagentSessions: test
                      .info()
                      .title.startsWith("subagent completion"),
                    responseDelayMs: test
                      .info()
                      .title.startsWith("workspace actions")
                      ? (method: string) =>
                          method === "thread/read" ? 1000 : 0
                      : test.info().title.startsWith("submission persists")
                        ? (method: string) =>
                            method === "turn/start" ? 4000 : 0
                        : 0,
                    externalUnloadedHistory: test
                      .info()
                      .title.startsWith("external unloaded history"),
                    externalPartialHistory: test
                      .info()
                      .title.startsWith("external partial history"),
                    imageInput: test
                      .info()
                      .title.startsWith("rich composer images"),
                    streamGate,
                    streamIntervalMs: test
                      .info()
                      .title.startsWith("message queue supports")
                      ? 300
                      : test.info().title.startsWith("message queue")
                        ? 120
                        : undefined,
                  },
  );
  fixtureServer.listen(0, "127.0.0.1");
  await once(fixtureServer, "listening");
  const address = fixtureServer.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test listener");
  fixtureUrl = `ws://127.0.0.1:${address.port}`;
});
test.afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    fixtureServer.close((error) => (error ? reject(error) : resolve())),
  );
});

const input = (page: Page) => page.getByRole("textbox", { name: "消息输入框" });
async function themeColor(page: Page, token: string) {
  return page.evaluate((token) => {
    const probe = document.createElement("span");
    probe.style.color = `var(--${token})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}
async function environmentScope(page: Page, name: string) {
  const dialog = page.getByRole("dialog", { name: "连接与设置" });
  await dialog.getByRole("tab", { name: "工作环境", exact: true }).click();
  await dialog.getByRole("button", { name, exact: true }).click();
  return dialog;
}
async function connect(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "连接工作环境", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "连接与设置" });
  await dialog.getByRole("tab", { name: "工作环境", exact: true }).click();
  await expect(dialog.getByLabel("App-server 地址")).toHaveValue(
    "ws://127.0.0.1:4501",
  );
  await dialog.getByLabel("App-server 地址").fill(fixtureUrl);
  await dialog.getByRole("button", { name: "连接", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "开始新会话", exact: true }),
  ).toBeVisible();
}
async function openFirst(page: Page) {
  await connect(page);
  const title = test.info().title;
  const target = title.startsWith("IME")
    ? "设计令牌与暗色模式 · 2"
    : title.startsWith("draft")
      ? "接口分页与错误处理 · 3"
      : title.startsWith("model")
        ? "审批流程演示 · 4"
        : title.startsWith("command")
          ? "用户问题演示 · 5"
          : title.startsWith("questions")
            ? "失败恢复演示 · 6"
            : title.startsWith("running")
              ? "断线恢复演示 · 7"
              : title.startsWith("failure")
                ? "工作区导航与搜索 · 8"
                : title.startsWith("execution")
                  ? "设计令牌与暗色模式 · 9"
                  : "接口分页与错误处理 · 10";
  await page.keyboard.press("Control+k");
  const searchDialog = page.getByRole("dialog", { name: "搜索会话" });
  await searchDialog.getByPlaceholder("搜索标题、摘要或工作区…").fill(target);
  await searchDialog
    .getByRole("option")
    .filter({ has: page.getByText(target, { exact: true }) })
    .click();
  await expect(searchDialog).toBeHidden();
  await expect(input(page)).toBeVisible();
  await expect(
    page.locator("[data-slot=conversation-turn]").first(),
  ).toBeAttached();
}
async function send(page: Page, text: string) {
  await input(page).fill(text);
  await page.locator("[data-slot=composer-action]").click();
}
async function completed(page: Page) {
  await expect(
    page
      .locator("[data-slot=conversation-turn]")
      .last()
      .locator("[data-slot=conversation-turn-footer]"),
  ).toContainText("已完成");
  await expect(
    page.getByRole("status").filter({ hasText: "准备就绪" }),
  ).toBeVisible();
}
async function menu(page: Page, name: string) {
  await page
    .locator("[data-slot=topbar]")
    .getByRole("button", { name: /会话操作：/ })
    .click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

test("connect form validates endpoint and keeps token out of persistent browser storage", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "连接工作环境", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "连接与设置" });
  await dialog.getByRole("tab", { name: "工作环境", exact: true }).click();
  await dialog.getByLabel("App-server 地址").fill("https://example.invalid");
  await dialog.getByRole("button", { name: "连接", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("ws://");
  await dialog.getByLabel("App-server 地址").fill(fixtureUrl);
  await dialog.getByLabel(/Bearer Token/).fill("fictional-test-token");
  await dialog.getByRole("button", { name: "连接", exact: true }).click();
  await expect(dialog).toBeHidden();
  const stored = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(stored).not.toContain("fictional-test-token");
});

test("connection automatically announces newer releases and restores the notice after reconnect", async ({
  page,
}) => {
  await page.route("**/codex-release", (route) =>
    route.fulfill({ json: { version: "0.161.0" } }),
  );
  await openFirst(page);
  const notice = page.locator("[data-slot=app-server-update]");
  await expect(notice).toContainText("0.160.0 → 0.161.0");
  await notice.getByRole("button", { name: "关闭更新提示" }).click();
  await expect(notice).toHaveCount(0);
  await page.locator("[data-slot=connection-entry]").click();
  const dialog = page.getByRole("dialog", { name: "连接与设置" });
  await dialog.getByRole("tab", { name: "工作环境", exact: true }).click();
  await dialog.getByRole("button", { name: "断开连接", exact: true }).click();
  await dialog.getByRole("button", { name: "连接", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(notice).toBeVisible();
});

test("old web backend HTML falls back to public releases while the connection stays usable", async ({
  page,
}) => {
  await page.route("**/codex-release", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html></html>",
    }),
  );
  await page.route(
    "https://api.github.com/repos/openai/codex/releases/latest",
    (route) =>
      route.fulfill({
        json: { tag_name: "rust-v0.161.0", prerelease: false, draft: false },
      }),
  );
  await openFirst(page);
  await expect(page.locator("[data-slot=app-server-update]")).toContainText(
    "0.161.0",
  );
  await expect(input(page)).toBeEditable();
});

test("connection version checks stable releases and recovers from failure without disconnecting", async ({
  page,
}) => {
  await openFirst(page);
  await expect(page.locator("[data-slot=app-server-update]")).toHaveCount(0);
  await page.locator("[data-slot=connection-entry]").click();
  const dialog = page.getByRole("dialog", { name: "连接与设置" });
  await dialog.getByRole("tab", { name: "工作环境", exact: true }).click();
  const version = dialog.locator("[data-slot=app-server-version]");
  await expect(version).toContainText("0.160.0");
  await page.route("**/codex-release", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await version.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(version).toContainText("检查更新失败");
  await expect(page.locator("[data-slot=app-server-update]")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "断开连接", exact: true }),
  ).toBeVisible();
  await page.route("**/codex-release", (route) =>
    route.fulfill({ json: { version: "0.161.0" } }),
  );
  await version.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(version).toContainText("发现新版本 0.161.0");
  await expect(
    version.getByRole("link", { name: "查看发布说明" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/openai/codex/releases/tag/rust-v0.161.0",
  );
  await page.route("**/codex-release", (route) =>
    route.fulfill({ json: { version: "0.160.0" } }),
  );
  await version.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(version).toContainText("未发现更新的稳定版本");
  await dialog.getByRole("button", { name: "断开连接", exact: true }).click();
  await expect(version).toHaveCount(0);
});

test("conversation defaults to comfortable prose and width preference persists", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await openFirst(page);
  const content = page.locator("[data-slot=conversation-content]");
  const composer = page.locator("[data-slot=conversation-composer]");
  expect((await content.boundingBox())!.width).toBeCloseTo(
    (await composer.boundingBox())!.width,
    0,
  );
  await expect(content).toHaveCSS("width", "928px");
  const prose = content
    .locator("article:not([data-prompt-id]) > .markdown-content > p")
    .first();
  // The timeline reserves 56px on the right for the prompt directory, plus 24px on the left.
  expect((await prose.boundingBox())!.width).toBeCloseTo(
    (await content.boundingBox())!.width - 80,
    0,
  );
  await input(page).fill("width preference draft");
  const chooseWidth = async (name: string) => {
    await page.locator("[data-slot=connection-entry]").click();
    const dialog = page.getByRole("dialog", { name: "连接与设置" });
    await dialog.getByRole("tab", { name: "通用", exact: true }).click();
    await dialog
      .getByRole("combobox", { name: "会话宽度", exact: true })
      .click();
    await page.getByRole("option", { name, exact: true }).click();
    await page.keyboard.press("Escape");
  };
  await chooseWidth("宽");
  await expect(content).toHaveCSS("width", "1128px");
  await expect(composer).toHaveCSS("width", "1128px");
  expect((await prose.boundingBox())!.width).toBeCloseTo(
    (await content.boundingBox())!.width - 80,
    0,
  );
  await expect(input(page)).toHaveText("width preference draft");
  await page.reload();
  await expect(content).toHaveCSS("width", "1128px");
  await chooseWidth("铺满");
  await expect
    .poll(async () => (await content.boundingBox())!.width)
    .toBeGreaterThan(1128);
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(content).toHaveCSS("padding-left", "12px");
  await expect(composer).toHaveCSS("padding-left", "12px");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("connection settings reuse a connected environment and retain its selected history", async ({
  page,
}) => {
  await openFirst(page);
  const initializations = fixtureServer.requestLog.filter(
    (request) => request.method === "initialize",
  ).length;
  const turn = await page
    .locator("#main [data-slot=conversation-turn]")
    .first()
    .elementHandle();
  await input(page).fill("保留当前草稿");
  await page.locator("[data-slot=connection-entry]").click();
  const dialog = page.getByRole("dialog", { name: "连接与设置" });
  await dialog.getByRole("tab", { name: "工作环境", exact: true }).click();
  await dialog.getByRole("button", { name: "使用此连接", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(input(page)).toHaveText("保留当前草稿");
  expect(await turn!.evaluate((node) => node.isConnected)).toBe(true);
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "initialize",
    ),
  ).toHaveLength(initializations);
});

test("automatically loads all 90 summaries and keyboard search opens hydrated history", async ({
  page,
}) => {
  await connect(page);
  await expect(page.locator("[data-slot=thread-row]")).toHaveCount(15);
  await page.getByRole("button", { name: "折叠全部项目", exact: true }).click();
  await expect(page.locator("[data-slot=thread-row]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "加载下一页会话" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "展开全部项目", exact: true }).click();
  await expect(page.locator("[data-slot=thread-row]")).toHaveCount(15);
  for (const more of await page
    .locator('[data-slot="project-history-toggle"]')
    .all())
    await more.click();
  await expect(page.locator("[data-slot=thread-row]")).toHaveCount(90);
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "搜索会话" });
  await expect(dialog).toContainText("在当前范围查找会话");
  await expect(dialog.getByRole("listbox").getByRole("option")).toHaveCount(8);
  const search = dialog.getByPlaceholder("搜索标题、摘要或工作区…");
  await expect(search).toBeFocused();
  await search.fill("工作区导航与搜索 · 1");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-slot=conversation-turn]")).toHaveCount(2);
  await expect(
    page.locator("[data-slot=markdown] table").first(),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("creates, renames, forks a session and archives its branch", async ({
  page,
}) => {
  await connect(page);
  await page.getByRole("button", { name: /^新建会话/ }).click();
  let dialog = page.getByRole("dialog", { name: "新建会话" });
  await dialog.getByLabel("工作目录").fill("/demo/atlas-web");
  await dialog.getByRole("button", { name: "创建会话" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-slot=conversation-empty]")).toContainText(
    "写下你的任务",
  );
  await menu(page, "重命名");
  dialog = page.getByRole("dialog", { name: "重命名会话" });
  await dialog.getByLabel("会话标题").fill("验收新会话");
  await dialog.getByRole("button", { name: "确认" }).click();
  await expect(page.locator("[data-slot=breadcrumb] strong")).toHaveText(
    "验收新会话",
  );
  await send(page, "请给出完整实施结果");
  await completed(page);
  await send(page, "继续补充边界条件");
  await expect(
    page.locator("[data-slot=conversation-turn]").last(),
  ).toContainText("继续补充边界条件");
  await completed(page);
  await expect(page.getByRole("button", { name: "从此轮分支" })).toHaveCount(0);
  await menu(page, "分叉会话");
  await expect(page.locator("[data-slot=breadcrumb] strong")).toHaveText(
    "验收新会话 · 分支",
  );
  await expect(page.locator("[data-slot=conversation-turn]")).toHaveCount(2);
  await menu(page, "归档");
  await expect(page.locator("[data-slot=archived-conversation]")).toContainText(
    "此会话已归档",
  );
  await expect(input(page)).toHaveCount(0);
  await expect(
    page
      .locator("[data-slot=thread-link]")
      .filter({ hasText: "验收新会话 · 分支" }),
  ).toHaveCount(0);
});

test("IME Enter does not send; Shift Enter inserts newline and normal Enter sends once", async ({
  page,
}) => {
  await openFirst(page);
  const editor = input(page);
  const originalTurns = await page
    .locator("[data-slot=conversation-turn]")
    .count();
  await editor.fill("中文输入");
  await editor.dispatchEvent("compositionstart");
  await editor.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
    keyCode: 229,
  });
  await expect(page.locator("[data-slot=conversation-turn]")).toHaveCount(
    originalTurns,
  );
  await expect(editor).toHaveText("中文输入");
  await editor.dispatchEvent("compositionend");
  await editor.press("Shift+Enter");
  await editor.press("x");
  await expect.poll(() => editor.innerText()).toBe("中文输入\nx");
  await editor.press("Enter");
  await completed(page);
  await expect(page.locator("[data-slot=conversation-turn]")).toHaveCount(
    originalTurns + 1,
  );
  await expect(editor).toHaveText("");
});

test("draft edits survive a delayed real RPC response and drafts remain isolated by conversation", async ({
  page,
}) => {
  // Delay delivery of an actual bridge response; all requests still reach the standalone mock.
  await page.addInitScript(() => {
    const original = WebSocket.prototype.send;
    const ids = new Set<string>();
    const delayed = new WeakSet<Event>();
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string") {
        try {
          const frame = JSON.parse(data);
          if (frame.method === "turn/start") ids.add(String(frame.id));
        } catch {
          /* non-RPC frame */
        }
      }
      return original.call(this, data);
    };
    const Native = window.WebSocket;
    window.WebSocket = new Proxy(Native, {
      construct(Target, args) {
        const socket = new Target(...(args as [string, string[]?]));
        socket.addEventListener(
          "message",
          (event) => {
            if (delayed.has(event)) return;
            try {
              const frame = JSON.parse(String(event.data));
              if (ids.delete(String(frame.id))) {
                event.stopImmediatePropagation();
                const copy = new MessageEvent("message", { data: event.data });
                delayed.add(copy);
                setTimeout(() => socket.dispatchEvent(copy), 350);
              }
            } catch {
              /* passthrough */
            }
          },
          true,
        );
        return socket;
      },
    });
  });
  await openFirst(page);
  await send(page, "请完善任务");
  await input(page).fill("下一条草稿");
  await expect(page.getByRole("button", { name: "正在提交" })).toBeHidden();
  await expect(input(page)).toHaveText("下一条草稿");
  await completed(page);
  const originalTitle = await page
    .locator("[data-slot=breadcrumb] strong")
    .innerText();
  await page
    .locator("[data-slot=thread-link]:not([aria-current=page])")
    .first()
    .click();
  await expect(input(page)).toHaveText("");
  await input(page).fill("另一个会话的草稿");
  await page
    .locator("[data-slot=thread-link]")
    .filter({ hasText: originalTitle })
    .first()
    .click();
  await expect(input(page)).toHaveText("下一条草稿");
});

test("submission persists when switching away and back before acknowledgement", async ({
  page,
}) => {
  const frames = recordComposerFrames(page);
  await openFirst(page);
  const title = await page.locator("[data-slot=breadcrumb] strong").innerText();
  await send(page, "后台提交");
  await expect(page.getByRole("button", { name: "正在提交" })).toBeVisible();
  await input(page).fill("保留下一条");
  await page
    .locator("[data-slot=thread-link]:not([aria-current=page])")
    .first()
    .click();
  await page
    .locator("[data-slot=thread-link]")
    .filter({ hasText: title })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "正在提交" })).toBeDisabled();
  await expect(input(page)).toHaveText("保留下一条");
  await input(page).press("Enter");
  await expect(page.getByRole("button", { name: "正在提交" })).toBeHidden();
  await expect(input(page)).toHaveText("保留下一条");
  expect(frames.filter((frame) => frame.method === "turn/start")).toHaveLength(
    1,
  );
  expect(frames.filter((frame) => frame.method === "turn/steer")).toHaveLength(
    0,
  );
});

test("model and policy controls work and invalid attachments remain unsent", async ({
  page,
}) => {
  const frames: { method?: string; params?: Record<string, unknown> }[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      try {
        frames.push(JSON.parse(String(frame.payload)));
      } catch {
        /* bridge control text */
      }
    }),
  );
  await openFirst(page);
  await page.locator("[data-slot=model-choice]").click();
  await page.getByRole("menuitemradio", { name: "高", exact: true }).click();
  await expect(page.locator("[data-slot=model-choice]")).toContainText("高");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.locator("[data-slot=model-choice]").click();
  await expect(
    page.getByRole("menuitemradio", { name: "高", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await page.locator("[data-slot=policy-choice]").click();
  await page.getByRole("menuitemradio", { name: /谨慎审批/ }).click();
  await expect(page.locator("[data-slot=policy-choice]")).toContainText(
    "下次：谨慎审批",
  );
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.locator("[data-slot=policy-choice]").click();
  await expect(
    page.getByRole("menuitemradio", { name: /谨慎审批/ }),
  ).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await page.locator("input[type=file]").setInputFiles({
    name: "oversize.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(page.getByRole("alert")).toContainText("5 MB");
  await expect(page.locator("[data-slot=attachment]")).toHaveCount(0);
  await expect(page.locator("[data-slot=composer-action]")).toBeDisabled();
  await page.locator("input[type=file]").setInputFiles({
    name: "oversize.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(page.getByRole("alert")).toContainText("5 MB");
  await send(page, "检查当前模型与策略");
  await completed(page);
  expect(
    frames.find((frame) => frame.method === "turn/start")?.params,
  ).toMatchObject({
    model: "mock-codex",
    effort: "high",
    approvalPolicy: "untrusted",
  });
});

test("browser title follows the selected session, execution, rename and navigation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Codex 工作台");
  await openFirst(page);
  const name = await page.locator("[data-slot=breadcrumb] strong").innerText();
  await expect(page).toHaveTitle(`${name} · Codex 工作台`);
  await send(page, "慢速执行标题状态检查");
  await expect(page).toHaveTitle(`执行中 · ${name} · Codex 工作台`);
  await completed(page);
  await expect(page).toHaveTitle(`${name} · Codex 工作台`);
  await menu(page, "重命名");
  const dialog = page.getByRole("dialog", { name: "重命名会话" });
  await dialog.getByLabel("会话标题").fill("标签页标题验证");
  await dialog.getByRole("button", { name: "确认" }).click();
  await expect(page).toHaveTitle("标签页标题验证 · Codex 工作台");
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "搜索会话" });
  await search
    .getByPlaceholder("搜索标题、摘要或工作区…")
    .fill("设计令牌与暗色模式 · 2");
  await page.keyboard.press("Enter");
  await expect(page).toHaveTitle("设计令牌与暗色模式 · 2 · Codex 工作台");
});

test("browser title matches preview labels when switching sessions without names", async ({
  page,
}) => {
  await openFirst(page);
  fixtureServer.setThreadName("mock-thread-010", null);
  fixtureServer.publish({
    method: "thread/name/updated",
    params: { threadId: "mock-thread-010" },
  });
  await expect(page.locator("[data-slot=breadcrumb] strong")).toHaveText(
    "检查接口分页与错误处理",
  );
  await expect(page).toHaveTitle("检查接口分页与错误处理 · Codex 工作台");
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "搜索会话" });
  await search
    .getByPlaceholder("搜索标题、摘要或工作区…")
    .fill("设计令牌与暗色模式 · 2");
  await page.keyboard.press("Enter");
  await expect(search).toBeHidden();
  fixtureServer.setThreadName("mock-thread-002", null);
  fixtureServer.publish({
    method: "thread/name/updated",
    params: { threadId: "mock-thread-002" },
  });
  await expect(page).toHaveTitle("检查设计令牌与暗色模式 · Codex 工作台");
});

test("command approval uses server decision restrictions and resumes streaming", async ({
  page,
}) => {
  await openFirst(page);
  await send(page, "审批");
  await expect(
    page.getByRole("heading", { name: "命令执行审批" }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/^待确认 · .+ · Codex 工作台$/);
  const footer = page.locator('[data-slot="conversation-turn-footer"]').last();
  await expect(footer).toContainText("正在执行 · 已用时");
  const initialElapsed = await footer.textContent();
  await expect.poll(() => footer.textContent()).not.toBe(initialElapsed);
  await expect(page.getByRole("button", { name: "本会话允许" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "停止执行" })).toBeEnabled();
  await input(page).fill("审批前不能发送");
  await expect(page.getByRole("button", { name: "停止执行" })).toBeEnabled();
  await input(page).press("Enter");
  await expect(input(page)).toHaveText("审批前不能发送");
  await input(page).fill("");
  await page.getByRole("button", { name: "允许一次" }).click();
  await completed(page);
  await expect(page).toHaveTitle("用户问题演示 · 5 · Codex 工作台");
  await expect(page.getByRole("heading", { name: "命令执行审批" })).toHaveCount(
    0,
  );
  await send(page, "审批");
  await page.getByRole("button", { name: "拒绝", exact: true }).click();
  await expect(
    page.locator("[data-slot=conversation-turn]").last().locator("footer"),
  ).toContainText("已中断");
});

test("questions support custom choices and secret input then resume execution", async ({
  page,
}) => {
  const frames = recordComposerFrames(page);
  await openFirst(page);
  await send(page, "问题");
  await expect(
    page.getByRole("heading", { name: "需要你的回答" }),
  ).toBeVisible();
  await input(page).fill("暂存的普通消息");
  await page.locator("[data-slot=composer-action]").click();
  await expect(page.locator("[data-question-request-id]")).toBeFocused();
  await expect(input(page)).toHaveText("暂存的普通消息");
  await page.getByRole("radio", { name: "自定义回答" }).check();
  await page
    .getByRole("textbox", { name: "请选择导航布局，或输入自定义方案。" })
    .fill("分组侧栏");
  const secret = page.getByLabel("输入虚构测试口令（请勿填写真实密钥）。");
  await expect(secret).toHaveAttribute("type", "password");
  await secret.fill("fictional-only");
  await page.getByRole("button", { name: "提交回答" }).click();
  await completed(page);
  await expect(page.getByRole("heading", { name: "需要你的回答" })).toHaveCount(
    0,
  );
  await expect(
    page.locator("[data-slot=conversation-timeline]"),
  ).not.toContainText("fictional-only");
  // The empty request container remains mounted; focus follows the saved answer.
  await expect(
    page.getByLabel("待处理请求").locator("[data-question-request-id]"),
  ).toHaveCount(0);
  await expect(page.locator("[data-answer-record]").last()).toBeFocused();
  expect(frames).toContainEqual(
    expect.objectContaining({
      result: {
        answers: {
          layout: { answers: ["分组侧栏"] },
          demoSecret: { answers: ["fictional-only"] },
        },
      },
    }),
  );
});

for (const blocking of [false, true]) {
  test(`question panels use bounded library scrolling for many ${blocking ? "blocking" : "async"} questions`, async ({
    page,
  }) => {
    await openFirst(page);
    const threadId = "mock-thread-010";
    const titles = Array.from(
      { length: 9 },
      (_, index) => `请补充第 ${index + 1} 项偏好`,
    );
    if (blocking) {
      fixtureServer.publish({
        id: "many-questions",
        method: "item/tool/requestUserInput",
        params: {
          threadId,
          turnId: "many-question-turn",
          itemId: "many-question-item",
          isBlocking: true,
          autoResolutionMs: null,
          questions: titles.map((question, index) => ({
            id: `preference-${index}`,
            header: `偏好 ${index + 1}`,
            question,
            isOther: true,
            isSecret: false,
            options: null,
          })),
        },
      });
    } else {
      fixtureServer.publish({
        method: "turn/completed",
        params: {
          threadId,
          turn: {
            id: "many-question-turn",
            rootTurnId: null,
            status: "completed",
            itemsView: "full",
            error: null,
            startedAt: null,
            completedAt: null,
            durationMs: null,
            items: [
              {
                type: "agentMessage",
                id: "many-question-item",
                text: "请补充以下偏好。",
                phase: "commentary",
                memoryCitation: null,
                delivery: null,
                questions: titles.map((title) => ({ title, options: null })),
              },
            ],
          },
        },
      });
    }
    const panel = blocking
      ? page.getByLabel("待处理请求", { exact: true })
      : page.getByRole("region", { name: "待回答问题", exact: true });
    const viewport = blocking
      ? panel.locator("xpath=ancestor::*[@data-radix-scroll-area-viewport][1]")
      : panel.locator("[data-radix-scroll-area-viewport]");
    await expect(panel.getByRole("textbox")).toHaveCount(9);
    expect(
      await viewport.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    expect((await viewport.boundingBox())!.height).toBeLessThanOrEqual(
      1000 * (blocking ? 0.38 : 0.45) + 1,
    );
    const composer = page.locator("[data-slot=composer-action]");
    await expect(composer).toBeInViewport();
    const originalY = (await composer.boundingBox())!.y;
    for (const title of titles)
      await panel
        .getByRole("textbox", { name: title, exact: true })
        .fill(`回答：${title}`);
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await expect(
      panel.getByRole("textbox", { name: titles.at(-1)!, exact: true }),
    ).toBeInViewport();
    expect((await composer.boundingBox())!.y).toBe(originalY);
    const submit = panel.getByRole("button", { name: "提交回答", exact: true });
    await expect(submit).toBeEnabled();
    await submit.click();
    if (blocking) {
      await expect
        .poll(
          () =>
            fixtureServer.responseLog.find(
              (reply) => reply.id === "many-questions",
            )?.result,
        )
        .toEqual({
          answers: Object.fromEntries(
            titles.map((title, index) => [
              `preference-${index}`,
              { answers: [`回答：${title}`] },
            ]),
          ),
        });
    } else {
      await expect(panel.getByRole("form")).toHaveCount(0);
      await expect(page.locator("[data-answer-record]").last()).toBeFocused();
      // The UI records the answer before the asynchronous RPC reaches the server.
      await expect
        .poll(() =>
          JSON.stringify(
            fixtureServer.requestLog.findLast(
              (request) => request.method === "turn/start",
            )?.input ?? [],
          ),
        )
        .toContain(titles.at(-1));
    }
  });
}

for (const running of [false, true]) {
  test(`async questions accept answers ${running ? "during execution" : "after completion"}`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const notices: { title: string; closed: boolean }[] = [];
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: class {
          static permission = "granted";
          title: string;
          closed = false;
          constructor(title: string) {
            this.title = title;
            notices.push(this);
          }
          close() {
            this.closed = true;
          }
        },
      });
      Object.defineProperty(window, "asyncNotices", { value: notices });
    });
    await openFirst(page);
    await send(page, running ? "async-question-running" : "async-question");
    const form = page.getByRole("form", { name: "回答异步问题" });
    await expect(form).toBeVisible();
    await expect(
      page
        .locator("[data-slot=conversation-timeline]")
        .getByRole("form", { name: "回答异步问题" }),
    ).toHaveCount(0);
    await expect(
      page.locator("[data-slot=async-question-panel]"),
    ).toBeVisible();
    await expect(page.locator("[data-slot=action-notification]")).toContainText(
      "需要你回答问题",
    );
    await expect(form.getByRole("button", { name: "提交回答" })).toBeDisabled();
    const nativeQuestions = () =>
      page.evaluate(() =>
        (
          window as unknown as {
            asyncNotices: { title: string; closed: boolean }[];
          }
        ).asyncNotices.filter((notice) => notice.title === "需要你回答问题"),
      );
    await expect
      .poll(nativeQuestions)
      .toEqual([{ title: "需要你回答问题", closed: false }]);
    if (running)
      await form.getByRole("radio", { name: "顶部", exact: true }).check();
    else {
      await form.getByRole("radio", { name: "自定义回答" }).check();
      await form
        .getByRole("textbox", { name: "选择导航布局" })
        .fill("分组导航");
    }
    await form.getByRole("textbox", { name: "补充偏好" }).fill("紧凑布局");
    await form.getByRole("button", { name: "提交回答" }).click();
    await expect(form).toHaveCount(0);
    await expect(page.locator("[data-slot=action-notification]")).toHaveCount(
      0,
    );
    await expect(
      page.locator("[data-slot=conversation-timeline]"),
    ).toContainText(`选择导航布局\n${running ? "顶部" : "分组导航"}`);
    const method = running ? "turn/steer" : "turn/start";
    const reply = fixtureServer.requestLog.findLast(
      (entry) => entry.method === method,
    );
    expect(JSON.stringify(reply?.input)).toContain("紧凑布局");
    await expect
      .poll(nativeQuestions)
      .toEqual([{ title: "需要你回答问题", closed: true }]);
    if (!running) {
      await completed(page);
      await page.reload();
      await expect(form).toHaveCount(0);
      await expect(form.getByRole("button", { name: "提交回答" })).toHaveCount(
        0,
      );
      await expect(page.locator("[data-slot=action-notification]")).toHaveCount(
        0,
      );
    }
  });
}

test("external writer async question saves an answer then delivers after write access returns", async ({
  page,
}) => {
  await openFirst(page);
  const form = page.getByRole("form", { name: "回答异步问题" });
  const delivery = page.locator('[data-slot="question-answer-delivery"]');
  await expect(form).toBeVisible();
  await expect(form).toContainText("提交后将保留回答");
  const radio = form.getByRole("radio", { name: "顶部", exact: true });
  await radio.check();
  await expect(radio).toBeChecked();
  await form.getByRole("radio", { name: "侧栏", exact: true }).check();
  await expect(radio).not.toBeChecked();
  await form.getByRole("radio", { name: "自定义回答" }).check();
  await form
    .getByRole("textbox", { name: "运行中的导航偏好" })
    .fill("分组侧栏");
  await expect(form.getByRole("button", { name: "提交回答" })).toBeEnabled();
  const gap = await form.evaluate((element) => {
    const buttons = [...element.querySelectorAll("button")];
    const submit = buttons.find((button) => button.type === "submit")!;
    const ignore = buttons.find((button) => button.textContent === "忽略")!;
    return (
      ignore.getBoundingClientRect().left - submit.getBoundingClientRect().right
    );
  });
  expect(gap).toBeGreaterThanOrEqual(8);
  expect(
    fixtureServer.requestLog.filter((entry) =>
      ["turn/start", "turn/steer"].includes(entry.method),
    ),
  ).toHaveLength(0);
  await form.getByRole("button", { name: "提交回答" }).click();
  await expect(delivery.getByRole("status")).toContainText("回答已保存");
  await expect(page.locator("[data-slot=action-notification]")).toHaveCount(0);
  expect(
    fixtureServer.requestLog.filter((entry) =>
      ["turn/start", "turn/steer"].includes(entry.method),
    ),
  ).toHaveLength(0);
  fixtureServer.releaseWriter();
  await expect(form).toHaveCount(0);
  await expect
    .poll(
      () =>
        fixtureServer.requestLog.filter((entry) =>
          ["turn/start", "turn/steer"].includes(entry.method),
        ).length,
    )
    .toBe(1);
  const reply = fixtureServer.requestLog.find(
    (entry) => entry.method === "turn/start",
  );
  expect(JSON.stringify(reply?.input)).toContain("分组侧栏");
});

test("external writer async question restores a saved answer and requires confirmation after reload", async ({
  page,
}) => {
  await openFirst(page);
  const form = page.getByRole("form", { name: "回答异步问题" });
  const delivery = page.locator('[data-slot="question-answer-delivery"]');
  await form.getByRole("radio", { name: "顶部", exact: true }).check();
  await form.getByRole("button", { name: "提交回答" }).click();
  await expect(delivery.getByRole("status")).toContainText("回答已保存");
  await page.reload();
  await expect(delivery.getByRole("status")).toContainText("请检查后继续队列");
  await expect(
    page.locator("[data-answer-record]").filter({ has: delivery }),
  ).toContainText("顶部");
  expect(
    fixtureServer.requestLog.filter((entry) =>
      ["turn/start", "turn/steer"].includes(entry.method),
    ),
  ).toHaveLength(0);
  fixtureServer.releaseWriter();
  await delivery.getByRole("button", { name: "继续发送", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect
    .poll(
      () =>
        fixtureServer.requestLog.filter((entry) =>
          ["turn/start", "turn/steer"].includes(entry.method),
        ).length,
    )
    .toBe(1);
});

test("external writer async question can cancel a saved answer without sending", async ({
  page,
}) => {
  await openFirst(page);
  const form = page.getByRole("form", { name: "回答异步问题" });
  const delivery = page.locator('[data-slot="question-answer-delivery"]');
  await form.getByRole("radio", { name: "顶部", exact: true }).check();
  await form.getByRole("button", { name: "提交回答" }).click();
  await expect(delivery.getByRole("status")).toContainText("回答已保存");
  await delivery
    .getByRole("button", { name: "取消待发送", exact: true })
    .click();
  await expect(
    form.getByRole("radio", { name: "顶部", exact: true }),
  ).toBeEnabled();
  fixtureServer.releaseWriter();
  await expect(page.getByRole("button", { name: "停止执行" })).toHaveCount(0);
  expect(
    fixtureServer.requestLog.filter((entry) =>
      ["turn/start", "turn/steer"].includes(entry.method),
    ),
  ).toHaveLength(0);
});

test("async questions can be ignored without sending and remain ignored after reload", async ({
  page,
}) => {
  await openFirst(page);
  await send(page, "async-question");
  const panel = page.getByRole("region", { name: "待回答问题" });
  await expect(panel).toBeVisible();
  await completed(page);
  const writes = () =>
    fixtureServer.requestLog.filter((entry) =>
      ["turn/start", "turn/steer"].includes(entry.method),
    ).length;
  const before = writes();
  await panel.getByRole("button", { name: "忽略", exact: true }).click();
  await expect(panel.getByRole("form")).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: /恢复已忽略问题/ }),
  ).toBeVisible();
  await expect(page.locator("[data-slot=action-notification]")).toHaveCount(0);
  expect(writes()).toBe(before);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "消息输入框" })).toBeVisible();
  await expect(panel.getByRole("form")).toHaveCount(0);
  await expect(page.locator("[data-slot=action-notification]")).toHaveCount(0);
  await panel.getByRole("button", { name: /恢复已忽略问题/ }).click();
  await expect(panel.getByRole("form")).toBeVisible();
  expect(writes()).toBe(before);
});

test("async question drafts survive reload and unrelated follow-ups keep the question open", async ({
  page,
}) => {
  await openFirst(page);
  await send(page, "async-question");
  await completed(page);
  const form = page.getByRole("form", { name: "回答异步问题" });
  await form.getByRole("radio", { name: "自定义回答" }).check();
  const answer = form.getByRole("textbox", { name: "选择导航布局" });
  await answer.fill("第一行说明\n第二行说明");
  await page.reload();
  await expect(answer).toHaveValue("第一行说明\n第二行说明");
  await send(page, "请先解释背景");
  await completed(page);
  await expect(form).toBeVisible();
  await expect(answer).toHaveValue("第一行说明\n第二行说明");
});

test("running work accepts steering and can be interrupted", async ({
  page,
}) => {
  await openFirst(page);
  const action = page.locator("[data-slot=composer-action]");
  const originalPosition = await action.boundingBox();
  await send(page, "慢");
  await expect(page.getByRole("button", { name: "停止执行" })).toBeVisible();
  await expect(action).toHaveCount(1);
  expect(await action.boundingBox()).toEqual(originalPosition);
  await expect(action).toHaveCSS("color", await themeColor(page, "danger"));
  await expect(action.locator("svg")).toHaveAttribute("fill", "currentColor");
  await input(page).fill("补充方向");
  await input(page).press("Control+Enter");
  await expect(
    page.locator("[data-slot=conversation-turn]").last(),
  ).toContainText("补充方向");
  await page.getByRole("button", { name: "停止执行" }).click();
  await expect(
    page.locator("[data-slot=conversation-turn]").last().locator("footer"),
  ).toContainText("已中断");
  await expect(page.getByRole("button", { name: "停止执行" })).toHaveCount(0);
});

test("failure and disconnect are visible; reconnect preserves the unsent draft", async ({
  page,
}) => {
  await openFirst(page);
  await send(page, "失败");
  await expect(
    page.locator("[data-slot=conversation-turn]").last(),
  ).toContainText("执行失败");
  await expect(
    page
      .locator("[data-slot=conversation-turn]")
      .last()
      .getByRole("alert")
      .filter({ hasText: "模拟服务" }),
  ).toBeVisible();
  await send(page, "断线");
  await expect(page.locator("[data-slot=connection-entry] strong")).toHaveText(
    "设置",
  );
  await input(page).fill("重连后的待发送草稿");
  await expect(page.locator("[data-slot=composer-action]")).toBeDisabled();
  await expect(page.locator("[data-slot=thread-link]").first()).toBeVisible();
  await expect(page.locator("[data-slot=thread-link]").first()).toBeEnabled();
  await expect(
    page.locator("[data-slot=conversation-turn]").first(),
  ).toBeVisible();
  await page
    .locator("[data-slot=connection-banner]")
    .getByRole("button", { name: "重新连接", exact: true })
    .click();
  await expect(page.locator("[data-slot=connection-banner]")).toHaveCount(0);
  await expect(page.locator("[data-slot=global-error]")).toBeHidden();
  await expect(input(page)).toHaveText("重连后的待发送草稿");
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "thread/resume",
    ),
  ).toHaveLength(1);
  await send(page, "重连后发送并重新确认写入");
  await completed(page);
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "thread/resume",
    ),
  ).toHaveLength(2);
  await send(page, "断线");
  await expect(page.locator("[data-slot=connection-banner]")).toHaveCount(1);
  await page
    .locator("[data-slot=connection-banner]")
    .getByRole("button", { name: "连接设置", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "连接与设置" });
  await settings.getByRole("tab", { name: "工作环境", exact: true }).click();
  await settings.getByRole("button", { name: "连接", exact: true }).click();
  await expect(settings).toBeHidden();
  await expect(page.locator("[data-slot=connection-banner]")).toHaveCount(0);
  await expect(page.locator("[data-slot=global-error]")).toBeHidden();
});

test("turn results display files and diffs independently of the project panel", async ({
  page,
}) => {
  await openFirst(page);
  await send(page, "请实施工作区导航修改");
  await completed(page);
  const turn = page.locator("[data-slot=conversation-turn]").last();
  const results = turn.locator("[data-slot=turn-results]");
  await expect(results).toBeVisible();
  await results.getByRole("button", { name: /本轮变更 ·/ }).click();
  await expect(results).not.toContainText("检查现状");
  await expect(results).toContainText("src/navigation.ts");
  await results
    .getByRole("button", { name: "src/navigation.ts", exact: true })
    .click();
  await expect(results.locator("pre")).toContainText(
    '+export const label = "工作区";',
  );
  await page.getByRole("button", { name: "打开项目面板" }).click();
  const panel = page.getByRole("complementary", { name: "项目面板" });
  await expect(
    panel.getByRole("tab", { name: "文件", exact: true }),
  ).toHaveAttribute("data-state", "active");
  await expect(panel).not.toContainText("检查现状");
  await turn.getByRole("button", { name: "展开执行过程", exact: true }).click();
  const command = turn
    .locator("[data-slot=conversation-tool]")
    .filter({ hasText: "npm run test" });
  await expect(command).not.toHaveAttribute("open");
  await command.locator("summary").click();
  await expect(turn).toContainText("24 tests passed");
});

test("turn results keep late diffs attached to their owning turn", async ({
  page,
}) => {
  await openFirst(page);
  const threadId = fixtureServer.requestLog.find(
    (request) => request.method === "thread/read",
  )!.threadId!;
  const turn = (id: string) => ({
    id,
    rootTurnId: null,
    items: [],
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
  });
  for (const id of ["audit-first", "audit-second"])
    fixtureServer.publish({
      method: "turn/completed",
      params: { threadId, turn: turn(id) },
    });
  const diff = (path: string) =>
    `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-before\n+after`;
  fixtureServer.publish({
    method: "turn/diff/updated",
    params: { threadId, turnId: "audit-second", diff: diff("B.ts") },
  });
  fixtureServer.publish({
    method: "turn/plan/updated",
    params: {
      threadId,
      turnId: "audit-first",
      explanation: null,
      plan: [{ step: "第一轮迟到计划", status: "completed" }],
    },
  });
  fixtureServer.publish({
    method: "turn/diff/updated",
    params: { threadId, turnId: "audit-first", diff: diff("A.ts") },
  });
  const results = page.locator('[data-slot="turn-results"]');
  await expect(results).toHaveCount(2);
  await results
    .nth(0)
    .getByRole("button", { name: /本轮变更 ·/ })
    .click();
  await results
    .nth(1)
    .getByRole("button", { name: /本轮变更 ·/ })
    .click();
  await expect(results.nth(0)).not.toContainText("第一轮迟到计划");
  await expect(
    results.nth(0).getByRole("button", { name: "A.ts", exact: true }),
  ).toBeVisible();
  await expect(
    results.nth(1).getByRole("button", { name: "B.ts", exact: true }),
  ).toBeVisible();
  await expect(results.nth(1)).not.toContainText("第一轮迟到计划");
  await expect(results.nth(1)).not.toContainText("A.ts");
});

for (const width of [375, 768, 1440])
  test(`viewport ${width}px has no horizontal overflow; dialog traps focus and Escape restores it`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openFirst(page);
    if (width < 900) {
      await page.getByRole("button", { name: "打开导航" }).click();
      await expect(
        page.getByRole("dialog", { name: "工作区导航" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("dialog", { name: "工作区导航" }),
      ).toBeHidden();
      await expect(
        page.getByRole("button", { name: "打开导航" }),
      ).toBeFocused();
    }
    if (width < 900) {
      await page.getByRole("button", { name: "打开导航" }).click();
    }
    const trigger = page.locator("[data-slot=connection-entry]");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "连接与设置" });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    if (width < 900) {
      await expect(
        page.getByRole("button", { name: "打开导航" }),
      ).toBeFocused();
    } else {
      await expect(trigger).toBeFocused();
    }
    await page.getByRole("button", { name: "打开项目面板" }).click();
    await expect(
      page.getByRole("complementary", { name: "项目面板" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

test("new session updates sidebar and header titles after the first message", async ({
  page,
}) => {
  await connect(page);
  await page.getByRole("button", { name: /^新建会话/ }).click();
  const dialog = page.getByRole("dialog", { name: "新建会话" });
  await dialog.getByLabel("工作目录").fill("/demo/atlas-web");
  await dialog.getByRole("button", { name: "创建会话" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-slot=breadcrumb] strong")).toHaveText(
    "新会话",
  );
  const title = "检查新会话标题同步";
  await send(page, title);
  await expect(
    page.locator(
      "[data-slot=thread-row][data-selected=true] [data-slot=thread-title]",
    ),
  ).toHaveText(title);
  await expect(page.locator("[data-slot=breadcrumb] strong")).toHaveText(title);
  await expect(page.locator("[data-slot=conversation-heading]")).toHaveCount(0);
  await completed(page);
  await expect(page.locator("[data-slot=breadcrumb] strong")).toHaveText(title);
});

test("sidebar exposes a more menu on hover and supports archive undo", async ({
  page,
}) => {
  await connect(page);
  const first = page.locator("[data-slot=thread-row]").first();
  const title = await first.locator("[data-slot=thread-title]").innerText();
  const row = page.locator("[data-slot=thread-row]").filter({
    has: page.getByText(title, { exact: true }),
  });
  const more = row.getByRole("button", {
    name: `会话操作：${title}`,
    exact: true,
  });
  await page.mouse.move(1000, 100);
  await expect(more).toHaveCSS("opacity", "0");
  const linkPosition = await row
    .locator("[data-slot=thread-link]")
    .boundingBox();
  await expect(
    page.locator('[data-slot=sidebar] button[aria-label^="归档会话："]'),
  ).toHaveCount(0);
  await row.hover();
  await expect(more).toHaveCSS("opacity", "1");
  await expect(row.locator("time")).toBeVisible();
  expect(await row.locator("[data-slot=thread-link]").boundingBox()).toEqual(
    linkPosition,
  );
  await page.mouse.move(1000, 100);
  await expect(more).toHaveCSS("opacity", "0");
  await more.focus();
  await expect(more).toHaveCSS("opacity", "1");
  await more.press("Enter");
  await page.getByRole("menuitem", { name: "归档", exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "归档会话" })).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(row).toHaveCount(1);
});

test("top session menu copies conversation, summary and session ID and exports Markdown", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          sessionStorage.setItem("test-clipboard", text);
        },
      },
      configurable: true,
    });
  });
  await openFirst(page);
  await page
    .locator("[data-slot=topbar]")
    .getByRole("button", { name: /会话操作：/ })
    .click();
  await expect(page.getByRole("menuitem")).toHaveText([
    "收藏会话",
    "重命名",
    "分叉会话",
    "移动到分区",
    "复制全部对话为 Markdown",
    "仅复制最终总结",
    "复制 Session ID",
    "导出会话",
    "归档",
    "永久删除",
  ]);
  await page.keyboard.press("Escape");
  await menu(page, "复制全部对话为 Markdown");
  await expect(
    page.getByRole("status").filter({ hasText: "已复制全部对话" }),
  ).toBeVisible();
  const markdown = await page.evaluate(() =>
    sessionStorage.getItem("test-clipboard"),
  );
  expect(markdown).toContain("## 用户");
  expect(markdown).toContain("## 助手");
  expect(markdown).toContain("## 实施结果");
  await menu(page, "仅复制最终总结");
  await expect(
    page.getByRole("status").filter({ hasText: "已复制最终总结" }),
  ).toBeVisible();
  const summary = await page.evaluate(() =>
    sessionStorage.getItem("test-clipboard"),
  );
  expect(summary).toMatch(/^## 实施结果/);
  expect(summary).not.toContain("## 用户");
  await menu(page, "复制 Session ID");
  await expect(
    page.getByRole("status").filter({ hasText: "已复制 Session ID" }),
  ).toBeVisible();
  const sessionId = await page.evaluate(() =>
    sessionStorage.getItem("test-clipboard"),
  );
  expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(markdown).toContain(`Session ID: ${sessionId}`);
  const downloaded = page.waitForEvent("download");
  await menu(page, "导出会话");
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(await readFile(path!, "utf8")).toBe(markdown);
});
test("sidebar running state uses a spinner without a running time label", async ({
  page,
}) => {
  await openFirst(page);
  await send(page, "请慢速执行工作区任务");
  const row = page.locator("[data-slot=thread-row][data-selected=true]");
  await expect(row.getByRole("img", { name: "运行中" })).toBeVisible();
  await expect(row.locator("[data-slot=running-indicator]")).toHaveCount(1);
  await expect(row.locator("time")).toHaveCount(0);
  await completed(page);
  await expect(row.locator("[data-slot=running-indicator]")).toHaveCount(0);
  await expect(row.locator("time")).toBeVisible();
});

test("topbar shows the current Git branch and change count", async ({
  page,
}) => {
  await openFirst(page);
  await expect(page.locator("[data-slot=header-branch]")).toHaveText(
    "demo/ui-polish改动 3 个文件",
  );
  await page.locator("[data-slot=header-branch]").hover();
  await expect(page.getByRole("tooltip")).toContainText(
    /Git 分支：demo\/ui-polish.*3 个改动文件/,
  );
  await expect(page.locator("[data-slot=topbar]")).not.toContainText("已连接");
  await expect(page.locator("[data-slot=header-status]")).toHaveCount(0);
});

test("project Git panel shares the header status and opens staged and untracked diffs", async ({
  page,
}) => {
  await openFirst(page);
  const header = page.locator('[data-slot="header-branch"]');
  await expect(header).toHaveText("demo/ui-polish改动 3 个文件");
  const before = fixtureServer.requestLog.filter(
    (request) =>
      request.method === "command/exec" && request.command?.includes("status"),
  ).length;
  await header.click();
  const panel = page.getByRole("complementary", { name: "项目面板" });
  await expect(
    panel.getByRole("tab", { name: "Git", exact: true }),
  ).toHaveAttribute("data-state", "active");
  await expect(
    panel.getByRole("heading", { name: "已暂存 · 1" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "未暂存 · 1" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "未跟踪 · 1" }),
  ).toBeVisible();
  expect(
    fixtureServer.requestLog.filter(
      (request) =>
        request.method === "command/exec" &&
        request.command?.includes("status"),
    ).length,
  ).toBe(before);
  const directory = panel
    .locator(".git-folder > summary")
    .filter({ hasText: "src" });
  const changedFile = panel.getByRole("button", {
    name: "src/app.ts",
    exact: true,
  });
  await expect(directory).toBeVisible();
  const folderChevron = directory.locator(".git-folder-chevron");
  await expect(folderChevron).toHaveCSS(
    "transform",
    "matrix(0, 1, -1, 0, 0, 0)",
  );
  await directory.click();
  await expect(changedFile).toBeHidden();
  await expect(folderChevron).toHaveCSS("transform", "none");
  await directory.click();
  await expect(folderChevron).toHaveCSS(
    "transform",
    "matrix(0, 1, -1, 0, 0, 0)",
  );
  await changedFile.click();
  const workspace = page.getByRole("region", { name: "文件编辑工作区" });
  await expect(workspace.locator(".monaco-diff-editor")).toBeVisible();
  await expect(workspace.locator(".file-comparison-labels")).toContainText(
    "暂存区",
  );
  await expect(workspace.locator(".file-comparison-labels")).toContainText(
    "磁盘文件",
  );
  await panel.getByRole("button", { name: "切换为列表视图" }).click();
  await expect(panel.locator(".git-folder")).toHaveCount(0);
  await expect(changedFile).toBeVisible();
  await expect(changedFile).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "切换为树状视图" }).click();
  await expect(directory).toBeVisible();
  await expect(changedFile).toHaveAttribute("aria-pressed", "true");
  const stagedGroup = panel
    .locator(".git-group")
    .filter({ hasText: "已暂存 · 1" });
  const groupChevron = stagedGroup.locator(":scope > summary > svg");
  await expect(groupChevron).toHaveCSS(
    "transform",
    "matrix(0, 1, -1, 0, 0, 0)",
  );
  await stagedGroup.locator("summary").click();
  await expect(
    panel.getByRole("button", { name: "package.json", exact: true }),
  ).toBeHidden();
  await expect(groupChevron).toHaveCSS("transform", "none");
  await stagedGroup.locator("summary").click();
  await expect(groupChevron).toHaveCSS(
    "transform",
    "matrix(0, 1, -1, 0, 0, 0)",
  );
  await panel
    .getByRole("button", { name: "package.json", exact: true })
    .click();
  await expect(workspace.locator(".file-comparison-labels")).toContainText(
    "HEAD",
  );
  await expect(
    workspace.locator(".monaco-diff-editor .original .view-lines"),
  ).toContainText("before");
  await expect(
    workspace.locator(
      ".monaco-diff-editor .modified .view-lines:not(.line-delete)",
    ),
  ).toContainText("after");
  expect(
    fixtureServer.requestLog.some((request) =>
      request.command?.includes("HEAD:package.json"),
    ),
  ).toBe(true);
  await panel
    .getByRole("button", { name: "new-file.txt", exact: true })
    .click();
  await expect(workspace.locator(".file-comparison-labels")).toContainText(
    "空文件（未跟踪）",
  );
  await expect(
    workspace.locator(
      ".monaco-diff-editor .modified .view-lines:not(.line-delete)",
    ),
  ).toContainText("New file");
  await expect(panel.locator(".git-diff")).toHaveCount(0);
});

test("project files editor and reference preserve the composer draft", async ({
  page,
}) => {
  await openFirst(page);
  await input(page).fill("请检查文档");
  await page.getByRole("button", { name: "打开项目面板" }).click();
  const panel = page.getByRole("complementary", { name: "项目面板" });
  await panel.getByRole("button", { name: "README.md", exact: true }).click();
  const workspace = page.getByRole("region", { name: "文件编辑工作区" });
  await expect(workspace.locator(".monaco-editor")).toBeVisible();
  await expect(workspace.locator(".view-lines")).toContainText("Demo project");
  await expect(panel.locator("pre")).toHaveCount(0);
  await panel
    .getByRole("button", { name: "更多操作：README.md", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "引用到输入框", exact: true })
    .click();
  await workspace
    .getByRole("button", { name: "返回会话", exact: true })
    .click();
  await expect(input(page)).toContainText("请检查文档");
  await expect(input(page)).toContainText("README.md");
  await panel.getByRole("textbox", { name: "搜索项目文件" }).fill("app");
  await expect(
    panel.getByRole("button", { name: /^src\/app.ts(?:，|$)/ }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "node_modules/app.ts", exact: true }),
  ).toHaveCount(0);
});

test("Git panel exposes read-only status and differences without write actions", async ({
  page,
}) => {
  await openFirst(page);
  await page.locator('[data-slot="header-branch"]').click();
  const panel = page.getByRole("complementary", { name: "项目面板" });
  await expect(panel).toContainText("源代码管理");
  await expect(panel).toContainText("查看差异与导出补丁");
  await expect(panel.locator(".git-branch-label")).toContainText(
    "demo/ui-polish",
  );
  await expect(
    panel.getByRole("heading", { name: "已暂存 · 1" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "未暂存 · 1" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "未跟踪 · 1" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", {
      name: /暂存|提交|推送|切换分支|选择 Git 分支/,
    }),
  ).toHaveCount(0);
  await expect(panel.getByRole("textbox", { name: "提交说明" })).toHaveCount(0);
  await panel.getByRole("button", { name: "切换为列表视图" }).click();
  await panel.getByRole("button", { name: "src/app.ts", exact: true }).click();
  const workspace = page.getByRole("region", { name: "文件编辑工作区" });
  await expect(workspace.locator(".monaco-diff-editor")).toBeVisible();
  await panel.getByRole("button", { name: "刷新 Git 工作区" }).click();
  await expect(
    panel.getByRole("button", { name: "刷新 Git 工作区" }),
  ).toBeEnabled();
  const commands = fixtureServer.requestLog.filter(
    (request) => request.method === "command/exec",
  );
  expect(commands.length).toBeGreaterThan(0);
  expect(
    commands.every((request) => request.sandboxPolicy?.type === "readOnly"),
  ).toBe(true);
  expect(
    commands.some((request) =>
      request.command?.some((arg) =>
        ["add", "restore", "commit", "switch", "push"].includes(arg),
      ),
    ),
  ).toBe(false);
});

test("topbar branch changes refresh after a turn and follow the selected workspace", async ({
  page,
}) => {
  await openFirst(page);
  const header = page.locator('[data-slot="header-branch"]');
  await expect(header).toHaveText("demo/actual改动 3 个文件");
  const reads = fixtureServer.requestLog.filter(
    (request) => request.method === "command/exec",
  );
  expect(reads.at(-1)?.cwd).toBe("/demo/atlas-web");
  expect(reads.at(-1)?.command).toContain("--no-optional-locks");
  expect(
    fixtureServer.requestLog.some(
      (request) => request.method === "thread/resume",
    ),
  ).toBe(false);
  await send(page, "刷新改动文件数");
  await completed(page);
  await expect(header).toHaveText("demo/actual改动 5 个文件");
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "搜索会话" });
  await search
    .getByPlaceholder("搜索标题、摘要或工作区…")
    .fill("设计令牌与暗色模式 · 2");
  await page.keyboard.press("Enter");
  await expect(search).toBeHidden();
  await expect(header).toHaveText("demo/other工作区干净");
  expect(
    fixtureServer.requestLog
      .filter((request) => request.method === "command/exec")
      .at(-1)?.cwd,
  ).toBe("/demo/design-system");
});

test("topbar unavailable Git status keeps the change count unknown", async ({
  page,
}) => {
  await openFirst(page);
  const header = page.locator('[data-slot="header-branch"]');
  await expect(header).toHaveText("Git读取失败");
  await header.hover();
  await expect(page.getByRole("tooltip")).toContainText(
    /未获取工作区改动文件数，请检查/,
  );
  await expect(page.locator('[data-slot="global-error"]')).toHaveCount(0);
});

test("welcome offers task actions and sidebar product icons load with static browser assets", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(
    page.locator("[data-slot=sidebar] [data-slot=product-icon]"),
  ).toBeVisible();
  await expect(
    page
      .locator("[data-slot=welcome]")
      .getByRole("heading", { name: "开始一项工作" }),
  ).toBeVisible();
  const welcome = page.locator("[data-slot=welcome]");
  await expect(
    welcome.getByRole("button", { name: "连接工作环境", exact: true }),
  ).toBeVisible();
  await expect(
    welcome.getByRole("button", { name: "开始新会话", exact: true }),
  ).toHaveCount(0);
  await welcome
    .getByRole("button", { name: "管理工作环境", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "连接与设置" });
  await expect(
    settings.getByRole("tab", { name: "工作环境", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    settings.getByRole("heading", { name: "连接与账户", exact: true }),
  ).toBeVisible();
  await expect(settings.getByLabel("App-server 地址")).toBeVisible();
  await settings.getByRole("button", { name: "关闭", exact: true }).click();
  await welcome
    .getByRole("button", { name: "连接工作环境", exact: true })
    .click();
  await expect(
    settings.getByRole("tab", { name: "工作环境", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(settings.getByLabel("App-server 地址")).toBeVisible();
  await settings.getByLabel("App-server 地址").fill(fixtureUrl);
  await settings.getByRole("button", { name: "连接", exact: true }).click();
  await expect(settings).toBeHidden();
  await expect(
    welcome.getByRole("button", { name: "开始新会话", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator("[data-slot=welcome]")
      .getByRole("button", { name: "搜索会话", exact: true }),
  ).toBeVisible();
  expect(
    await page.locator("[data-slot=product-icon]").evaluateAll((icons) =>
      icons.every((icon) => {
        const image = icon as HTMLImageElement;
        return image.complete && image.naturalWidth === 256;
      }),
    ),
  ).toBe(true);
  await expect(page.locator("#product-favicon")).toHaveAttribute(
    "href",
    /\/icons\/favicon\.png$/,
  );
  for (const path of [
    "/icons/favicon.png",
    "/icons/favicon-running.png",
    "/icons/favicon-completed.png",
    "/icons/apple-touch-icon.png",
    "/favicon.ico",
  ]) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toMatch(/^image\//);
  }
});

test("favicon completion remains unread in a visible window without focus", async ({
  page,
}) => {
  await openFirst(page);
  await send(page, "慢速执行窗口失焦完成提示");
  await expect(page.locator("#product-favicon")).toHaveAttribute(
    "href",
    /\/icons\/favicon-running\.png$/,
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => false,
    });
    window.dispatchEvent(new Event("blur"));
  });
  await expect(page.locator("#product-favicon")).toHaveAttribute(
    "href",
    /\/icons\/favicon-completed\.png$/,
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => true,
    });
    document.getElementById("product-favicon")?.remove();
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.locator("#product-favicon")).toHaveAttribute(
    "href",
    /\/icons\/favicon\.png$/,
  );
});

for (const permission of ["granted", "denied"] as const) {
  test(`background completion shows an unread icon and notification with ${permission} system permission`, async ({
    page,
  }) => {
    await page.addInitScript((permission) => {
      const sent: {
        title: string;
        options: NotificationOptions;
        onclick: (() => void) | null;
      }[] = [];
      Object.defineProperty(window, "Notification", {
        value: class {
          static permission = permission;
          onclick: (() => void) | null = null;
          constructor(
            public title: string,
            public options: NotificationOptions,
          ) {
            sent.push(this);
          }
          close() {}
        },
        configurable: true,
      });
      Object.defineProperty(window, "testNotifications", { value: sent });
    }, permission);
    await connect(page);
    const create = async () => {
      await page.getByRole("button", { name: /^新建会话/ }).click();
      const dialog = page.getByRole("dialog", { name: "新建会话" });
      await dialog.getByLabel("工作目录").fill("/demo/atlas-web");
      await dialog.getByRole("button", { name: "创建会话" }).click();
      await expect(dialog).toBeHidden();
    };
    await create();
    await expect(page.locator("#product-favicon")).toHaveAttribute(
      "href",
      /\/icons\/favicon\.png$/,
    );
    const title = "慢速执行后台完成提示";
    // Browser integrations can replace the original icon link after page load.
    await page.evaluate(() =>
      document.getElementById("product-favicon")?.remove(),
    );
    await send(page, title);
    await expect(page.getByRole("button", { name: "停止执行" })).toBeVisible();
    await expect(page.locator("#product-favicon")).toHaveAttribute(
      "href",
      /\/icons\/favicon-running\.png$/,
    );
    await create();
    await expect(page.locator("#product-favicon")).toHaveAttribute(
      "href",
      /\/icons\/favicon-running\.png$/,
    );
    await expect(page).toHaveTitle("Codex 工作台");
    resumeBackgroundStream?.();
    const notice = page.locator("[data-slot=completion-notification]");
    await expect(notice).toContainText("会话已完成");
    await expect(notice).toContainText(title);
    await expect(page.locator("#product-favicon")).toHaveAttribute(
      "href",
      /\/icons\/favicon-completed\.png$/,
    );
    await expect(page).toHaveTitle("Codex 工作台");
    const row = page.locator("[data-slot=thread-row]").filter({
      has: page.locator("[data-slot=thread-link] > span", { hasText: title }),
    });
    await expect(
      row.getByRole("img", { name: "已完成，结果未读" }),
    ).toBeVisible();
    await expect(page.locator("[data-slot=breadcrumb] strong")).toHaveText(
      "新会话",
    );
    const nativeCount = () =>
      page.evaluate(
        () =>
          (window as unknown as { testNotifications: unknown[] })
            .testNotifications.length,
      );
    await expect.poll(nativeCount).toBe(permission === "granted" ? 1 : 0);
    if (permission === "granted") {
      expect(
        await page.evaluate(
          () =>
            (
              window as unknown as {
                testNotifications: { options: NotificationOptions }[];
              }
            ).testNotifications[0].options.icon,
        ),
      ).toBe("/icons/product-icon.png");
      await page.evaluate(() =>
        (
          window as unknown as { testNotifications: { onclick: () => void }[] }
        ).testNotifications[0].onclick(),
      );
    } else {
      await notice.getByRole("button", { name: new RegExp(title) }).click();
    }
    await expect(page.locator("[data-slot=breadcrumb] strong")).toHaveText(
      title,
    );
    await expect(
      row.getByRole("img", { name: "已完成，结果未读" }),
    ).toHaveCount(0);
    await expect(notice).toHaveCount(0);
    await expect(page.locator("#product-favicon")).toHaveAttribute(
      "href",
      /\/icons\/favicon\.png$/,
    );
  });
}

test("composer follows session reasoning effort instead of the model catalog default", async ({
  page,
}) => {
  await openFirst(page);
  await expect(page.locator("[data-slot=model-choice]")).toContainText("中");
  await page.locator("[data-slot=model-choice]").click();
  await expect(
    page.getByRole("menuitemradio", { name: "中", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: "高", exact: true }).click();
  await expect(page.locator("[data-slot=model-choice]")).toContainText("高");
});

test("local and remote environments keep independent drafts, background turns and icon project groups", async ({
  page,
}) => {
  const remote = createMockServer({
    gitStatus: "# branch.head remote/main\0? remote-file.txt\0",
  });
  remote.listen(0, "127.0.0.1");
  await once(remote, "listening");
  const address = remote.address();
  if (!address || typeof address === "string") throw Error("missing listener");
  try {
    await openFirst(page);
    await send(page, "请慢速处理本机会话");
    await expect(page.getByRole("button", { name: "停止执行" })).toBeVisible();
    await page.locator("[data-slot=connection-entry]").click();
    const dialog = page.getByRole("dialog", { name: "连接与设置" });
    await dialog.getByRole("tab", { name: "工作环境", exact: true }).click();
    await dialog.getByRole("button", { name: "添加开发机" }).click();
    await dialog.getByLabel("环境名称", { exact: true }).fill("dev-box");
    await dialog
      .getByLabel("App-server 地址")
      .fill(`ws://127.0.0.1:${address.port}`);
    await dialog.getByRole("button", { name: "连接", exact: true }).click();
    await expect(dialog).toBeHidden();
    const groups = page.locator("[data-slot=environment-projects]");
    await expect(groups).toHaveCount(1);
    await expect(groups.nth(0)).toHaveAttribute("data-connected", "true");
    const filters = page.getByRole("tablist", { name: "按工作环境筛选会话" });
    await expect(
      filters.getByRole("tab", { name: "dev-box", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await filters.getByRole("tab", { name: "全部", exact: true }).click();
    await expect(groups).toHaveCount(2);
    await filters.getByRole("tab", { name: "dev-box", exact: true }).click();
    await expect(groups).toHaveCount(1);
    await expect(
      page.locator("[data-slot=breadcrumb] [data-slot=environment-icon] svg"),
    ).toHaveClass(/lucide-server/);
    await expect(
      page.locator("[data-slot=workspace-toggle]").first(),
    ).toHaveAttribute("title", /^dev-box · /);
    await page.keyboard.press("Control+Shift+o");
    const newDialog = page.getByRole("dialog", { name: "新建会话" });
    await expect(
      newDialog.getByRole("combobox", { name: "新会话工作环境" }),
    ).toHaveText("dev-box");
    const localDirectoryReads = fixtureServer.requestLog.filter(
      (request) => request.method === "fs/readDirectory",
    ).length;
    await newDialog.getByLabel("工作目录", { exact: true }).fill("/demo");
    await expect(page.getByRole("listbox", { name: "目录建议" })).toBeVisible();
    await newDialog
      .getByRole("button", { name: "浏览目录", exact: true })
      .click();
    const directoryBrowser = newDialog.getByRole("region", {
      name: "目录浏览器",
    });
    await expect(directoryBrowser).toContainText("正在浏览：dev-box");
    await expect(
      directoryBrowser.getByRole("button", { name: "atlas-web", exact: true }),
    ).toBeVisible();
    expect(
      remote.requestLog.some(
        (request) => request.method === "fs/readDirectory",
      ),
    ).toBe(true);
    expect(
      fixtureServer.requestLog.filter(
        (request) => request.method === "fs/readDirectory",
      ),
    ).toHaveLength(localDirectoryReads);
    await newDialog.getByRole("combobox", { name: "新会话工作环境" }).click();
    await page.getByRole("option", { name: "本机", exact: true }).click();
    await expect(directoryBrowser).toBeHidden();
    await expect(newDialog.getByLabel("工作目录", { exact: true })).toHaveValue(
      "",
    );
    await expect(
      page.locator("[data-slot=breadcrumb] [data-slot=environment-icon] svg"),
    ).toHaveClass(/lucide-server/);
    await newDialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(newDialog).toBeHidden();
    await expect(
      filters.getByRole("tab", { name: "dev-box", exact: true }),
    ).toBeFocused();
    await expect(
      page.locator("[data-slot=breadcrumb] [data-slot=environment-icon] svg"),
    ).toHaveClass(/lucide-server/);
    await filters.getByRole("tab", { name: "dev-box", exact: true }).focus();
    await page.keyboard.press("Home");
    await expect(filters.getByRole("tab", { name: "全部" })).toBeFocused();
    await expect(groups).toHaveCount(2);
    await page.locator("[data-slot=connection-entry]").click();
    await dialog.getByRole("tab", { name: "工作环境", exact: true }).click();
    await dialog.getByRole("button", { name: /^dev-box/ }).click();
    await expect(dialog.getByLabel("环境名称", { exact: true })).toHaveValue(
      "dev-box",
    );
    await expect(
      page.locator("[data-slot=breadcrumb] [data-slot=environment-icon] svg"),
    ).toHaveClass(/lucide-server/);
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(
      page
        .locator('[data-slot=workspace-heading][data-environment-id="local"]')
        .first(),
    ).toContainText("本机");
    // The combined list virtualizes offscreen projects. Choose the environment
    // before operating on its rows rather than requiring every row in the DOM.
    await filters.getByRole("tab", { name: "dev-box", exact: true }).click();
    const remoteThread = page.locator(
      '[data-slot=thread-row]:not([data-environment-id="local"])',
    );
    await remoteThread
      .locator("[data-slot=thread-link]")
      .filter({ hasText: "接口分页与错误处理 · 10" })
      .click();
    await expect(page.locator('[data-slot="header-branch"]')).toHaveText(
      "remote/main改动 1 个文件",
    );
    await input(page).fill("远端草稿");
    await filters.getByRole("tab", { name: "本机", exact: true }).click();
    await page
      .locator('[data-slot=thread-row][data-environment-id="local"]')
      .locator("[data-slot=thread-link]")
      .filter({ hasText: "接口分页与错误处理 · 10" })
      .click();
    await expect(input(page)).toHaveText("");
    await expect(page.locator('[data-slot="header-branch"]')).toHaveText(
      "demo/ui-polish改动 3 个文件",
    );
    await input(page).fill("本机草稿");
    await filters.getByRole("tab", { name: "dev-box", exact: true }).click();
    await remoteThread
      .locator("[data-slot=thread-link]")
      .filter({ hasText: "接口分页与错误处理 · 10" })
      .click();
    await expect(input(page)).toHaveText("远端草稿");
    await expect(
      page.locator("[data-slot=topbar]").getByRole("button", { name: /日志/ }),
    ).toHaveCount(0);
    await page.locator("[data-slot=connection-entry]").click();
    await expect(dialog.getByRole("tab", { name: "本机终端" })).toHaveCount(0);
    await dialog.getByRole("tab", { name: "工作环境" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  } finally {
    await new Promise<void>((resolve) => remote.close(() => resolve()));
  }
});

test("preferences session history restores an archived conversation", async ({
  page,
}) => {
  await openFirst(page);
  await menu(page, "归档");
  await expect(page.locator("[data-slot=archived-conversation]")).toBeVisible();
  await page.locator("[data-slot=connection-entry]").click();
  await page.getByRole("tab", { name: "已归档的会话" }).click();
  const history = page.getByRole("dialog", { name: "连接与设置" });
  await expect(history.locator("[data-slot=archive-group]")).toHaveCount(1);
  expect(
    fixtureServer.requestLog.some(
      (entry) =>
        entry.method === "thread/list" &&
        entry.params?.archived === true &&
        Array.isArray(entry.params.sourceKinds) &&
        entry.params.sourceKinds.includes("appServer"),
    ),
  ).toBe(true);
  await expect(history.locator("summary")).toContainText("/demo/atlas-web");
  await history
    .getByRole("button", { name: "恢复 接口分页与错误处理 · 10", exact: true })
    .click();
  await expect(history).toBeHidden();
  await expect(input(page)).toBeVisible();
  await expect(page.locator("[data-slot=topbar]")).toContainText(
    "接口分页与错误处理 · 10",
  );
});

for (const width of [375, 1440])
  test(`preferences at ${width}px keep management in tabs and the sidebar focused on sessions`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openFirst(page);
    if (width < 900)
      await page.getByRole("button", { name: "打开导航" }).click();
    await expect(page.locator("[data-slot=environment-actions]")).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "添加工作环境" }),
    ).toHaveCount(0);
    await page.locator("[data-slot=connection-entry]").click();
    const dialog = page.getByRole("dialog", { name: "连接与设置" });
    const environmentSelector = dialog.locator(
      '[aria-label="选择要管理的工作环境"]',
    );
    const expectFieldSpacing = async () => {
      const fields = await dialog.locator("label[for]").evaluateAll((labels) =>
        labels.map((label) => {
          const control = document.getElementById(label.getAttribute("for")!);
          if (!control) return null;
          // SettingsField keeps its label and help text together. Wide fields
          // align that block beside the control; narrow fields stack it above.
          const description = label.parentElement!;
          const labelBlock = description.getBoundingClientRect();
          const field = control.getBoundingClientRect();
          const beside = field.left >= labelBlock.right - 0.5;
          return {
            direction: beside ? "beside" : "below",
            gap: beside
              ? field.left - labelBlock.right
              : field.top - labelBlock.bottom,
            top: field.top - labelBlock.top,
          };
        }),
      );
      expect(fields.length).toBeGreaterThan(0);
      for (const field of fields) {
        expect(field).not.toBeNull();
        expect(field!.gap).toBeCloseTo(
          field!.direction === "beside" ? 24 : 8,
          1,
        );
        if (field!.direction === "beside") expect(field!.top).toBeCloseTo(0, 1);
      }
    };
    await expect(environmentSelector).toHaveCount(0);
    await expect(
      dialog.getByRole("tab", { name: "通用", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByRole("group", { name: "显示主题" })).toBeVisible();
    await expect(
      dialog.getByRole("combobox", { name: "新建会话默认模型", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("combobox", { name: "工作环境设置", exact: true }),
    ).toHaveCount(0);
    await expect(dialog.getByRole("tab")).toHaveText([
      "通用",
      "工作环境",
      "已归档的会话",
      "终端输出",
    ]);
    await expect(
      dialog.getByRole("tab", { name: "环境工具", exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole("tab", { name: "工作环境", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "连接与账户", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(dialog.getByLabel("App-server 地址")).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "账号与用量", exact: true }),
    ).toBeVisible();
    await expectFieldSpacing();
    await environmentScope(page, "模型与权限");
    await expect(dialog.getByLabel("App-server 地址")).toHaveCount(0);
    await expect(
      dialog.getByRole("heading", { name: "账号与用量", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("heading", { name: "查看项目生效配置", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "MCP 服务", exact: true }),
    ).toHaveCount(0);
    const modelSelect = dialog.getByRole("combobox", {
      name: "新建会话默认模型",
      exact: true,
    });
    await expectFieldSpacing();
    await expect(modelSelect).toContainText("跟随设备默认模型");
    await modelSelect.click();
    const modelOptions = page.getByRole("listbox");
    await expect(modelOptions).toBeVisible();
    expect(
      await modelOptions.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= window.innerWidth;
      }),
    ).toBe(true);
    await expect(
      page.getByRole("option", { name: "跟随设备默认模型", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("option", { name: "Mock Codex" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(modelSelect).toContainText("Mock Codex");
    await expect(
      dialog.getByLabel("自定义模型 ID", { exact: true }),
    ).toHaveCount(0);
    await modelSelect.click();
    await page.getByRole("option", { name: "自定义模型", exact: true }).click();
    const defaultModel = dialog.getByLabel("自定义模型 ID", { exact: true });
    await defaultModel.fill("unsaved-example-model");
    await environmentScope(page, "工具与集成");
    await expect(
      dialog.getByRole("heading", { name: "MCP 服务", exact: true }),
    ).toBeVisible();
    await expectFieldSpacing();
    await expect(modelSelect).toHaveCount(0);
    await expect(
      dialog.getByRole("heading", { name: "查看项目生效配置", exact: true }),
    ).toHaveCount(0);
    await environmentScope(page, "配置迁移");
    await expect(
      dialog.getByRole("button", { name: "探测可迁移内容", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "MCP 服务", exact: true }),
    ).toHaveCount(0);
    await environmentScope(page, "模型与权限");
    await expect(modelSelect).toContainText("自定义模型");
    await expect(defaultModel).toHaveValue("unsaved-example-model");
    await modelSelect.click();
    await page
      .getByRole("option", { name: "跟随设备默认模型", exact: true })
      .click();
    await expect(defaultModel).toHaveCount(0);
    await expect(modelSelect).toContainText("跟随设备默认模型");
    await environmentScope(page, "连接与账户");
    await expect(dialog.getByRole("tab", { name: "工作环境" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(dialog.getByLabel("App-server 地址")).toBeVisible();
    await expect(environmentSelector).toBeVisible();
    const name = dialog.getByLabel("环境名称", { exact: true });
    await name.fill("未保存的环境名称");
    const token = dialog.getByLabel(/Bearer Token/);
    await token.fill("fictional-only");
    await dialog.getByRole("tab", { name: "通用", exact: true }).click();
    await dialog.getByRole("tab", { name: "工作环境", exact: true }).click();
    await expect(name).toHaveValue("未保存的环境名称");
    await expect(token).toHaveValue("");
    await expect(dialog.getByRole("tab")).toHaveText([
      "通用",
      "工作环境",
      "已归档的会话",
      "终端输出",
    ]);
    await expect(dialog.getByRole("tab", { name: "本机终端" })).toHaveCount(0);
    await dialog.getByRole("tab", { name: "已归档的会话" }).click();
    await expect(environmentSelector).toBeVisible();
    await expect(
      dialog.getByRole("combobox", { name: "工作环境设置", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "刷新归档会话" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("searchbox", { name: "搜索已归档会话" }),
    ).toBeVisible();
    await expect(dialog).toContainText("还没有归档的会话");
    await expect(dialog.getByLabel("App-server 地址")).toHaveCount(0);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

test("local app-server setup exposes output without browser process controls", async ({
  page,
}) => {
  await openFirst(page);
  await page.locator("[data-slot=connection-entry]").click();
  const dialog = page.getByRole("dialog", { name: "连接与设置" });
  await dialog.getByRole("tab", { name: "工作环境", exact: true }).click();
  await expect(dialog.getByRole("tab")).toHaveText([
    "通用",
    "工作环境",
    "已归档的会话",
    "终端输出",
  ]);
  await expect(dialog.getByRole("tab", { name: "本机终端" })).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: /启动本机服务|停止本机服务/ }),
  ).toHaveCount(0);
  await expect(dialog).toContainText(
    process.env.E2E_PRODUCTION
      ? "网页服务会自动启动或复用本机 app-server"
      : "请先在本机终端手动启动 app-server",
  );
  await expect(dialog).toContainText(
    "codex app-server --listen ws://127.0.0.1:4501",
  );
  await expect(dialog.getByLabel("App-server 地址")).toBeVisible();
  await dialog.getByRole("tab", { name: "终端输出", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "本机 app-server 终端输出" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /启动本机服务|停止本机服务/ }),
  ).toHaveCount(0);
  if (process.env.E2E_PRODUCTION) {
    await expect(dialog.getByText("输出不可用", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("app-server 终端输出")).toContainText(
      "此网页服务未管理本机 app-server",
    );
    await expect(dialog.getByLabel("跟随最新输出")).toBeChecked();
  } else {
    await expect(dialog).toContainText("开发模式不启动 app-server");
    await expect(dialog.getByLabel("app-server 终端输出")).toHaveCount(0);
  }
});

test("current session completion sends a system notification without an unread icon", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const notifications: { title: string; closed: boolean }[] = [];
    Object.defineProperty(window, "Notification", {
      value: class {
        static permission = "granted";
        closed = false;
        onclick: (() => void) | null = null;
        constructor(public title: string) {
          notifications.push(this);
        }
        close() {
          this.closed = true;
        }
      },
      configurable: true,
    });
    Object.defineProperty(window, "testCurrentNotifications", {
      value: notifications,
    });
  });
  await openFirst(page);
  await send(page, "检查当前会话完成通知");
  await completed(page);
  await expect(
    page.locator("[data-slot=completion-notification]"),
  ).toContainText("会话已完成");
  await expect(
    page.locator(
      "[data-slot=thread-row][data-selected=true] [data-slot=thread-completion-indicator]",
    ),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              testCurrentNotifications: { title: string; closed: boolean }[];
            }
          ).testCurrentNotifications,
      ),
    )
    .toEqual([{ title: "会话已完成", closed: false }]);
});

test("model menu keeps original model heading styling and applies it to reasoning", async ({
  page,
}) => {
  await openFirst(page);
  await page.locator("[data-slot=model-choice]").click();
  const menu = page.locator("[data-slot=menu]");
  const modelLabel = menu
    .locator('[data-slot="menu-label"]')
    .filter({ hasText: /^模型$/ });
  const reasoningLabel = menu.locator('[data-menu-section="reasoning"]');
  for (const label of [modelLabel, reasoningLabel]) {
    await expect(label).toHaveCSS("font-size", "11px");
    await expect(label).toHaveCSS("font-weight", "500");
    await expect(label).toHaveCSS("color", await themeColor(page, "muted"));
    await expect(label).toHaveCSS("padding", "8px 10px");
  }
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--font-scale", "1.25");
  });
  for (const label of [modelLabel, reasoningLabel]) {
    await expect(label).toHaveCSS("font-size", "13.75px");
    await expect(label).toHaveCSS("padding", "8px 10px");
  }
});

for (const width of [375, 1440]) {
  test(`style tokens at ${width}px scale utilities and editor CSS with an input size floor`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openFirst(page);
    await expect(input(page)).toHaveCSS(
      "font-size",
      width < 900 ? "16px" : "14px",
    );
    const editorSurface = page.locator(".composer-input-surface");
    await expect(
      editorSurface.getByRole("textbox", { name: "消息输入框" }),
    ).toBeVisible();
    await expect(editorSurface).toHaveCSS("overflow", "hidden");
    // The surface clips the editor; the editor owns its shared spacing inset.
    await expect(input(page)).toHaveCSS(
      "padding",
      width < 550 ? "12px 12px 8px" : "16px 16px 8px",
    );
    await expect(input(page)).toHaveCSS(
      "min-height",
      width < 550 ? "64px" : "76px",
    );
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--font-scale", "1.25");
    });
    await expect(input(page)).toHaveCSS(
      "font-size",
      width < 900 ? "20px" : "17.5px",
    );
    await expect(page.locator("html")).toHaveCSS("font-size", "14px");
    await page.locator("[data-slot=model-choice]").click();
    const label = page
      .locator('[data-slot="menu-label"]')
      .filter({ hasText: /^模型$/ });
    await expect(label).toHaveCSS("font-size", "13.75px");
    await expect(label).toHaveCSS("padding", "8px 10px");
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--font-scale", "0.75");
    });
    await expect(input(page)).toHaveCSS(
      "font-size",
      width < 900 ? "16px" : "10.5px",
    );
    if (width < 550) {
      await page.setViewportSize({ width, height: 400 });
      await expect(input(page)).toHaveCSS("min-height", "44px");
      await expect(input(page)).toHaveCSS("max-height", "100px");
      await page.setViewportSize({ width, height: 900 });
      await expect(input(page)).toHaveCSS("min-height", "64px");
    }
  });
}

test("external activity updates loading even when loaded history has only completed turns", async ({
  page,
}) => {
  await openFirst(page);
  const row = page.locator("[data-slot=thread-row][data-selected=true]");
  await expect(row.getByRole("img", { name: "运行中" })).toBeVisible();
  await expect(row.getByRole("img", { name: "运行中" })).toHaveCount(0);
  await expect(input(page)).toBeVisible();
});

test("external partial history recovers from an ambiguous interruption and shows a sidebar spinner", async ({
  page,
}) => {
  await openFirst(page);
  const footer = page.locator("[data-slot=conversation-turn-footer]").last();
  await expect(
    footer.getByText("执行状态待确认", { exact: true }),
  ).toBeVisible();
  await expect(footer).toContainText("正在执行", { timeout: 15_000 });
  await expect(
    page.locator(
      "[data-slot=thread-row][data-selected=true] [data-slot=running-indicator]",
    ),
  ).toBeVisible();
  await expect(
    page.locator("[data-slot=conversation-turn]").last(),
  ).toContainText("终端仍在执行");
  await send(page, "不要丢失草稿");
  await expect(input(page)).toBeDisabled();
  await expect(footer).toContainText("正在执行");
  await expect(
    page.locator(
      "[data-slot=thread-row][data-selected=true] [data-slot=running-indicator]",
    ),
  ).toBeVisible();
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "turn/start",
    ),
  ).toHaveLength(0);
});

test("external writer is checked on send without losing the draft or retrying on reopen", async ({
  page,
}) => {
  await openFirst(page);
  await expect(page.getByRole("button", { name: "继续编辑" })).toHaveCount(0);
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "thread/resume",
    ),
  ).toHaveLength(0);
  await expect(input(page)).toBeEnabled();
  await send(page, "终端占用时保留这份草稿");
  await expect(input(page)).toBeDisabled();
  await expect(input(page)).toHaveText("终端占用时保留这份草稿");
  await expect(page.locator("[data-slot=composer-status]")).toContainText(
    "只读查看",
  );
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "thread/resume",
    ),
  ).toHaveLength(1);
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "turn/start",
    ),
  ).toHaveLength(0);
  await expect(
    page.locator("[data-slot=conversation-turn]").last(),
  ).toContainText("终端新增输出已同步");
  await page
    .locator(
      "[data-slot=thread-row][data-selected=true] [data-slot=thread-link]",
    )
    .click();
  await expect(input(page)).toBeDisabled();
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "thread/resume",
    ),
  ).toHaveLength(1);
  fixtureServer.releaseWriter();
  await page.getByRole("button", { name: "重试发送", exact: true }).click();
  await expect(input(page)).toBeEnabled();
  await expect(input(page)).toHaveText("");
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "thread/resume",
    ),
  ).toHaveLength(2);
  await expect
    .poll(
      () =>
        fixtureServer.requestLog.filter(
          (request) =>
            request.method === "turn/steer" || request.method === "turn/start",
        ).length,
    )
    .toBe(1);
});

test("opening only reads and the first send automatically activates the thread", async ({
  page,
}) => {
  await openFirst(page);
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "thread/resume",
    ),
  ).toHaveLength(0);
  await expect(input(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "继续编辑" })).toHaveCount(0);
  await send(page, "发送时激活会话");
  await completed(page);
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "thread/resume",
    ),
  ).toHaveLength(1);
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "turn/start",
    ),
  ).toHaveLength(1);
  await send(page, "第二条消息无需重复激活");
  await completed(page);
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "thread/resume",
    ),
  ).toHaveLength(1);
});

test("context usage opens details with hover, click and keyboard focus", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "codex-environments",
      JSON.stringify([
        {
          id: "local",
          name: "测试环境",
          kind: "local",
          url: "ws://127.0.0.1:4501",
          autoConnect: false,
        },
      ]),
    );
  });
  await openFirst(page);
  const indicator = page.getByRole("button", {
    name: "上下文：暂无数据",
    exact: true,
  });
  await expect(indicator).toBeVisible();
  await indicator.hover();
  const details = page.getByRole("dialog", { name: "上下文使用量详情" });
  await expect(details).toContainText("等待服务端上报上下文用量。");
  await expect(details).toContainText("不代表上下文为空");
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await indicator.click();
  await expect(details).toBeVisible();
  await page.keyboard.press("Escape");
  await indicator.blur();
  await indicator.focus();
  await expect(details).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
});

for (const width of [375, 1440])
  test(`archived groups at ${width}px paginate, search and collapse by workspace`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await connect(page);
    if (width < 900)
      await page.getByRole("button", { name: "打开导航" }).click();
    await page.locator("[data-slot=connection-entry]").click();
    const dialog = page.getByRole("dialog", { name: "连接与设置" });
    await dialog.getByRole("tab", { name: "已归档的会话" }).click();
    await expect(dialog.locator("[data-slot=archive-group]")).toHaveCount(4);
    await expect(dialog.locator("[data-slot=archive-thread]")).toHaveCount(30);
    const searchInput = dialog.getByRole("searchbox", {
      name: "搜索已归档会话",
    });
    expect(
      await searchInput.evaluate((el) => getComputedStyle(el).borderTopWidth),
    ).toBe("0px");
    await expect(searchInput).toHaveCSS("margin-top", "0px");
    await expect(searchInput).toHaveCSS("padding-left", "0px");
    await expect(searchInput).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const atlas = dialog.locator("[data-slot=archive-group]").filter({
      has: page.locator("summary strong", { hasText: "atlas-web" }),
    });
    await expect(atlas).toHaveCount(2);
    await expect(atlas.locator("summary small")).toHaveText([
      "/demo/atlas-web",
      "/legacy/atlas-web",
    ]);
    await expect(
      atlas
        .filter({ hasText: "/legacy/atlas-web" })
        .locator("[data-slot=archive-thread]"),
    ).toHaveCount(1);
    const group = dialog.locator("[data-slot=archive-group]").first();
    await group.locator("summary").click();
    await expect(group).not.toHaveAttribute("open");
    await group.locator("summary").click();
    await expect(group).toHaveAttribute("open", "");
    await dialog.getByRole("button", { name: "加载更多会话" }).click();
    await expect(dialog.locator("[data-slot=archive-thread]")).toHaveCount(60);
    await dialog.getByRole("button", { name: "加载更多会话" }).click();
    await expect(dialog.locator("[data-slot=archive-thread]")).toHaveCount(65);
    await expect(
      dialog.getByRole("button", { name: "加载更多会话" }),
    ).toHaveCount(0);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await dialog
      .getByRole("searchbox", { name: "搜索已归档会话" })
      .fill("接口分页与错误处理 · 45");
    await expect(dialog.locator("[data-slot=archive-thread]")).toHaveCount(1);
    await expect(dialog.locator("summary")).toContainText("/demo/api-service");
    await dialog
      .getByRole("searchbox", { name: "搜索已归档会话" })
      .fill("no-such-session");
    await expect(dialog).toContainText("没有匹配的会话");
    await dialog.getByRole("searchbox", { name: "搜索已归档会话" }).fill("");
    await expect(dialog.locator("[data-slot=archive-thread]")).toHaveCount(30);
    await dialog.getByRole("combobox", { name: "归档会话排序" }).click();
    await page.getByRole("option", { name: "最近更新", exact: true }).focus();
    await page.keyboard.press("End");
    await expect(
      page.getByRole("option", { name: "创建时间", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      dialog.locator("[data-slot=archive-thread]").first(),
    ).toContainText("创建于");
    await dialog.getByRole("button", { name: "刷新归档会话" }).click();
    await expect(dialog.locator("[data-slot=archive-thread]")).toHaveCount(30);
  });

for (const width of [375, 1440])
  test(`appearance at ${width}px persists explicit themes and follows system changes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    const root = page.locator("html");
    await expect(root).toHaveAttribute("data-theme", "light");
    const openAppearance = async () => {
      if (width < 900) {
        await page.getByRole("button", { name: "打开导航" }).click();
        await page.locator("[data-slot=connection-entry]").click();
      } else {
        await page
          .getByRole("button", { name: "连接工作环境", exact: true })
          .click();
      }
      const dialog = page.getByRole("dialog", { name: "连接与设置" });
      await dialog.getByRole("tab", { name: "通用", exact: true }).click();
      return dialog;
    };
    let dialog = await openAppearance();
    const noOverflow = async () => {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    };
    await expect(
      dialog.getByRole("radio", { name: "跟随系统", exact: true }),
    ).toBeChecked();
    await dialog.getByRole("radio", { name: "深色", exact: true }).check();
    await expect(root).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("body")).toHaveCSS(
      "color",
      await themeColor(page, "foreground"),
    );
    await noOverflow();
    await page.reload();
    await expect(root).toHaveAttribute("data-theme", "dark");
    dialog = await openAppearance();
    await expect(
      dialog.getByRole("radio", { name: "深色", exact: true }),
    ).toBeChecked();
    await page.emulateMedia({ colorScheme: "light" });
    await expect(root).toHaveAttribute("data-theme", "dark");
    await dialog.getByRole("radio", { name: "浅色", exact: true }).check();
    await expect(root).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(root).toHaveAttribute("data-theme", "light");
    await noOverflow();
    await page.reload();
    await expect(root).toHaveAttribute("data-theme", "light");
    dialog = await openAppearance();
    await expect(
      dialog.getByRole("radio", { name: "浅色", exact: true }),
    ).toBeChecked();
    await dialog.getByRole("radio", { name: "跟随系统", exact: true }).check();
    await expect(root).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(root).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(root).toHaveAttribute("data-theme", "dark");
    await noOverflow();
    await page.reload();
    await expect(root).toHaveAttribute("data-theme", "dark");
    dialog = await openAppearance();
    await expect(
      dialog.getByRole("radio", { name: "跟随系统", exact: true }),
    ).toBeChecked();
    expect(
      await page.evaluate(() => localStorage.getItem("codex-workbench.theme")),
    ).toBe("system");
    await noOverflow();
  });

test("composer completes slash commands, skills and workspace files", async ({
  page,
}) => {
  await openFirst(page);
  await input(page).fill("/mod");
  await expect(page.getByRole("option", { name: /\/model/ })).toBeVisible();
  await input(page).press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(input(page)).toHaveText("");
  await input(page).fill("请用 $rev");
  await expect(page.getByRole("option", { name: /\$review/ })).toBeVisible();
  await input(page).press("Tab");
  await expect(input(page)).toHaveText("请用 $review ");
  await input(page).fill("检查 @app");
  await expect(page.getByRole("option", { name: /src\/app.ts/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /node_modules/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole("option", { name: /app\.log/ })).toHaveCount(0);
  await input(page).press("Enter");
  await expect(input(page)).toHaveText("检查 @src/app.ts ");
  await expect(
    input(page).locator("[data-composer-reference=file]"),
  ).toHaveAttribute("title", /\/demo\/.*\/src\/app.ts/);
  await input(page).fill("/status");
  await input(page).press("Escape");
  await expect(page.getByRole("listbox", { name: "输入补全" })).toBeHidden();
  await input(page).press("Enter");
  await expect(input(page)).toHaveText("");
  await expect(
    page.getByRole("status").filter({ hasText: "模型：" }),
  ).toBeVisible();
});

test("conversation follows streamed updates and viewport resizing at the bottom", async ({
  page,
}) => {
  await openFirst(page);
  await send(
    page,
    Array.from({ length: 70 }, (_, index) => `底部验证 ${index}`).join("\n"),
  );
  await completed(page);
  const viewport = page.locator(
    '[data-slot="conversation-timeline"] > [data-radix-scroll-area-viewport]',
  );
  const gap = () =>
    viewport.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  await send(page, "operation-lifecycle-progress");
  await expect(
    page
      .locator('[data-slot="conversation-tool"][data-status="inProgress"]')
      .last(),
  ).toBeVisible();
  await expect.poll(gap).toBeLessThan(5);
  await completed(page);
  await expect.poll(gap).toBeLessThan(5);
  await expect(page.getByRole("button", { name: /回到底部/ })).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 700 });
  await expect.poll(gap).toBeLessThan(5);
});

test("conversation uses the library viewport and returns to the latest message", async ({
  page,
}) => {
  await openFirst(page);
  await send(
    page,
    Array.from({ length: 70 }, (_, index) => `滚动验证第 ${index + 1} 行`).join(
      "\n",
    ),
  );
  await completed(page);
  const viewport = page.locator(
    '[data-slot="conversation-timeline"] > [data-radix-scroll-area-viewport]',
  );
  await expect(viewport).toBeVisible();
  // Completion is reported before the last execution height animation settles.
  // This case checks navigation from a settled layout; live folding is covered separately.
  await expect
    .poll(() =>
      viewport.evaluate((element) =>
        Array.from(
          element.querySelectorAll(
            '[data-slot="conversation-execution"], [data-slot="disclosure-content"]',
          ),
        ).some((node) => node.getAnimations().length > 0),
      ),
    )
    .toBe(false);
  await expect
    .poll(() =>
      viewport.evaluate(
        (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
      ),
    )
    .toBeLessThan(5);
  await viewport.hover();
  await page.mouse.wheel(0, -10000);
  const latest = page.getByRole("button", { name: /回到底部/ });
  await expect(latest).toBeVisible();
  await latest.click();
  await expect
    .poll(() =>
      viewport.evaluate(
        (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
      ),
    )
    .toBeLessThan(5);
  await expect(latest).toBeHidden();
});

for (const width of [375, 1440]) {
  test(`scroll content at ${width}px contains long code and tables without expanding the conversation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openFirst(page);
    const longLine = "long_identifier_".repeat(120);
    await send(
      page,
      `\`\`\`text\n${longLine}\n\`\`\`\n\n| 内容 |\n| --- |\n| ${longLine} |`,
    );
    await completed(page);
    const timeline = page.locator('[data-slot="conversation-timeline"]');
    const viewport = timeline.locator(
      ":scope > [data-radix-scroll-area-viewport]",
    );
    await expect
      .poll(() =>
        viewport.evaluate((el) => {
          const content = el.firstElementChild!;
          return Math.abs(
            content.getBoundingClientRect().width - el.clientWidth,
          );
        }),
      )
      .toBeLessThan(2);
    await expect
      .poll(() => viewport.evaluate((el) => el.scrollWidth - el.clientWidth))
      .toBeLessThan(2);
    const codeViewport = timeline
      .locator('[data-slot="conversation-turn"]')
      .last()
      .locator("pre")
      .first()
      .locator("xpath=../..");
    await expect(codeViewport).toHaveAttribute(
      "data-radix-scroll-area-viewport",
      "",
    );
    await expect
      .poll(() =>
        codeViewport.evaluate((el) => el.scrollWidth - el.clientWidth),
      )
      .toBeGreaterThan(100);
    await codeViewport.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect
      .poll(() => codeViewport.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(100);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

function recordComposerFrames(page: Page) {
  const frames: {
    method?: string;
    params?: { input?: Record<string, unknown>[] };
  }[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      try {
        frames.push(JSON.parse(String(frame.payload)));
      } catch {
        /* control frame */
      }
    }),
  );
  return frames;
}

async function chooseSkill(page: Page) {
  await input(page).fill("请用 $rev");
  await expect(page.getByRole("option", { name: /\$review/ })).toBeVisible();
  await input(page).press("Tab");
  await expect(
    input(page).locator("[data-composer-reference=skill]"),
  ).toHaveCount(1);
}

test("rich composer references delete atomically, undo, redo and keep RPC skill metadata in sync", async ({
  page,
}) => {
  const frames = recordComposerFrames(page);
  await openFirst(page);
  await chooseSkill(page);
  await input(page).press("Backspace"); // trailing space
  await expect(page.getByRole("listbox", { name: "输入补全" })).toBeHidden();
  await input(page).press("Backspace"); // whole reference
  await expect(input(page)).toHaveText("请用 ");
  await expect(input(page).locator("[data-composer-reference]")).toHaveCount(0);
  await input(page).press("ControlOrMeta+z");
  await expect(
    input(page).locator("[data-composer-reference=skill]"),
  ).toHaveCount(1);
  await input(page).press("ControlOrMeta+Shift+z");
  await expect(input(page).locator("[data-composer-reference]")).toHaveCount(0);
  await input(page).press("Enter");
  await completed(page);
  expect(
    frames.find((frame) => frame.method === "turn/start")?.params?.input,
  ).toEqual([{ type: "text", text: "请用 ", text_elements: [] }]);
  await input(page).press("ControlOrMeta+z");
  await expect(input(page)).toHaveText("");

  await chooseSkill(page);
  await input(page).press("Enter");
  await completed(page);
  expect(
    frames.filter((frame) => frame.method === "turn/start").at(-1)?.params
      ?.input,
  ).toEqual([
    { type: "text", text: "请用 $review ", text_elements: [] },
    { type: "skill", name: "review", path: "/demo/skills/review/SKILL.md" },
  ]);
});

test("rich composer file references survive conversation switches, Delete and selection replacement", async ({
  page,
}) => {
  const frames = recordComposerFrames(page);
  await openFirst(page);
  await input(page).fill("@app");
  await expect(page.getByRole("option", { name: /src\/app.ts/ })).toBeVisible();
  await input(page).press("Tab");
  const tag = input(page).locator("[data-composer-reference=file]");
  const path = await tag.getAttribute("data-reference-path");
  const title = await page.locator("[data-slot=breadcrumb] strong").innerText();
  await page
    .locator("[data-slot=thread-link]:not([aria-current=page])")
    .first()
    .click();
  await expect(input(page)).toHaveText("");
  await page
    .locator("[data-slot=thread-link]")
    .filter({ hasText: title })
    .first()
    .click();
  await expect(tag).toHaveAttribute("data-reference-path", path!);
  await tag.evaluate((element) => {
    const range = document.createRange();
    range.setStartBefore(element);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  await input(page).press("Delete");
  await expect(tag).toHaveCount(0);
  await input(page).press("ControlOrMeta+z");
  await expect(tag).toHaveCount(1);
  await input(page).press("Enter");
  await expect
    .poll(() => frames.filter((frame) => frame.method === "turn/start").length)
    .toBe(1);
  await completed(page);
  expect(
    frames.find((frame) => frame.method === "turn/start")?.params?.input,
  ).toEqual([{ type: "text", text: `${path} `, text_elements: [] }]);
  await chooseSkill(page);
  await input(page).press("ControlOrMeta+a");
  await input(page).press("x");
  await expect(input(page)).toHaveText("x");
  await expect(input(page).locator("[data-composer-reference]")).toHaveCount(0);
});

const tinyPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
async function transferImage(
  page: Page,
  event: "paste" | "drop",
  name: string,
  text = "",
) {
  await input(page).evaluate(
    (element, { event, name, text, bytes }) => {
      const data = new DataTransfer();
      data.items.add(
        new File(
          [Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0))],
          name,
          { type: "image/png" },
        ),
      );
      if (text) data.setData("text/plain", text);
      element.dispatchEvent(
        event === "paste"
          ? new ClipboardEvent("paste", {
              clipboardData: data,
              bubbles: true,
              cancelable: true,
            })
          : new DragEvent("drop", {
              dataTransfer: data,
              bubbles: true,
              cancelable: true,
            }),
      );
    },
    { event, name, text, bytes: tinyPng },
  );
}

test("rich composer images paste with text, drop, preview, preserve valid attachments and send image-only", async ({
  page,
}) => {
  const frames = recordComposerFrames(page);
  await openFirst(page);
  await input(page).focus();
  await transferImage(page, "paste", "clipboard.png", "截图说明\n第二行");
  await expect(page.locator("[data-slot=attachment]")).toHaveCount(1);
  await expect.poll(() => input(page).innerText()).toMatch(/截图说明\n+第二行/);
  await transferImage(page, "drop", "drop.png");
  await expect(page.locator("[data-slot=attachment]")).toHaveCount(2);
  await page.getByRole("button", { name: "预览图片 clipboard.png" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "clipboard.png" })
      .getByRole("img", { name: "clipboard.png", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "预览图片 clipboard.png" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "移除附件 drop.png" }).click();
  await page.locator("input[type=file]").setInputFiles([
    {
      name: "oversize.txt",
      mimeType: "text/plain",
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
    },
    {
      name: "valid.png",
      mimeType: "image/png",
      buffer: Buffer.from(tinyPng, "base64"),
    },
  ]);
  await expect(page.getByRole("alert")).toContainText("oversize.txt");
  await expect(page.locator("[data-slot=attachment]")).toHaveCount(2);
  await page.getByRole("button", { name: "移除附件 valid.png" }).click();
  await input(page).press("ControlOrMeta+a");
  await input(page).press("Backspace");
  await expect(input(page)).toHaveText("");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await completed(page);
  expect(
    frames.find((frame) => frame.method === "turn/start")?.params?.input,
  ).toEqual([{ type: "image", url: `data:image/png;base64,${tinyPng}` }]);
  await expect(page.locator("[data-slot=attachment]")).toHaveCount(0);
  const sent = page.locator('[data-slot="conversation-turn"]').last();
  const image = sent.getByRole("button", {
    name: "预览图片 对话附件 1",
    exact: true,
  });
  await image.click();
  await expect(
    page
      .getByRole("dialog", { name: "对话附件 1", exact: true })
      .getByRole("img"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(image).toBeFocused();
  await expect(sent.getByRole("button", { name: /移除附件/ })).toHaveCount(0);
});

test("rich composer copy and paste preserve references while external formatting becomes plain text", async ({
  page,
}) => {
  const frames = recordComposerFrames(page);
  await openFirst(page);
  await chooseSkill(page);
  await input(page).press("ControlOrMeta+a");
  const copied = await input(page).evaluate((element) => {
    const clipboard = new DataTransfer();
    element.dispatchEvent(
      new ClipboardEvent("copy", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
    return {
      html: clipboard.getData("text/html"),
      text: clipboard.getData("text/plain"),
    };
  });
  expect(copied.text).toBe("请用 $review ");
  await input(page).press("Backspace");
  await input(page).evaluate((element, copied) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/html", copied.html);
    clipboard.setData("text/plain", copied.text);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, copied);
  await expect(
    input(page).locator("[data-composer-reference=skill]"),
  ).toHaveCount(1);
  await input(page).press("Enter");
  await completed(page);
  expect(
    frames.find((frame) => frame.method === "turn/start")?.params?.input,
  ).toContainEqual({
    type: "skill",
    name: "review",
    path: "/demo/skills/review/SKILL.md",
  });
  await input(page).evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData(
      "text/html",
      '<p><strong style="color:red">第一行</strong></p><p>第二行</p>',
    );
    clipboard.setData("text/plain", "第一行\n第二行");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect.poll(() => input(page).innerText()).toMatch(/第一行\n+第二行/);
  await expect(input(page).locator("strong, [style]")).toHaveCount(0);
});

test("rich composer image limits retain accepted images and unsupported models keep the draft", async ({
  page,
}) => {
  const frames = recordComposerFrames(page);
  await openFirst(page);
  for (let index = 1; index <= 4; index++) {
    await transferImage(page, "paste", `${index}.png`);
    await expect(page.locator("[data-slot=attachment]")).toHaveCount(index);
  }
  await transferImage(page, "paste", "fifth.png");
  await expect(page.getByRole("alert")).toContainText("最多 4 张");
  await expect(page.locator("[data-slot=attachment]")).toHaveCount(4);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("当前模型未声明支持图片");
  await expect(page.locator("[data-slot=attachment]")).toHaveCount(4);
  expect(frames.filter((frame) => frame.method === "turn/start")).toEqual([]);
});

async function newLocalDraft(page: Page, cwd = "/demo/atlas-web") {
  await page.keyboard.press("Control+Shift+o");
  const dialog = page.getByRole("dialog", { name: "新建会话" });
  await dialog.getByLabel("工作目录").fill(cwd);
  await dialog.getByRole("button", { name: "创建会话", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-slot=composer-status]")).toContainText(
    "发送第一条消息后创建会话",
  );
}

test("local draft stays local when switching away and returning before its first message", async ({
  page,
}) => {
  await openFirst(page);
  await newLocalDraft(page);
  await input(page).fill("切换后还在的草稿");
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "thread/start",
    ),
  ).toHaveLength(0);
  await page
    .locator("[data-slot=thread-link]")
    .filter({ hasText: "接口分页与错误处理 · 10" })
    .first()
    .click();
  await page
    .locator("[data-slot=thread-link]")
    .filter({ hasText: "草稿" })
    .click();
  await expect(input(page)).toHaveText("切换后还在的草稿");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(
    fixtureServer.requestLog.some((request) =>
      request.threadId?.startsWith("local-draft-"),
    ),
  ).toBe(false);
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "thread/start",
    ),
  ).toHaveLength(0);
  await send(page, "真正发送后再创建");
  await completed(page);
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "thread/start",
    ),
  ).toHaveLength(1);
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "turn/start",
    ),
  ).toHaveLength(1);
  await expect(
    page.locator("[data-slot=thread-link]").filter({ hasText: "草稿" }),
  ).toHaveCount(0);
  await expect(page.locator("[data-slot=breadcrumb]")).toContainText(
    "真正发送后再创建",
  );
});

test("local draft creation failure preserves text and retries creation on the next send", async ({
  page,
}) => {
  await openFirst(page);
  await newLocalDraft(page);
  await send(page, "创建重试仍保留");
  await expect(
    page.getByRole("alert").filter({ hasText: "模拟创建失败" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.locator("[data-slot=global-error]")).toHaveCount(0);
  await expect(input(page)).toHaveText("");
  await expect(page.locator("[data-slot=local-message]")).toContainText(
    "创建重试仍保留",
  );
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "thread/start",
    ),
  ).toHaveLength(1);
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "turn/start",
    ),
  ).toHaveLength(0);
  await page
    .locator("[data-slot=thread-link]")
    .filter({ hasText: "接口分页与错误处理 · 10" })
    .first()
    .click();
  await page
    .locator("[data-slot=thread-link]")
    .filter({ hasText: "草稿" })
    .click();
  await page.getByRole("button", { name: "恢复到输入框", exact: true }).click();
  await expect(input(page)).toHaveText("创建重试仍保留");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await completed(page);
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "thread/start",
    ),
  ).toHaveLength(2);
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "turn/start",
    ),
  ).toHaveLength(1);
});

test("local draft send failure reuses its created server ID without reading an unsaved empty thread", async ({
  page,
}) => {
  await openFirst(page);
  await newLocalDraft(page);
  await send(page, "已创建等待发送");
  await expect(
    page.getByRole("alert").filter({ hasText: "模拟首条消息发送失败" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.locator("[data-slot=global-error]")).toHaveCount(0);
  await expect(input(page)).toHaveText("");
  await expect(page.locator("[data-slot=local-message]")).toContainText(
    "已创建等待发送",
  );
  const firstId = fixtureServer.requestLog.find(
    (request) => request.method === "turn/start",
  )?.threadId;
  await page
    .locator("[data-slot=thread-link]")
    .filter({ hasText: "接口分页与错误处理 · 10" })
    .first()
    .click();
  await page
    .locator("[data-slot=thread-link]")
    .filter({ hasText: "草稿" })
    .click();
  await expect(input(page)).toHaveText("");
  await expect(page.locator("[data-slot=local-message]")).toContainText(
    "已创建等待发送",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(
    fixtureServer.requestLog.filter(
      (request) =>
        request.threadId === firstId &&
        ["thread/read", "thread/resume"].includes(request.method),
    ),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "恢复到输入框", exact: true }).click();
  await expect(input(page)).toHaveText("已创建等待发送");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await completed(page);
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "thread/start",
    ),
  ).toHaveLength(1);
  expect(
    fixtureServer.requestLog
      .filter((request) => request.method === "turn/start")
      .map((request) => request.threadId),
  ).toEqual([firstId, firstId]);
});

test("local draft slow creation preserves edits made while the first message is being created", async ({
  page,
}) => {
  await openFirst(page);
  await newLocalDraft(page);
  await send(page, "最初提交的内容");
  await expect(page.locator("[data-slot=local-message]")).toContainText(
    "最初提交的内容",
  );
  await expect(page.locator("[data-slot=local-message]")).toHaveAttribute(
    "data-delivery-status",
    "creating",
  );
  const row = page.locator('[data-slot="thread-row"][data-selected="true"]');
  await expect(
    row.getByRole("img", { name: "正在创建会话", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-slot=composer-status]")).toContainText(
    "正在确认",
  );
  await expect(input(page)).toHaveText("");
  await expect(
    page
      .locator("[data-slot=local-message]")
      .getByRole("status", { name: "正在创建会话…" }),
  ).toBeVisible();
  await input(page).fill("创建期间的新草稿");
  await completed(page);
  await expect(row.locator('[data-slot="initializing-indicator"]')).toHaveCount(
    0,
  );
  await expect(input(page)).toHaveText("创建期间的新草稿");
  await expect(page.locator("[data-slot=local-message]")).toHaveCount(0);
  await expect(
    page.locator("[data-slot=conversation-turn]").last(),
  ).toContainText("最初提交的内容");
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "thread/start",
    ),
  ).toHaveLength(1);
});

test("workspace actions toggle individual groups, share context menus and copy summaries with loading feedback", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          sessionStorage.setItem("test-clipboard", text);
        },
      },
    });
  });
  await connect(page);
  const sidebar = page.locator('[data-slot="sidebar"]');
  const toggles = sidebar.locator('[data-slot="workspace-toggle"]');
  await expect(toggles.first()).toBeVisible();
  await sidebar
    .getByRole("button", { name: "折叠全部项目", exact: true })
    .click();
  await expect(
    sidebar.locator('[data-slot="workspace-toggle"][aria-expanded="true"]'),
  ).toHaveCount(0);
  await expect(sidebar.locator('[data-slot="thread-link"]')).toHaveCount(0);
  await sidebar
    .getByRole("button", { name: "展开全部项目", exact: true })
    .click();
  await expect(
    sidebar.locator('[data-slot="workspace-toggle"][aria-expanded="false"]'),
  ).toHaveCount(0);
  await toggles.first().click();
  await expect(toggles.first()).toHaveAttribute("aria-expanded", "false");
  await expect(toggles.nth(1)).toHaveAttribute("aria-expanded", "true");
  await toggles.first().click();
  await expect(toggles.first()).toHaveAttribute("aria-expanded", "true");
  const link = sidebar.locator('[data-slot="thread-link"]').first();
  await link.click();
  await expect(
    page.locator('[data-slot="conversation-loading"]'),
  ).toBeVisible();
  await expect(page.locator('[data-slot="conversation-loading"]')).toHaveCount(
    0,
  );
  await expect(
    page.locator('[data-slot="conversation-turn-footer"]').first(),
  ).toContainText("耗时");
  await link.click({ button: "right" });
  await expect(page.getByRole("menuitem")).toHaveText([
    "收藏会话",
    "重命名",
    "分叉会话",
    "移动到分区",
    "复制全部对话为 Markdown",
    "仅复制最终总结",
    "复制 Session ID",
    "导出会话",
    "归档",
    "永久删除",
  ]);
  await page
    .getByRole("menuitem", { name: "仅复制最终总结", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "已复制最终总结" }),
  ).toBeVisible();
  const summary = await page.evaluate(() =>
    sessionStorage.getItem("test-clipboard"),
  );
  const copyFinalAnswer = page
    .getByRole("button", { name: "复制最终回答", exact: true })
    .last();
  await copyFinalAnswer.click();
  await expect(copyFinalAnswer).toHaveText("已复制");
  expect(
    await page.evaluate(() => sessionStorage.getItem("test-clipboard")),
  ).toBe(summary);
});

test("external unloaded history updates automatically without sidebar status icons", async ({
  page,
}) => {
  await openFirst(page);
  const row = page.locator("[data-slot=thread-row][data-selected=true]");
  const footer = page.locator("[data-slot=conversation-turn-footer]").last();
  await expect(
    footer.getByText("执行状态待确认", { exact: true }),
  ).toBeVisible();
  await expect(row.getByRole("img", { name: "执行状态待确认" })).toHaveCount(0);
  await expect(row.locator("[data-slot=running-indicator]")).toHaveCount(0);
  await expect(
    page.locator("[data-slot=conversation-turn]").last(),
  ).toContainText("终端仍在执行", { timeout: 15000 });
  await expect(row.getByRole("img", { name: "内容已更新" })).toHaveCount(0);
  await expect(
    footer.getByText("执行状态待确认", { exact: true }),
  ).toBeVisible();
  await expect(row.locator("[data-slot=running-indicator]")).toHaveCount(0);
  await expect(row.getByRole("img", { name: "执行状态待确认" })).toHaveCount(0);
  await expect(row.getByRole("img", { name: "内容已更新" })).toHaveCount(0);
  expect(
    fixtureServer.requestLog.some((r) => r.method === "thread/resume"),
  ).toBe(false);
});

for (const permission of ["granted", "denied"] as const) {
  for (const scenario of [
    { input: "问题", title: "需要你回答问题", heading: "需要你的回答" },
    { input: "审批", title: "命令执行待审批", heading: "命令执行审批" },
    { input: "文件审批", title: "文件修改待审批", heading: "文件修改审批" },
  ]) {
    test(`action notification ${scenario.input} with ${permission} permission routes and clears`, async ({
      page,
    }) => {
      await page.addInitScript((permission) => {
        const notices: {
          title: string;
          closed: boolean;
          onclick: (() => void) | null;
        }[] = [];
        Object.defineProperty(window, "Notification", {
          configurable: true,
          value: class {
            static permission = permission;
            closed = false;
            onclick: (() => void) | null = null;
            constructor(public title: string) {
              notices.push(this);
            }
            close() {
              this.closed = true;
            }
          },
        });
        Object.defineProperty(window, "testActionNotifications", {
          value: notices,
        });
      }, permission);
      await openFirst(page);
      await send(page, scenario.input);
      const notice = page.locator('[data-slot="action-notification"]');
      await expect(notice).toContainText(scenario.title);
      await expect(
        page.getByRole("heading", { name: scenario.heading, exact: true }),
      ).toBeVisible();
      const native = () =>
        page.evaluate(() =>
          (
            window as unknown as {
              testActionNotifications: { title: string; closed: boolean }[];
            }
          ).testActionNotifications.map(({ title, closed }) => ({
            title,
            closed,
          })),
        );
      await expect
        .poll(native)
        .toEqual(
          permission === "granted"
            ? [{ title: scenario.title, closed: false }]
            : [],
        );
      await page
        .locator(
          '[data-slot="sidebar"] [data-slot="thread-link"]:not([aria-current="page"])',
        )
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: scenario.heading, exact: true }),
      ).toHaveCount(0);
      if (permission === "granted") {
        await page.evaluate(() =>
          (
            window as unknown as {
              testActionNotifications: { onclick: () => void }[];
            }
          ).testActionNotifications[0].onclick(),
        );
      } else await notice.locator("button").first().click();
      await expect(
        page.getByRole("heading", { name: scenario.heading, exact: true }),
      ).toBeVisible();
      if (scenario.input === "问题") {
        await page.getByRole("radio", { name: /^侧栏/ }).check();
        await page
          .getByLabel("输入虚构测试口令（请勿填写真实密钥）。")
          .fill("fictional-only");
        await page.getByRole("button", { name: "提交回答" }).click();
      } else
        await page
          .getByRole("button", { name: "允许一次", exact: true })
          .click();
      await expect(notice).toHaveCount(0);
      if (permission === "granted")
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                (
                  window as unknown as {
                    testActionNotifications: { closed: boolean }[];
                  }
                ).testActionNotifications[0].closed,
            ),
          )
          .toBe(true);
      await completed(page);
    });
  }
}

test("subagent completion, questions and approvals stay silent", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const titles: string[] = [];
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: class {
        static permission = "granted";
        constructor(title: string) {
          titles.push(title);
        }
        close() {}
      },
    });
    Object.defineProperty(window, "testChildNotifications", { value: titles });
  });
  await connect(page);
  await page.evaluate(() => {
    history.pushState(null, "", "/?env=local&session=mock-thread-010");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(input(page)).toBeVisible();
  await expect(
    page.locator("[data-slot=conversation-turn]").first(),
  ).toBeAttached();
  await send(page, "子代理完成测试");
  await completed(page);
  await expect(
    page.locator('[data-slot="completion-notification"]'),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { testChildNotifications: string[] })
          .testChildNotifications,
    ),
  ).toEqual([]);
  for (const input of ["问题", "审批", "文件审批"]) {
    await send(page, input);
    const heading =
      input === "问题"
        ? "需要你回答"
        : input === "审批"
          ? "命令执行审批"
          : "文件修改审批";
    if (input === "问题") {
      await expect(page.getByRole("radio", { name: /^侧栏/ })).toBeVisible();
    } else {
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
    }
    await expect(page.locator('[data-slot="action-notification"]')).toHaveCount(
      0,
    );
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { testChildNotifications: string[] })
            .testChildNotifications,
      ),
    ).toEqual([]);
    if (input === "问题") {
      await page.getByRole("radio", { name: /^侧栏/ }).check();
      await page
        .getByLabel("输入虚构测试口令（请勿填写真实密钥）。")
        .fill("fictional-only");
      await page.getByRole("button", { name: "提交回答" }).click();
    } else {
      await page.getByRole("button", { name: "允许一次", exact: true }).click();
    }
    await completed(page);
    await expect(
      page.locator('[data-slot="completion-notification"]'),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { testChildNotifications: string[] })
            .testChildNotifications,
      ),
    ).toEqual([]);
  }
});

test("message queue defaults to FIFO, edits in place and moves a task to the front", async ({
  page,
}) => {
  const frames = recordComposerFrames(page);
  await openFirst(page);
  await send(page, "慢速执行当前任务");
  await expect(page.getByRole("button", { name: "停止执行" })).toBeVisible();
  await input(page).fill("第一项待办");
  await input(page).press("Enter");
  const queue = page.getByRole("region", { name: "待发送任务", exact: true });
  await expect(queue).toContainText("第一项待办");
  await queue.getByRole("button", { name: "暂停队列", exact: true }).click();
  for (const text of ["第二项待办", "第三项待办"]) {
    await input(page).fill(text);
    await input(page).press("Enter");
    await expect(input(page)).toHaveText("");
  }
  await queue.getByRole("button", { name: "任务操作 3", exact: true }).click();
  await page.getByRole("menuitem", { name: "移到最前", exact: true }).click();
  await expect(queue.locator("[data-slot=queued-task]").first()).toContainText(
    "第三项待办",
  );
  await queue.getByRole("button", { name: "任务操作 1", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "移到最前", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑待发送任务" });
  await editor
    .getByRole("textbox", { name: "任务内容" })
    .fill("修改后的第三项");
  await editor.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(queue.locator("[data-slot=queued-task]").first()).toContainText(
    "修改后的第三项",
  );
  await queue.getByRole("button", { name: "任务操作 3", exact: true }).click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  await expect(queue.locator("[data-slot=queued-task]")).toHaveCount(2);
  expect(frames.filter((frame) => frame.method === "turn/steer")).toHaveLength(
    0,
  );
  await completed(page);
  await queue.getByRole("button", { name: "继续队列", exact: true }).click();
  await expect(queue).toBeHidden({ timeout: 15_000 });
  await expect
    .poll(() => frames.filter((frame) => frame.method === "turn/start").length)
    .toBe(3);
  const texts = frames
    .filter((frame) => frame.method === "turn/start")
    .map((frame) => (frame.params?.input as { text: string }[])[0].text);
  expect(texts).toEqual(["慢速执行当前任务", "修改后的第三项", "第一项待办"]);
});

test("message queue supports immediate steering and pauses when work is stopped", async ({
  page,
}) => {
  const frames = recordComposerFrames(page);
  await openFirst(page);
  await send(page, "慢速执行，等待后续方向");
  await expect(page.getByRole("button", { name: "停止执行" })).toBeVisible();
  for (const text of ["保留在队列", "改为立即引导"]) {
    await input(page).fill(text);
    await page.getByRole("button", { name: "排队发送", exact: true }).click();
    await expect(input(page)).toHaveText("");
  }
  const queue = page.getByRole("region", { name: "待发送任务", exact: true });
  await queue.getByRole("button", { name: "任务操作 2", exact: true }).click();
  await page.getByRole("menuitem", { name: "立即引导", exact: true }).click();
  await expect(queue.locator("[data-slot=queued-task]")).toHaveCount(1);
  await expect(
    page.locator("[data-slot=conversation-turn]").last(),
  ).toContainText("改为立即引导");
  await input(page).fill("快捷键引导");
  await input(page).press("Meta+Enter");
  await expect(input(page)).toHaveText("");
  await expect
    .poll(() => frames.filter((frame) => frame.method === "turn/steer").length)
    .toBe(2);
  await page.getByRole("button", { name: "停止执行", exact: true }).click();
  await expect(queue).toContainText("队列已暂停");
  expect(frames.filter((frame) => frame.method === "turn/start")).toHaveLength(
    1,
  );
});

test("message queue survives reload and asks before leaving with queued tasks", async ({
  page,
}) => {
  await openFirst(page);
  const title = await page.locator("[data-slot=breadcrumb] strong").innerText();
  await send(page, "慢速执行刷新前任务");
  await expect(page.getByRole("button", { name: "停止执行" })).toBeVisible();
  await input(page).fill("刷新后仍保留的队列任务");
  await input(page).press("Enter");
  const queue = page.getByRole("region", { name: "待发送任务", exact: true });
  await expect(queue).toContainText("刷新后仍保留的队列任务");
  await queue.getByRole("button", { name: "暂停队列", exact: true }).click();
  const dismissal = page.waitForEvent("dialog").then(async (dialog) => {
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
  });
  await page.evaluate(() => window.location.reload());
  await dismissal;
  await expect(queue).toContainText("刷新后仍保留的队列任务");
  const acceptance = page.waitForEvent("dialog").then(async (dialog) => {
    expect(dialog.type()).toBe("beforeunload");
    await dialog.accept();
  });
  await Promise.all([page.reload(), acceptance]);
  await page
    .locator("[data-slot=thread-link]")
    .filter({ hasText: title })
    .first()
    .click();
  await expect(input(page)).toBeVisible();
  await expect(queue).toContainText("刷新后仍保留的队列任务");
  await expect(queue).toContainText("检查后继续");
});

test("page exit protects hidden drafts and removes confirmation when all drafts are cleared", async ({
  page,
}) => {
  await openFirst(page);
  await input(page).fill("尚未发送的草稿");
  const title = await page.locator("[data-slot=breadcrumb] strong").innerText();
  await page
    .locator("[data-slot=thread-link]:not([aria-current=page])")
    .first()
    .click();
  await expect(input(page)).toHaveText("");
  const dismissal = page.waitForEvent("dialog").then(async (dialog) => {
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
  });
  await page.evaluate(() => window.location.reload());
  await dismissal;
  await page
    .locator("[data-slot=thread-link]")
    .filter({ hasText: title })
    .first()
    .click();
  await expect(input(page)).toHaveText("尚未发送的草稿");
  await input(page).fill("");
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.type());
    void dialog.dismiss();
  });
  await page.reload();
  expect(dialogs).toEqual([]);
});

test("default model preference persists, applies to new sessions and preserves existing models", async ({
  page,
}) => {
  const frames: { method?: string; params?: Record<string, unknown> }[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      try {
        frames.push(JSON.parse(String(frame.payload)));
      } catch {
        /* Ignore bridge messages. */
      }
    }),
  );
  await openFirst(page);
  const modelChoice = page.locator('[data-slot="model-choice"]');
  await expect(modelChoice).toContainText("Mock Codex");
  await page.locator("[data-settings-trigger]").first().click();
  const settings = page.getByRole("dialog", { name: "连接与设置" });
  await environmentScope(page, "模型与权限");
  await settings
    .getByRole("combobox", { name: "新建会话默认模型", exact: true })
    .click();
  await page.getByRole("option", { name: "自定义模型", exact: true }).click();
  await settings
    .getByLabel("自定义模型 ID", { exact: true })
    .fill("custom-model");
  await settings.getByRole("button", { name: "保存浏览器偏好" }).click();
  await expect(settings.getByRole("status")).toHaveText("浏览器偏好已保存");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("codex-workbench.default-model"),
    ),
  ).toBe("custom-model");
  expect(frames.some((frame) => frame.method === "config/value/write")).toBe(
    false,
  );
  await settings.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(modelChoice).toContainText("Mock Codex");
  const create = async () => {
    await page.getByRole("button", { name: /^新建会话/ }).click();
    const dialog = page.getByRole("dialog", { name: "新建会话" });
    await dialog.getByLabel("工作目录").fill("/demo/atlas-web");
    await dialog.getByRole("button", { name: "创建会话" }).click();
    await expect(dialog).toBeHidden();
  };
  await create();
  await expect(modelChoice).toContainText("custom-model");
  await send(page, "使用保存的默认模型");
  await completed(page);
  expect(
    frames.find((frame) => frame.method === "thread/start")?.params?.model,
  ).toBe("custom-model");
  expect(
    frames.find((frame) => frame.method === "turn/start")?.params?.model,
  ).toBe("custom-model");
  await page.reload();
  await expect(page.locator('[data-slot="thread-link"]').first()).toBeVisible();
  await create();
  await expect(modelChoice).toContainText("custom-model");
  await page.locator("[data-settings-trigger]").first().click();
  await environmentScope(page, "模型与权限");
  await expect(
    settings.getByRole("combobox", { name: "新建会话默认模型", exact: true }),
  ).toContainText("自定义模型");
  await expect(
    settings.getByLabel("自定义模型 ID", { exact: true }),
  ).toHaveValue("custom-model");
  await settings.getByRole("button", { name: "跟随设备默认" }).click();
  await expect(
    settings.getByRole("combobox", { name: "新建会话默认模型", exact: true }),
  ).toContainText("跟随设备默认模型");
  await expect(
    settings.getByLabel("自定义模型 ID", { exact: true }),
  ).toHaveCount(0);
  await settings.getByRole("button", { name: "保存浏览器偏好" }).click();
  await expect(settings.getByRole("status")).toHaveText("浏览器偏好已保存");
  await settings.getByRole("button", { name: "关闭", exact: true }).click();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("codex-workbench.default-model"),
    ),
  ).toBe("");
  const startsBefore = frames.filter(
    (frame) => frame.method === "thread/start",
  ).length;
  const turnsBefore = frames.filter(
    (frame) => frame.method === "turn/start",
  ).length;
  await create();
  await expect(modelChoice).toContainText("设备默认");
  await send(page, "跟随设备默认执行新会话");
  await completed(page);
  const started = frames.filter((frame) => frame.method === "thread/start")[
    startsBefore
  ];
  const turned = frames.filter((frame) => frame.method === "turn/start")[
    turnsBefore
  ];
  expect(started?.params).toBeDefined();
  expect(turned?.params).toBeDefined();
  expect(started!.params).not.toHaveProperty("model");
  expect(turned!.params).not.toHaveProperty("model");
  expect(turned!.params).not.toHaveProperty("effort");
});

test("operation lifecycle expands while running and collapses after success", async ({
  page,
}) => {
  // This test inspects individual tool controls; process folding is covered separately.
  await page.addInitScript(() =>
    localStorage.setItem("codex-workbench.auto-collapse-process", "false"),
  );
  await openFirst(page);
  await send(page, "operation-lifecycle");
  const command = page
    .locator("[data-slot=conversation-turn]")
    .last()
    .locator("[data-slot=conversation-tool]")
    .filter({ hasText: "npm run test" });
  await expect(command).toHaveAttribute("open", "");
  await expect(command).toHaveAttribute("data-status", "inProgress");
  expect(
    await command.evaluate((element) => {
      const style = getComputedStyle(element);
      const width =
        element.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      return Math.abs(
        element.querySelector("summary")!.getBoundingClientRect().width - width,
      );
    }),
  ).toBeLessThan(1);

  const batch = page
    .locator("[data-slot=conversation-turn]")
    .last()
    .locator('[data-slot="execution-summary"][data-category="run"]');
  await expect(batch).toHaveAttribute("data-status", "completed");
  await expect(batch.locator(":scope > summary")).toBeHidden();
  await expect(command).toHaveAttribute("data-status", "completed");
  await expect(command).not.toHaveAttribute("open");
  await command.locator("summary").click();
  await expect(command).toHaveAttribute("open", "");
  await expect(command).toContainText("24 tests passed");
});

test("operation turn folding keeps final summaries and restores inline progress", async ({
  page,
}) => {
  await openFirst(page);
  await send(page, "operation-lifecycle-progress");
  const turns = page.locator("#main [data-slot=conversation-turn]");
  const turn = turns.nth(2);
  const commentary = turn.getByText("中间进展：正在检查执行结果。", {
    exact: true,
  });
  await expect(commentary).toBeVisible();
  await expect(
    turn.locator("[data-slot=conversation-progress-message]"),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      turn.evaluate((element) => {
        const divider = element.querySelector(
          '[data-slot="turn-process-divider"]',
        )!;
        const progress = Array.from(element.querySelectorAll("article")).find(
          (article) => article.textContent === "中间进展：正在检查执行结果。",
        )!;
        const settled = [divider, progress].every(
          (node) =>
            node
              .closest(
                '[data-slot="conversation-process-motion"], [data-slot="conversation-message-motion"]',
              )!
              .getAnimations({ subtree: true }).length === 0,
        );
        // Both rectangles must come from the same layout frame.
        return (
          settled &&
          divider.getBoundingClientRect().bottom <=
            progress.getBoundingClientRect().top
        );
      }),
    )
    .toBe(true);
  await turn.getByRole("button", { name: "收起执行过程", exact: true }).click();
  await expect(commentary).toBeHidden();
  await expect(
    turn.getByText("operation-lifecycle-progress", { exact: true }),
  ).toBeVisible();
  await completed(page);
  const summary = turn.getByRole("heading", { name: "实施结果", exact: true });
  await expect(summary).toBeVisible();
  await expect(turn.locator("[data-slot=turn-process-divider] hr")).toHaveCount(
    1,
  );
  await expect(
    summary.locator("xpath=ancestor::article").locator(":scope > hr"),
  ).toHaveCount(0);
  await expect(commentary).toBeHidden();
  await expect(
    turn.locator("[data-slot=conversation-tool]").first(),
  ).toBeHidden();
  await expect(
    turn.getByText("operation-lifecycle-progress", { exact: true }),
  ).toBeVisible();
  await expect(
    turns.first().getByRole("button", { name: "收起执行过程", exact: true }),
  ).toHaveCount(0);
  const prompt = turn.getByText("operation-lifecycle-progress", {
    exact: true,
  });
  const toggle = turn.getByRole("button", {
    name: "展开执行过程",
    exact: true,
  });
  const promptBox = await prompt.boundingBox();
  const toggleBox = await toggle.boundingBox();
  const summaryBox = await summary.boundingBox();
  expect(toggleBox!.y).toBeGreaterThanOrEqual(promptBox!.y + promptBox!.height);
  expect(toggleBox!.y + toggleBox!.height).toBeLessThanOrEqual(summaryBox!.y);
  await turn.getByRole("button", { name: "展开执行过程", exact: true }).click();
  await expect(commentary).toBeVisible();
  await expect(summary).toBeVisible();
  await send(page, "operation-lifecycle-progress");
  const next = turns.last();
  await expect(
    next.getByText("中间进展：正在检查执行结果。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "停止执行", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止执行", exact: true }),
  ).toHaveCount(0);
  await expect(
    next.getByText("中间进展：正在检查执行结果。", { exact: true }),
  ).toBeVisible();
  await next.getByRole("button", { name: "收起执行过程", exact: true }).click();
  await expect(next.locator("footer")).toContainText("已中断");
  await next.getByRole("button", { name: "展开执行过程", exact: true }).click();
  await expect(
    next.getByText("中间进展：正在检查执行结果。", { exact: true }),
  ).toBeVisible();
});

test("operation summaries keep manual expansion and collapse through streamed command updates", async ({
  page,
}) => {
  // This test inspects individual tool controls; process folding is covered separately.
  await page.addInitScript(() =>
    localStorage.setItem("codex-workbench.auto-collapse-process", "false"),
  );
  await openFirst(page);
  await send(page, "operation-summary-updates");
  const turn = page.locator('#main [data-slot="conversation-turn"]').last();
  const summary = turn.locator('[data-slot="execution-summary"]').first();
  await expect(summary.locator(":scope > summary")).toHaveText(
    /执行了 3 条命令/,
  );
  // A pause between commands keeps the batch open; explicit choices take priority.
  await expect(summary).toHaveAttribute("open", "");
  await summary.locator(":scope > summary").click();
  await expect(summary).not.toHaveAttribute("open");
  await summary.locator(":scope > summary").click();
  await expect(summary).toHaveAttribute("open", "");
  const next = turn
    .locator('[data-slot="conversation-tool"]')
    .filter({ hasText: "summary-command-3" });
  await expect(next).toHaveAttribute("data-status", "inProgress");
  await expect(summary).toHaveAttribute("open", "");
  await expect(summary.locator(":scope > summary")).toHaveText(
    /执行了 4 条命令/,
  );
  await expect(summary).toHaveAttribute("open", "");
  await summary.locator(":scope > summary").click();
  await expect(summary).not.toHaveAttribute("open");
  // A manually collapsed batch keeps the live status in its header.
  await expect(summary).toHaveAttribute("data-status", "inProgress");
  await expect(summary.locator(":scope > summary")).toHaveText(
    /正在执行 5 条命令/,
  );
  await expect(summary).not.toHaveAttribute("open");
  await expect(summary.locator(":scope > summary")).toHaveText(
    /执行了 5 条命令/,
  );
  await expect(summary).not.toHaveAttribute("open");
  await completed(page);
  await summary.locator(":scope > summary").click();
  await expect(summary).toHaveAttribute("open", "");
  await send(page, "继续当前会话");
  await completed(page);
  const earlier = page.locator('#main [data-slot="conversation-turn"]').nth(2);
  await expect(
    earlier.locator('[data-slot="execution-summary"]').first(),
  ).toHaveAttribute("open", "");
  await earlier
    .locator('[data-slot="execution-summary"]')
    .first()
    .locator(":scope > summary")
    .click();
  await expect(
    earlier.locator('[data-slot="execution-summary"]').first(),
  ).not.toHaveAttribute("open");
});

test("operation lifecycle preserves manually opened results and allows reopening failures", async ({
  page,
}) => {
  // This test inspects individual tool controls; process folding is covered separately.
  await page.addInitScript(() =>
    localStorage.setItem("codex-workbench.auto-collapse-process", "false"),
  );
  await openFirst(page);
  await send(page, "operation-lifecycle");
  const command = page
    .locator("[data-slot=conversation-turn]")
    .last()
    .locator("[data-slot=conversation-tool]")
    .filter({ hasText: "npm run test" });
  await expect(command).toHaveAttribute("open", "");
  await command.locator("summary").click();
  await expect(command).not.toHaveAttribute("open");
  await command.locator("summary").click();
  await completed(page);
  await expect(command).toHaveAttribute("open", "");
  await command.locator("summary").click();
  await expect(command).not.toHaveAttribute("open");
  await command.locator("summary").click();
  await expect(command).toHaveAttribute("open", "");
  await send(page, "operation-error");
  const failed = page.locator(
    "[data-slot=conversation-tool][data-status=failed]",
  );
  await completed(page);
  const failedBatch = page
    .locator('[data-slot="conversation-turn"]')
    .last()
    .locator('[data-slot="execution-summary"][data-category="run"]');
  await expect(failedBatch.locator(":scope > summary")).toBeHidden();
  await expect(failed).toBeVisible();
  await expect(failed).not.toHaveAttribute("open");
  await failed.locator("summary").click();
  await expect(failed).toContainText("模拟命令执行错误");
});

test("agent details read child history without resuming or switching the parent", async ({
  page,
}) => {
  await openFirst(page);
  await send(page, "agent-detail");
  await completed(page);
  await expect(page.locator("[data-slot=conversation-agent-task]")).toHaveCount(
    0,
  );
  await expect(page.locator("[data-slot=agent-list]")).toHaveCount(0);
  const resumes = fixtureServer.requestLog.filter(
    (request) => request.method === "thread/resume",
  ).length;
  const mainBefore = await page.locator("#main").boundingBox();
  await page.locator("[data-slot=agent-entry]").click();
  const row = page.locator("[data-slot=agent-list-item]");
  await expect(row).toContainText("协议检查");
  await row.click();
  const drawer = page.getByRole("complementary", { name: "子代理 · 协议检查" });
  await expect(drawer).toContainText("子代理验证协议");
  await expect(drawer).toContainText("reviewer");
  await expect
    .poll(async () => (await page.locator("#main").boundingBox())?.width)
    .toBe(mainBefore?.width);
  await expect(
    page.getByRole("separator", { name: "调整详情宽度" }),
  ).toHaveCount(0);
  await expect(drawer.locator("[data-slot=conversation-timeline]")).toHaveCount(
    1,
  );
  await expect(
    drawer.getByRole("button", { name: "发送消息", exact: true }),
  ).toHaveCount(0);
  await expect(drawer.locator("[data-rollback]")).toHaveCount(0);
  await input(page).fill("抽屉打开时仍可编辑主会话");
  await expect(input(page)).toHaveText("抽屉打开时仍可编辑主会话");
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "thread/resume",
    ),
  ).toHaveLength(resumes);
  await drawer.getByRole("button", { name: "关闭子代理详情" }).click();
  await expect(page.locator("[data-slot=agent-entry]")).toBeFocused();
  await expect(
    page.locator("#main [data-slot=conversation-turn]").last(),
  ).toContainText("agent-detail");
});

test("mermaid rendering supports streaming, source copying, zoom and syntax fallback", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          sessionStorage.setItem("test-clipboard", text);
        },
      },
    }),
  );
  await openFirst(page);
  await send(page, "mermaid-test");
  const block = page.locator('[data-slot="mermaid-block"]').last();
  try {
    await expect(block).toContainText("图表生成中");
    await expect(block.locator('[data-slot="mermaid-svg"] > svg')).toHaveCount(
      0,
    );
  } finally {
    resumeMermaidStream();
  }
  await completed(page);
  await expect(block.locator('[data-slot="mermaid-svg"] > svg')).toBeVisible({
    timeout: 20000,
  });
  await expect(block.locator('[data-slot="mermaid-svg"]')).toContainText(
    "开始",
  );
  await block.getByRole("button", { name: "源码", exact: true }).click();
  await expect(block.locator("pre")).toContainText("flowchart LR");
  await block.getByRole("button", { name: "复制 Mermaid 源码" }).click();
  await expect(block.getByRole("status")).toContainText("已复制");
  expect(
    await page.evaluate(() => sessionStorage.getItem("test-clipboard")),
  ).toContain("flowchart LR");
  await block.getByRole("button", { name: "图表", exact: true }).click();
  await block.getByRole("button", { name: "放大图表", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Mermaid 图表",
    exact: true,
  });
  await expect(dialog.locator('[data-slot="mermaid-svg"] > svg')).toBeVisible();
  const originalWidth = await dialog
    .locator('[data-slot="mermaid-svg"] > svg')
    .evaluate((node) => node.getBoundingClientRect().width);
  await dialog.getByRole("button", { name: "放大一级" }).click();
  await expect(dialog).toContainText("125%");
  expect(
    await dialog
      .locator('[data-slot="mermaid-svg"] > svg')
      .evaluate((node) => node.getBoundingClientRect().width),
  ).toBeGreaterThan(originalWidth);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(block.locator('[data-slot="mermaid-svg"] > svg')).toBeVisible();
  const diagramNode = block
    .locator('[data-slot="mermaid-svg"] .node rect')
    .first();
  const lightFill = await diagramNode.evaluate(
    (node) => getComputedStyle(node).fill,
  );
  await page.locator("[data-settings-trigger]").first().click();
  const settings = page.getByRole("dialog", { name: "连接与设置" });
  await settings.getByRole("radio", { name: "深色", exact: true }).check();
  await settings.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(diagramNode).not.toHaveCSS("fill", lightFill);
  await expect(diagramNode).toHaveCSS(
    "fill",
    await themeColor(page, "surface"),
  );
  await page.evaluate(() => {
    const style = document.documentElement.style;
    style.setProperty("--font-scale", "1.25");
    style.setProperty("--font-sans", '"Arial", sans-serif');
  });
  const svg = block.locator('[data-slot="mermaid-svg"] > svg');
  await expect(svg).toHaveCSS("font-size", "20px");
  await expect(svg).toHaveCSS("font-family", "Arial, sans-serif");
  const turns = page.locator('[data-slot="conversation-turn"]');
  const turnCount = await turns.count();
  await send(page, "```mermaid\nthis is invalid diagram syntax\n```");
  await expect(turns).toHaveCount(turnCount + 1);
  const invalid = turns.last().locator('[data-slot="mermaid-block"]').first();
  await invalid.scrollIntoViewIfNeeded();
  await expect(invalid).toContainText("图表暂时无法显示", { timeout: 20000 });
  await expect(invalid.locator("pre code")).toContainText(
    "this is invalid diagram syntax",
  );
});

test("revert restores the sent message, preserves unsent text and focuses the composer", async ({
  page,
}) => {
  await openFirst(page);
  await send(page, "需要修改的原消息");
  await completed(page);
  await input(page).fill("未发送的补充内容");
  await page.locator("[data-rollback]").last().click();
  const rollbackDialog = page.getByRole("dialog", { name: "确认回滚对话？" });
  await expect(rollbackDialog).toContainText("已修改的文件会保留");
  await rollbackDialog
    .getByRole("button", { name: "确认回滚", exact: true })
    .click();
  await expect(input(page)).toContainText("需要修改的原消息");
  await expect(input(page)).toContainText("未发送的补充内容");
  await expect(input(page)).toBeFocused();
  await expect(page.locator('[data-slot="composer-status"]')).toContainText(
    "未发送草稿已保留",
  );
  await expect(
    page.locator('[data-slot="conversation-timeline"]'),
  ).not.toContainText("需要修改的原消息");
  await input(page).fill("修改后的新消息");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await completed(page);
  await expect(
    page.locator('[data-slot="conversation-timeline"]'),
  ).toContainText("修改后的新消息");
});

test("mermaid narrow view stays contained and disables diagram click links", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await openFirst(page);
  await send(
    page,
    '```mermaid\nflowchart LR\nA["开始<br>第一步"] --> B[安全显示]\nclick A "javascript:alert(1)"\n```',
  );
  await completed(page);
  const block = page.locator('[data-slot="mermaid-block"]').first();
  await block.scrollIntoViewIfNeeded();
  await expect(block.locator('[data-slot="mermaid-svg"] > svg')).toBeVisible({
    timeout: 20000,
  });
  await expect(block.locator('[data-slot="mermaid-svg"] a')).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
});

test("operation history preserves complete batches, errors and message order", async ({
  page,
}) => {
  // This test inspects individual tool controls; process folding is covered separately.
  await page.addInitScript(() =>
    localStorage.setItem("codex-workbench.auto-collapse-process", "false"),
  );
  await openFirst(page);
  await send(page, "operation-history");
  await completed(page);
  await send(page, "继续检查");
  await completed(page);
  const historical = page.locator("[data-slot=conversation-turn]").nth(2);
  await expect(
    historical.locator("[data-slot=earlier-operations]"),
  ).toHaveCount(0);
  const batch = historical.locator(
    '[data-slot="execution-summary"][data-category="run"]',
  );
  await expect(batch).toContainText("执行了 16 条命令");
  await expect(batch).toContainText("1 项需关注");
  await expect(batch).not.toHaveAttribute("open");
  await batch.locator(":scope > summary").click();
  await expect(historical.locator("[data-status=failed]")).not.toHaveAttribute(
    "open",
  );
  await historical.locator("[data-status=failed] > summary").click();
  await expect(historical).toContainText("保留历史错误原因");
  const commands = historical.locator('[data-item-type="commandExecution"]');
  await expect(commands).toHaveCount(16);
  await expect(commands.nth(1)).toContainText("history-command-0");
  await expect(commands.nth(14)).toContainText("history-command-13");
  await batch.locator(":scope > summary").click();
  await expect(batch).not.toHaveAttribute("open");
  await expect(batch).toContainText("1 项需关注");
  await batch.locator(":scope > summary").click();
  await expect(commands).toHaveCount(16);
});

test("nested operation logs hand wheel scrolling to the conversation at both edges", async ({
  page,
}) => {
  // This test inspects individual tool controls; process folding is covered separately.
  // Keep wheel handoff independent of disclosure height animations.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() =>
    localStorage.setItem("codex-workbench.auto-collapse-process", "false"),
  );
  await openFirst(page);
  await send(
    page,
    "operation-rich\n" +
      Array.from({ length: 60 }, (_, index) => `滚动接力 ${index}`).join("\n"),
  );
  await completed(page);
  const timeline = page.locator("[data-slot=conversation-timeline]");
  const viewport = timeline.locator(
    ":scope > [data-radix-scroll-area-viewport]",
  );
  const command = timeline
    .locator("[data-slot=conversation-turn]")
    .last()
    .locator("[data-slot=conversation-tool]")
    .filter({ hasText: "npm run test" });
  await command.locator(":scope > summary").click();
  const output = command.locator("[data-slot=operations-output]").first();
  await expect(output).toBeVisible();
  await expect(output).toHaveCSS("overscroll-behavior-y", "auto");
  await expect(viewport).toHaveCSS("overscroll-behavior-y", "contain");
  // Establish a reader position before Playwright scrolls the log into view.
  // Hover's automatic scroll alone is not a user scroll intent.
  // Use the viewport gutter so an expanded log cannot consume this first wheel.
  await viewport.hover({ position: { x: 4, y: 100 } });
  await page.mouse.wheel(0, -180);
  await expect(page.getByRole("button", { name: /回到底部/ })).toBeVisible();
  await output.hover();
  await output.evaluate((el) => {
    el.scrollTop = 0;
  });
  const beforeUp = await viewport.evaluate((el) => el.scrollTop);
  await page.mouse.wheel(0, -180);
  await expect
    .poll(() => viewport.evaluate((el) => el.scrollTop))
    .toBeLessThan(beforeUp - 20);
  await output.hover();
  await output.evaluate((el) => {
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - 100);
  });
  // Reach the lower edge with a native wheel before testing the handoff.
  // Fractional log line heights can give Chromium's compositor a different
  // lower limit than a scripted scrollTop = scrollHeight assignment.
  await page.mouse.wheel(0, 180);
  await expect
    .poll(() =>
      output.evaluate((el) =>
        Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop),
      ),
    )
    .toBeLessThanOrEqual(1);
  const beforeDown = await viewport.evaluate((el) => el.scrollTop);
  await page.mouse.wheel(0, 180);
  await expect
    .poll(() => viewport.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(beforeDown + 20);
});

test("operation rich details show full logs, selectable diffs, MCP progress and media", async ({
  page,
}) => {
  // This test inspects individual tool controls; process folding is covered separately.
  await page.addInitScript(() =>
    localStorage.setItem("codex-workbench.auto-collapse-process", "false"),
  );
  await openFirst(page);
  await send(page, "operation-rich");
  await completed(page);
  const turn = page.locator("[data-slot=conversation-turn]").last();
  const command = turn
    .locator("[data-slot=conversation-tool]")
    .filter({ hasText: "npm run test" });
  await expect(command).not.toHaveAttribute("open");
  await command.locator("summary").click();
  await expect(command).toContainText("日志第 100 行");
  const widths = await command.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      available:
        element.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight),
      content: element
        .querySelector('[data-slot="disclosure-content"]')!
        .getBoundingClientRect().width,
      title: element.querySelector("summary")!.getBoundingClientRect().width,
    };
  });
  expect(Math.abs(widths.content - widths.available)).toBeLessThan(1);
  expect(widths.title).toBeLessThan(widths.content);

  await expect(command).toContainText("完整输出末尾");
  await expect(command.getByRole("button", { name: "复制输出" })).toBeVisible();
  await expect(
    command.getByRole("button", { name: "查看完整输出" }),
  ).toHaveCount(0);
  await expect(command.locator(":scope > summary")).not.toContainText("已完成");
  await expect(command.locator(":scope > summary")).toContainText("秒");
  const changes = turn
    .locator("[data-slot=conversation-tool]")
    .filter({ hasText: "修改 2 个文件" });
  await changes.locator("summary").click();
  await changes.getByRole("button", { name: /src\/activity.ts/ }).click();
  await expect(changes).toContainText("+newState");
  await expect(changes).not.toContainText('+export const label = "工作区";');
  const mcp = turn
    .locator("[data-slot=conversation-tool]")
    .filter({ hasText: "demo · media-result" });
  await mcp.locator(":scope > summary").click();
  await expect(mcp).toContainText("媒体准备完成");
  await expect(mcp.getByRole("img", { name: "工具返回图片" })).toBeVisible();
  const preview = mcp.getByRole("button", {
    name: "预览图片 工具返回图片",
    exact: true,
  });
  await preview.click();
  await expect(
    page.getByRole("dialog", { name: "工具返回图片", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭图片预览", exact: true }).click();
  await expect(preview).toBeFocused();
  await expect(mcp.locator("audio")).toHaveCount(1);
  await expect(mcp.getByRole("link", { name: "参考资源" })).toHaveAttribute(
    "href",
    "https://example.com/resource",
  );
  await expect(mcp).toContainText("内嵌资源内容");
});

test("operation parallel items preserve phase expansion and manual choices", async ({
  page,
}) => {
  // This test inspects individual tool controls; process folding is covered separately.
  await page.addInitScript(() =>
    localStorage.setItem("codex-workbench.auto-collapse-process", "false"),
  );
  await openFirst(page);
  await send(page, "operation-parallel");
  const turn = page.locator("#main [data-slot=conversation-turn]").nth(2);
  const first = turn
    .locator("[data-slot=conversation-tool]")
    .filter({ hasText: "npm run test" });
  const second = turn
    .locator("[data-slot=conversation-tool]")
    .filter({ hasText: "parallel-check" });
  await expect(first).toHaveAttribute("open", "");
  await expect(second).toHaveAttribute("open", "");
  await expect(first).toHaveAttribute("data-status", "completed");
  await expect(second).toHaveAttribute("data-status", "inProgress");
  // Completing one command does not end the phase while its peer is running.
  await expect(first.locator(":scope > summary")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await first.locator(":scope > summary").click();
  await expect(first.locator(":scope > summary")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await first.locator(":scope > summary").click();
  await expect(first.locator(":scope > summary")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await completed(page);
  await expect(first.locator(":scope > summary")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(first).toHaveAttribute("open", "");
  await expect(second).not.toHaveAttribute("open");
  await first.locator("summary").click();
  await expect(first).not.toHaveAttribute("open");
  await first.locator("summary").click();
  await expect(first).toHaveAttribute("open", "");
  await first.locator("summary").click();
  await expect(first).not.toHaveAttribute("open");
  await expect(
    page.getByRole("button", { name: "全部展开", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "全部折叠", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "复制最终回答", exact: true }).last(),
  ).toBeVisible();
});

test("agent realtime details receive deltas and navigate nested agents without writers", async ({
  page,
}) => {
  await openFirst(page);
  await send(page, "agent-nested");
  await completed(page);
  const resumes = fixtureServer.requestLog.filter(
    (request) => request.method === "thread/resume",
  ).length;
  await page.locator("[data-slot=agent-entry]").click();
  await page.locator("[data-slot=agent-list-item]").click();
  const drawer = page.getByRole("complementary", { name: "子代理 · 协议检查" });
  await expect(drawer).toContainText("实时事件：检查连接");
  await expect(drawer).toContainText("已接收实时更新");
  await drawer
    .locator("details")
    .filter({ has: page.getByText("下级代理 · 1", { exact: true }) })
    .locator(":scope > summary")
    .click();
  await drawer
    .getByRole("button", { name: /查看下级代理：(验证日志|日志检查)/ })
    .click();
  const child = page.getByRole("complementary", { name: "子代理 · 日志检查" });
  await expect(child).toContainText("下级代理验证日志");
  await child
    .getByRole("navigation", { name: "子代理层级" })
    .getByRole("button", { name: "直接子代理" })
    .click();
  await expect(
    page.getByRole("complementary", { name: "子代理 · 协议检查" }),
  ).toContainText("子代理验证协议");
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "thread/resume",
    ),
  ).toHaveLength(resumes);
});

test("agent confirmation is discoverable from the composer entry and remains child scoped", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const titles: string[] = [];
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: class {
        static permission = "granted";
        constructor(title: string) {
          titles.push(title);
        }
        close() {}
      },
    });
    Object.defineProperty(window, "testAgentNotifications", { value: titles });
  });
  await openFirst(page);
  await send(page, "agent-confirmation");
  await completed(page);
  const entry = page.locator("[data-slot=agent-entry]");
  await expect(entry).toContainText("1 待处理");
  await expect(page.locator('[data-slot="action-notification"]')).toHaveCount(
    0,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { testAgentNotifications: string[] })
            .testAgentNotifications,
      ),
    )
    .toEqual(["会话已完成"]);
  await entry.click();
  await expect(page.locator("[data-slot=agent-list-item]")).toContainText(
    "等待确认",
  );
  await page.locator("[data-slot=agent-list-item]").click();
  const drawer = page.getByRole("complementary", { name: "子代理 · 协议检查" });
  await expect(drawer).toContainText("子代理检查连接需要确认");
  await drawer.getByRole("button", { name: "允许一次", exact: true }).click();
  await expect(drawer).toContainText("协议验证完成");
  await expect(page.locator('[data-slot="action-notification"]')).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { testAgentNotifications: string[] })
          .testAgentNotifications,
    ),
  ).toEqual(["会话已完成"]);
  await expect(
    page
      .locator("#main [data-slot=conversation-turn]")
      .last()
      .locator("[data-slot=conversation-turn-footer]"),
  ).toContainText("已完成");
});

test("agent reconnection resynchronizes child state without resuming a child writer", async ({
  page,
}) => {
  await openFirst(page);
  await send(page, "agent-reconnect");
  await completed(page);
  await page.locator("[data-slot=agent-entry]").click();
  const row = page.locator("[data-slot=agent-list-item]");
  const childId = await row.getAttribute("data-agent-id");
  await row.click();
  await expect(
    page.getByRole("complementary", { name: "子代理 · 协议检查" }),
  ).toContainText("子代理验证协议");
  await page.locator("[data-slot=connection-entry]").click();
  const settings = page.getByRole("dialog", { name: "连接与设置" });
  await settings.getByRole("tab", { name: "工作环境", exact: true }).click();
  await settings.getByRole("button", { name: "断开连接", exact: true }).click();
  await settings.getByRole("button", { name: "连接", exact: true }).click();
  await expect(settings).toBeHidden();
  await expect(
    page.getByRole("complementary", { name: "子代理 · 协议检查" }),
  ).toContainText("协议验证完成");
  expect(
    fixtureServer.requestLog.filter(
      (request) =>
        request.method === "thread/resume" && request.threadId === childId,
    ),
  ).toHaveLength(0);
  await expect(
    page.locator("#main [data-slot=conversation-turn]").last(),
  ).toContainText("agent-reconnect");
});

test("operation collapsing above the reader preserves the visible message position", async ({
  page,
}) => {
  // This test inspects individual tool controls; process folding is covered separately.
  await page.addInitScript(() =>
    localStorage.setItem("codex-workbench.auto-collapse-process", "false"),
  );
  await openFirst(page);
  await send(page, "operation-rich");
  await completed(page);
  const turn = page.locator("[data-slot=conversation-turn]").last();
  const command = turn
    .locator("[data-slot=conversation-tool]")
    .filter({ hasText: "npm run test" });
  await expect(command).not.toHaveAttribute("open");
  await command.locator(":scope > summary").click();
  // Start reading from the settled expanded layout, then verify the entire collapse.
  await expect
    .poll(() =>
      command
        .locator('xpath=ancestor::*[@data-slot="conversation-execution"][1]')
        .evaluate((el) =>
          [el, ...el.querySelectorAll('[data-slot="disclosure-content"]')].some(
            (element) => element.getAnimations().length > 0,
          ),
        ),
    )
    .toBe(false);
  const anchor = turn.locator("article").last();
  const before = await anchor.evaluate((element) => {
    const viewport = element
      .closest("[data-slot=conversation-timeline]")!
      .querySelector("[data-radix-scroll-area-viewport]")!;
    viewport.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -1, bubbles: true }),
    );
    viewport.scrollTop +=
      element.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top;
    return element.getBoundingClientRect().top;
  });
  await expect(page.getByRole("button", { name: /回到底部/ })).toBeVisible();
  // A keyboard/programmatic action must not scroll to the offscreen control.
  await command
    .locator(":scope > summary")
    .evaluate((element) => (element as HTMLElement).click());
  await expect(command).not.toHaveAttribute("open");
  await expect
    .poll(async () =>
      Math.abs(
        (await anchor.evaluate(
          (element) => element.getBoundingClientRect().top,
        )) - before,
      ),
    )
    .toBeLessThan(3);
});

test("workspace picker browses host folders, handles errors and completes paths with keyboard", async ({
  page,
}) => {
  await connect(page);
  await page.getByRole("button", { name: /^新建会话/ }).click();
  const dialog = page.getByRole("dialog", { name: "新建会话" });
  const path = dialog.getByLabel("工作目录", { exact: true });
  const initialBounds = await dialog.boundingBox();
  await path.fill("/demo/at");
  await expect(
    page.getByRole("option", { name: "atlas-web/", exact: true }),
  ).toBeVisible();
  expect((await dialog.boundingBox())?.height).toBe(initialBounds?.height);
  await path.press("ArrowDown");
  await path.press("Enter");
  await expect(path).toHaveValue("/demo/atlas-web/");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "浏览目录", exact: true }).click();
  const browser = dialog.getByRole("region", { name: "目录浏览器" });
  await expect(
    browser.getByRole("button", { name: "src", exact: true }),
  ).toBeVisible();
  await expect(
    browser.getByRole("button", { name: "README.md", exact: true }),
  ).toHaveCount(0);
  await browser.getByRole("button", { name: "src", exact: true }).click();
  await expect(browser).toContainText("此目录下没有子文件夹");
  await browser.getByRole("button", { name: "上级目录", exact: true }).click();
  await expect(
    browser.getByRole("button", { name: "src", exact: true }),
  ).toBeVisible();
  await browser.getByLabel("浏览路径").fill("/missing");
  await browser.getByRole("button", { name: "前往", exact: true }).click();
  await expect(browser).toContainText("无法读取目录");
  await expect(
    browser.getByRole("button", { name: "选择此目录" }),
  ).toBeDisabled();
  await browser.getByLabel("浏览路径").fill("/demo/中文项目");
  await browser.getByLabel("浏览路径").press("Enter");
  await expect(browser).toContainText("此目录下没有子文件夹");
  await browser.getByRole("button", { name: "选择此目录" }).click();
  await expect(path).toHaveValue("/demo/中文项目");
  await expect(browser).toBeHidden();
  await dialog.getByRole("button", { name: "使用默认目录" }).click();
  await expect(path).toHaveValue("");
});

test("initial operation history distinguishes completed thought and image from live thinking", async ({
  page,
}) => {
  await openFirst(page);
  const turn = page.locator("#main [data-slot=conversation-turn]").last();
  const thought = turn.locator('[data-item-type="reasoning"]').first();
  const image = turn
    .locator("[data-slot=conversation-tool]")
    .filter({ hasText: "查看图片" });
  const live = turn.locator('[data-item-type="reasoning"]').last();
  await expect(thought).toHaveAttribute("data-status", "completed");
  await expect(thought).not.toHaveAttribute("open");
  await expect(image).toHaveAttribute("data-status", "completed");
  await expect(image).not.toHaveAttribute("open");
  await expect(live).toHaveAttribute("data-status", "inProgress");
  await expect(live).toHaveAttribute("open", "");
  const emptyThought = turn.locator(
    '[data-expandable="false"][data-status="completed"]',
  );
  await expect(emptyThought).toHaveCount(0);
  const emptyLive = turn.locator(
    '[data-expandable="false"][data-status="inProgress"]',
  );
  await expect(emptyLive).toHaveText("正在思考");
  await expect(emptyLive.locator("summary")).toHaveCount(0);
  await expect(turn).not.toContainText("暂无内容");
  expect(
    fixtureServer.requestLog.some(
      (request) => request.method === "thread/items/list",
    ),
  ).toBe(true);
});

test("agent entry previews on hover, pins on click and restores keyboard focus", async ({
  page,
}) => {
  await openFirst(page);
  await send(page, "agent-detail");
  await completed(page);
  const entry = page.locator("[data-slot=agent-entry]");
  await expect(page.locator("[data-slot=agent-list]")).toHaveCount(0);
  await entry.hover();
  const list = page.locator("[data-slot=agent-list]");
  await expect(list).toBeVisible();
  await list.hover();
  await expect(list).toBeVisible();
  await page.locator("[data-slot=breadcrumb]").hover();
  await expect(list).toBeHidden();
  await entry.click();
  await page.locator("[data-slot=breadcrumb]").hover();
  await expect(list).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(entry).toBeFocused();
  await entry.press("ArrowDown");
  await expect(page.locator("[data-slot=agent-list-item]")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-slot=agent-drawer]")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "关闭子代理详情" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-slot=agent-drawer]")).toHaveCount(0);
  await expect(entry).toBeFocused();
});

test("execution density summarizes completed commands and keeps errors visible", async ({
  page,
}) => {
  // This test inspects individual tool controls; process folding is covered separately.
  await page.addInitScript(() =>
    localStorage.setItem("codex-workbench.auto-collapse-process", "false"),
  );
  await openFirst(page);
  await send(page, "operation-history");
  await completed(page);
  const turn = page.locator("#main [data-slot=conversation-turn]").last();
  const batch = turn.locator(
    '[data-slot="execution-summary"][data-category="run"]',
  );
  await expect(batch).toContainText("执行了 16 条命令");
  await expect(batch).toContainText("1 项需关注");
  await expect(batch).not.toHaveAttribute("open");
  await batch.locator(":scope > summary").click();
  const failed = turn.locator("[data-status=failed]");
  await expect(failed).toBeVisible();
  await expect(failed).not.toHaveAttribute("open");
  await failed.locator(":scope > summary").click();
  await expect(failed).toContainText("保留历史错误原因");
  await batch.locator(":scope > summary").click();
  await expect(batch).not.toHaveAttribute("open");
  await expect(batch).toContainText("1 项需关注");
  await batch.locator(":scope > summary").click();
  await expect(turn.locator('[data-item-type="commandExecution"]')).toHaveCount(
    16,
  );
});

test("agent drawer at 375px stays contained and returns to the main composer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await openFirst(page);
  await send(page, "agent-detail");
  await completed(page);
  await page.locator("[data-slot=agent-entry]").click();
  await page.locator("[data-slot=agent-list-item]").click();
  const drawer = page.getByRole("complementary", { name: "子代理 · 协议检查" });
  await expect(drawer).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
  await drawer.getByRole("button", { name: "关闭子代理详情" }).click();
  await expect(input(page)).toBeVisible();
  await expect(page.locator("[data-slot=agent-entry]")).toBeFocused();
});

test("conversation switches replace the viewport without stacking previous sessions", async ({
  page,
}) => {
  await openFirst(page);
  const firstIds = await page
    .locator("[data-slot=conversation-turn]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-turn-id")),
    );
  const timeline = page.locator("#main [data-slot=conversation-timeline]");
  const firstShell = await page
    .locator("#main [data-slot=conversation-timeline-shell]")
    .elementHandle();
  for (const title of [
    "接口分页与错误处理 · 3",
    "设计令牌与暗色模式 · 2",
    "接口分页与错误处理 · 10",
  ]) {
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", { name: "搜索会话" });
    await search.getByPlaceholder("搜索标题、摘要或工作区…").fill(title);
    await page.keyboard.press("Enter");
    await expect(search).toBeHidden();
    await expect(
      page.locator("#main [data-slot=breadcrumb] strong"),
    ).toHaveText(title);
    await expect(
      page.locator("#main [data-slot=conversation-turn]").first(),
    ).toBeAttached();
    await expect(
      page.locator("#main [data-slot=conversation-timeline-shell]"),
    ).toHaveCount(1);
    await expect(timeline).toHaveCount(1);
    await expect(input(page)).toBeVisible();
    const geometry = await page.locator("#main").evaluate((main) => {
      const bounds = main.getBoundingClientRect();
      const timelines = [
        ...main.querySelectorAll("[data-slot=conversation-timeline]"),
      ];
      const content = timelines[0].getBoundingClientRect();
      return {
        top: content.top,
        bottom: content.bottom,
        mainBottom: bounds.bottom,
        height: content.height,
        mainHeight: bounds.height,
      };
    });
    expect(geometry.height).toBeGreaterThan(100);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.mainBottom + 1);
    expect(geometry.height).toBeLessThan(geometry.mainHeight);
  }
  expect(await firstShell?.evaluate((element) => element.isConnected)).toBe(
    false,
  );
  expect(firstIds.length).toBeGreaterThan(0);
});

test("server history search opens matching summaries without acquiring a writer", async ({
  page,
}) => {
  await connect(page);
  expect(
    fixtureServer.requestLog.some(
      (request) => request.threadId === "mock-thread-090",
    ),
  ).toBe(false);
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "搜索会话" });
  await dialog
    .getByPlaceholder("搜索标题、摘要或工作区…")
    .fill("失败恢复演示 · 90");
  await expect(
    dialog.getByRole("option", { name: /失败恢复演示 · 90/ }),
  ).toBeVisible();
  await expect
    .poll(() =>
      fixtureServer.requestLog.some(
        (request) => request.searchTerm === "失败恢复演示 · 90",
      ),
    )
    .toBe(true);
  await dialog.getByRole("option", { name: /失败恢复演示 · 90/ }).click();
  await expect(dialog).toBeHidden();
  await expect(input(page)).toBeVisible();
  await expect(page.locator("[data-slot=topbar]")).toContainText(
    "失败恢复演示 · 90",
  );
  expect(
    fixtureServer.requestLog.some(
      (request) =>
        request.method === "thread/resume" &&
        request.threadId === "mock-thread-090",
    ),
  ).toBe(false);
});

test("additional approvals submit permission subsets and MCP forms safely", async ({
  page,
}) => {
  await openFirst(page);
  const threadId = "mock-thread-010";
  fixtureServer.publish({
    id: "permission-extra",
    method: "item/permissions/requestApproval",
    params: {
      threadId,
      turnId: "approval-turn",
      itemId: "permission-item",
      environmentId: null,
      startedAtMs: Date.now(),
      cwd: "/demo/atlas-web",
      reason: "读取共享文档",
      permissions: {
        network: { enabled: true },
        fileSystem: { read: ["/demo/shared"], write: null },
      },
    },
  });
  await page.getByRole("checkbox", { name: /网络权限/ }).uncheck();
  await page
    .getByRole("button", { name: "本轮允许所选权限", exact: true })
    .click();
  await expect
    .poll(
      () =>
        fixtureServer.responseLog.find(
          (reply) => reply.id === "permission-extra",
        )?.result,
    )
    .toEqual({
      scope: "turn",
      permissions: { fileSystem: { read: ["/demo/shared"], write: null } },
    });
  await expect(
    page.getByRole("button", { name: "本轮允许所选权限", exact: true }),
  ).toBeHidden();
  fixtureServer.publish({
    id: "mcp-form",
    method: "mcpServer/elicitation/request",
    params: {
      threadId,
      turnId: null,
      serverName: "demo",
      mode: "form",
      _meta: null,
      message: "确认发布目标",
      requestedSchema: {
        type: "object",
        properties: {
          target: { type: "string", title: "发布目标", minLength: 3 },
          region: { type: "string", title: "发布区域", enum: ["east", "west"] },
          confirmed: { type: "boolean", title: "确认发布" },
          capabilities: {
            type: "array",
            title: "发布能力",
            items: {
              anyOf: [
                { const: "read", title: "读取" },
                { const: "write", title: "写入" },
                { const: "", title: "默认" },
              ],
            },
            minItems: 1,
            maxItems: 2,
            default: ["read"],
          },
        },
        required: ["target", "region", "confirmed", "capabilities"],
      },
    },
  });
  await expect(
    page.getByRole("button", { name: "提交回答", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("发布目标", { exact: true }).fill("staging");
  await page.getByRole("combobox", { name: "发布区域", exact: true }).click();
  await page.getByRole("option", { name: "west", exact: true }).click();
  await page.getByRole("combobox", { name: "确认发布", exact: true }).click();
  await page.getByRole("option", { name: "否", exact: true }).click();
  const capabilities = page.getByRole("button", {
    name: "发布能力",
    exact: true,
  });
  await expect(capabilities).toHaveText("读取");
  const capabilitiesWidth = (await capabilities.boundingBox())!.width;
  await capabilities.click();
  const choices = page.getByRole("menu", { name: "发布能力", exact: true });
  expect(
    Math.abs((await choices.boundingBox())!.width - capabilitiesWidth),
  ).toBeLessThan(1);
  await expect(
    choices.getByRole("menuitemcheckbox", { name: "读取", exact: true }),
  ).toBeChecked();
  await choices
    .getByRole("menuitemcheckbox", { name: "写入", exact: true })
    .click();
  await expect(choices).toBeVisible();
  await choices
    .getByRole("menuitemcheckbox", { name: "默认", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "提交回答", exact: true }),
  ).toBeDisabled();
  await capabilities.press("ArrowDown");
  await choices
    .getByRole("menuitemcheckbox", { name: "读取", exact: true })
    .press("Space");
  await page.keyboard.press("Escape");
  await expect(capabilities).toHaveText("写入、默认");
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect
    .poll(
      () =>
        fixtureServer.responseLog.find((reply) => reply.id === "mcp-form")
          ?.result,
    )
    .toEqual({
      action: "accept",
      content: {
        target: "staging",
        region: "west",
        confirmed: false,
        capabilities: ["write", ""],
      },
      _meta: null,
    });
  fixtureServer.publish({
    id: "mcp-unsafe",
    method: "mcpServer/elicitation/request",
    params: {
      threadId,
      turnId: null,
      serverName: "demo",
      mode: "url",
      _meta: null,
      message: "无效授权地址",
      url: "javascript:alert(1)",
      elicitationId: "url-1",
    },
  });
  await expect(page.getByText("此请求的链接不安全，无法确认。")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "已完成，确认继续", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect
    .poll(
      () =>
        fixtureServer.responseLog.find((reply) => reply.id === "mcp-unsafe")
          ?.result,
    )
    .toEqual({ action: "cancel", content: null, _meta: null });
});

test("account limits and runtime notices are visible and refreshable", async ({
  page,
}) => {
  await openFirst(page);
  fixtureServer.publish({
    method: "configWarning",
    params: {
      summary: "测试配置未生效",
      details: "请检查环境配置",
      path: null,
      range: null,
    },
  });
  await expect(page.getByText(/测试配置未生效/)).toBeVisible();
  await page.getByRole("button", { name: "关闭通知", exact: true }).click();
  await expect(page.getByText(/测试配置未生效/)).toBeHidden();
  fixtureServer.publish({
    method: "model/rerouted",
    params: {
      threadId: "mock-thread-010",
      turnId: "notice-turn",
      fromModel: "mock-codex",
      toModel: "mock-safe",
      reason: "highRiskCyberActivity",
    },
  });
  await expect(
    page.getByText(/模型已切换：mock-codex → mock-safe/),
  ).toBeVisible();
  await page.locator("[data-settings-trigger]").first().click();
  const settings = page.getByRole("dialog", { name: "连接与设置" });
  await settings.getByRole("tab", { name: "工作环境", exact: true }).click();
  await expect(settings.getByText(/已用 25%/)).toBeVisible();
  const count = fixtureServer.requestLog.filter(
    (request) => request.method === "account/rateLimits/read",
  ).length;
  await settings.getByRole("button", { name: "刷新用量", exact: true }).click();
  await expect
    .poll(
      () =>
        fixtureServer.requestLog.filter(
          (request) => request.method === "account/rateLimits/read",
        ).length,
    )
    .toBeGreaterThan(count);
});

test("message queue supports configuring default steering and explicit queue overrides", async ({
  page,
}) => {
  const frames = recordComposerFrames(page);
  await openFirst(page);
  await page.locator("[data-settings-trigger]").first().click();
  const settings = page.getByRole("dialog", { name: "连接与设置" });
  const preference = settings.getByRole("combobox", {
    name: "执行中发送",
    exact: true,
  });
  await expect(preference).toContainText("排队（默认）");
  await preference.click();
  await page.getByRole("option", { name: "引导当前任务", exact: true }).click();
  await expect(settings.getByRole("status")).toHaveText("已保存");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("codex-workbench.running-send-mode"),
    ),
  ).toBe("steer");
  await page.keyboard.press("Escape");
  await send(page, "慢速执行，测试默认引导");
  await expect(
    page.getByRole("button", { name: "停止执行", exact: true }),
  ).toBeVisible();
  await input(page).fill("Enter 补充当前任务");
  await expect(page.locator("[data-slot=composer-action]")).toHaveAttribute(
    "aria-label",
    "立即引导",
  );
  await input(page).press("Enter");
  await expect
    .poll(() => frames.filter((frame) => frame.method === "turn/steer").length)
    .toBe(1);
  await expect(input(page)).toHaveText("");
  await input(page).fill("按钮单次排队");
  await page.getByRole("button", { name: "排队发送", exact: true }).click();
  const queue = page.getByRole("region", { name: "待发送任务", exact: true });
  await expect(queue).toContainText("按钮单次排队");
  await input(page).fill("快捷键单次排队");
  await input(page).press("Control+Shift+Enter");
  await expect(queue.locator("[data-slot=queued-task]")).toHaveCount(2);
  await input(page).fill("主按钮仍然引导");
  await page.locator("[data-slot=composer-action]").click();
  await expect
    .poll(() => frames.filter((frame) => frame.method === "turn/steer").length)
    .toBe(2);
  await page.locator("[data-settings-trigger]").first().click();
  await expect(preference).toContainText("引导当前任务");
  await preference.click();
  await page.getByRole("option", { name: "排队（默认）", exact: true }).click();
  await page.keyboard.press("Escape");
  await input(page).fill("恢复默认排队");
  await expect(page.locator("[data-slot=composer-action]")).toHaveAttribute(
    "aria-label",
    "排队发送",
  );
  await input(page).press("Enter");
  await expect(queue.locator("[data-slot=queued-task]")).toHaveCount(3);
  await page.getByRole("button", { name: "停止执行", exact: true }).click();
  await expect(queue).toContainText("队列已暂停");
});

test("operation auto collapse preference preserves summaries and manual reopening", async ({
  page,
}) => {
  await openFirst(page);
  await page.locator("[data-settings-trigger]").first().click();
  const settings = page.getByRole("dialog", { name: "连接与设置" });
  const toggle = settings.getByRole("switch", {
    name: "完成后自动收起执行过程",
    exact: true,
  });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("codex-workbench.auto-collapse-process"),
    ),
  ).toBe("true");
  await page.keyboard.press("Escape");
  await send(page, "operation-lifecycle-progress");
  const turns = page.locator("#main [data-slot=conversation-turn]");
  const turn = turns.nth(2);
  const progress = turn.getByText("中间进展：正在检查执行结果。", {
    exact: true,
  });
  await expect(progress).toBeVisible();
  await completed(page);
  await expect(progress).toBeHidden();
  await expect(
    turn.getByRole("heading", { name: "实施结果", exact: true }),
  ).toBeVisible();
  await expect(
    turn.getByText("operation-lifecycle-progress", { exact: true }),
  ).toBeVisible();
  await turn.getByRole("button", { name: "展开执行过程", exact: true }).click();
  await expect(progress).toBeVisible();
  await send(page, "operation-lifecycle-progress");
  const next = turns.last();
  const nextProgress = next.getByText("中间进展：正在检查执行结果。", {
    exact: true,
  });
  await expect(nextProgress).toBeVisible();
  await page.getByRole("button", { name: "停止执行", exact: true }).click();
  await expect(next.locator("footer")).toContainText("已中断");
  // Interrupted work stays visible so its incomplete state is not hidden.
  await expect(nextProgress).toBeVisible();
  await next.getByRole("button", { name: "收起执行过程", exact: true }).click();
  await expect(nextProgress).toBeHidden();
  await next.getByRole("button", { name: "展开执行过程", exact: true }).click();
  await expect(nextProgress).toBeVisible();
  await page.locator("[data-settings-trigger]").first().click();
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(nextProgress).toBeVisible();
});

test("configured machines appear before connecting and show connection errors on hover", async ({
  page,
}) => {
  await page.routeWebSocket("**/bridge", (socket) => {
    socket.onMessage(() => {
      setTimeout(
        () =>
          socket.send(
            JSON.stringify({
              type: "bridge/error",
              message: "模拟连接失败：本机服务未启动",
            }),
          ),
        1000,
      );
    });
  });
  await page.goto("/");
  const machines = page.getByRole("tablist", { name: "按工作环境筛选会话" });
  const local = machines.getByRole("tab", { name: "本机", exact: true });
  await expect(local).toBeVisible();
  await expect(local.locator("[data-slot=environment-status]")).toHaveAttribute(
    "aria-label",
    "未连接",
  );
  await local.locator("[data-slot=environment-icon]").hover();
  await expect(page.getByRole("tooltip")).toContainText("本机");
  await page
    .locator("[data-slot=connection-banner]")
    .getByRole("button", { name: "重新连接", exact: true })
    .click();
  await expect(local.locator("[data-slot=environment-status]")).toHaveAttribute(
    "aria-label",
    "连接中",
  );
  await expect(local.locator("[data-slot=environment-status]")).toHaveAttribute(
    "aria-label",
    "连接失败",
  );
  await page.getByRole("button", { name: "打开项目面板", exact: true }).hover();
  await local.locator("[data-slot=environment-icon]").hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "模拟连接失败：本机服务未启动",
  );
  await expect(page.locator("[data-slot=environment-projects]")).toContainText(
    "连接失败",
  );
});

test("user prompts preserve soft line breaks without changing submitted text", async ({
  page,
}) => {
  const frames = recordComposerFrames(page);
  await openFirst(page);
  const prompt = "> 查看 im-preview.aicoin.com 下 /api 的“后端服务”\n然后呢";
  await send(page, prompt);
  await completed(page);
  const message = page
    .locator('[data-slot="conversation-turn"]')
    .last()
    .locator("article")
    .first();
  await expect(message.locator("blockquote br")).toHaveCount(1);
  await expect(message.locator("blockquote")).toContainText("然后呢");
  expect(
    frames.find((frame) => frame.method === "turn/start")?.params?.input,
  ).toEqual([{ type: "text", text: prompt, text_elements: [] }]);
});

for (const width of [375, 1440]) {
  test(`typography settings at ${width}px apply, persist and reset without changing the theme`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const openSettings = async () => {
      if (width < 900) {
        await page.getByRole("button", { name: "打开导航" }).click();
        await page.locator("[data-slot=connection-entry]").click();
      } else {
        await page
          .getByRole("button", { name: "连接工作环境", exact: true })
          .click();
      }
      const settings = page.getByRole("dialog", { name: "连接与设置" });
      await settings.getByRole("tab", { name: "通用", exact: true }).click();
      return settings;
    };
    let dialog = await openSettings();
    await dialog.getByRole("radio", { name: "深色", exact: true }).check();
    const choose = async (label: string, option: string) => {
      await dialog.getByRole("combobox", { name: label, exact: true }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
    };
    await choose("代码字号", "16 px");
    await choose("界面基准字号", "21 px");
    await choose("界面字体", "系统字体");
    await choose("等宽字体", "Courier New");
    const preview = () => dialog.getByLabel("字体预览");
    await expect(preview().locator("p").first()).toHaveCSS("font-size", "21px");
    await expect(preview().locator("p").first()).toHaveCSS(
      "font-family",
      "system-ui, sans-serif",
    );
    await expect(preview().locator("p").last()).toHaveCSS("font-size", "16px");
    await expect(preview().locator("p").last()).toHaveCSS(
      "font-family",
      /Courier New/,
    );
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.reload();
    // Saved typography is applied before any settings controls are opened.
    await expect(page.locator("body")).toHaveCSS("font-size", "21px");
    dialog = await openSettings();
    await expect(
      dialog.getByRole("combobox", { name: "界面基准字号", exact: true }),
    ).toHaveText("21 px");
    await expect(
      dialog.getByRole("combobox", { name: "代码字号", exact: true }),
    ).toHaveText("16 px");
    await expect(
      dialog.getByRole("combobox", { name: "界面字体", exact: true }),
    ).toHaveText("系统字体");
    await expect(
      dialog.getByRole("combobox", { name: "等宽字体", exact: true }),
    ).toHaveText("Courier New");
    await dialog
      .getByRole("button", { name: "重置字体设置", exact: true })
      .click();
    await expect(preview().locator("p").first()).toHaveCSS("font-size", "14px");
    await expect(preview().locator("p").last()).toHaveCSS("font-size", "13px");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(
      dialog.getByRole("button", { name: "重置字体设置", exact: true }),
    ).toBeDisabled();
    await page.reload();
    await expect(page.locator("body")).toHaveCSS("font-size", "14px");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
}

test("prompt dots jump and restore the reading position", async ({ page }) => {
  await openFirst(page);
  await send(page, "目录导航验证");
  await completed(page);
  // The saved scroll position should be measured after automatic folding settles.
  await expect
    .poll(() =>
      page
        .locator('[data-slot="conversation-timeline"]')
        .evaluate((el) =>
          Array.from(
            el.querySelectorAll('[data-slot="disclosure-content"]'),
          ).some((body) => body.getAnimations().length > 0),
        ),
    )
    .toBe(false);
  const viewport = page.locator(
    '[data-slot="conversation-timeline"] > [data-radix-scroll-area-viewport]',
  );
  const before = await viewport.evaluate((el) => el.scrollTop);
  await page
    .getByRole("navigation", { name: "会话轮次导航" })
    .locator(".prompt-dot")
    .first()
    .click();
  await expect(page.locator("[data-prompt-id]").first()).toBeInViewport();
  await page.getByRole("button", { name: "返回阅读位置", exact: true }).click();
  await expect
    .poll(async () =>
      Math.abs((await viewport.evaluate((el) => el.scrollTop)) - before),
    )
    .toBeLessThan(5);
});

test("composer multiline arrows and line boundary keys keep the caret in the requested line", async ({
  page,
}) => {
  await openFirst(page);
  const editor = input(page);
  await editor.fill("first line");
  await editor.press("End");
  await editor.press("Shift+Enter");
  await page.keyboard.insertText("second line");
  await editor.press("Shift+Enter");
  await page.keyboard.insertText("third line");
  await expect
    .poll(() => editor.innerText())
    .toBe("first line\nsecond line\nthird line");
  const caret = () =>
    editor.evaluate(() => {
      const selection = window.getSelection()!;
      return {
        text: selection.focusNode?.textContent,
        offset: selection.focusOffset,
      };
    });
  await editor.press("ArrowUp");
  await expect.poll(async () => (await caret()).text).toBe("second line");
  await editor.press("ArrowDown");
  await expect.poll(async () => (await caret()).text).toBe("third line");
  await editor.press("Home");
  await expect.poll(caret).toEqual({ text: "third line", offset: 0 });
  await editor.press("End");
  await expect.poll(caret).toEqual({ text: "third line", offset: 10 });
  await editor.press("Shift+Home");
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe("third line");
  await editor.press("Control+Home");
  await expect.poll(caret).toEqual({ text: "first line", offset: 0 });
  await editor.press("Control+End");
  await expect.poll(caret).toEqual({ text: "third line", offset: 10 });
  expect(
    fixtureServer.requestLog.filter(
      (request) => request.method === "turn/start",
    ),
  ).toHaveLength(0);
});

test("composer navigation follows visual wrapped lines and preserves shift selection", async ({
  page,
}) => {
  await openFirst(page);
  const editor = input(page);
  const text = "word ".repeat(120) + "end";
  await editor.fill(text);
  await editor.press("Control+End");
  await editor.press("ArrowUp");
  const offset = () =>
    editor.evaluate(() => window.getSelection()!.focusOffset);
  const previousLine = await offset();
  expect(previousLine).toBeGreaterThan(0);
  expect(previousLine).toBeLessThan(text.length);
  await editor.press("Home");
  expect(await offset()).toBeLessThan(previousLine);
  await editor.press("Shift+End");
  await expect
    .poll(() =>
      page.evaluate(() => window.getSelection()?.toString().length ?? 0),
    )
    .toBeGreaterThan(0);
  await expect(editor).toHaveText(text);
});

test("composer mac line shortcuts and modified arrows bypass file completions", async ({
  page,
}) => {
  test.skip(
    !(await page.evaluate(() => /Mac/.test(navigator.platform))),
    "Mac keyboard shortcuts",
  );
  await openFirst(page);
  const editor = input(page);
  await editor.fill("before @src");
  await expect(page.getByRole("listbox", { name: /./ })).toBeVisible();
  await editor.press("Meta+ArrowLeft");
  await page.keyboard.insertText("START ");
  await expect(editor).toHaveText("START before @src");
  await editor.press("Meta+ArrowRight");
  await page.keyboard.insertText(" END");
  await expect(editor).toHaveText("START before @src END");
});
