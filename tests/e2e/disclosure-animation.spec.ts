import { expect, test, type Locator, type Page } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";
import type { Turn } from "../../src/generated/v2/Turn";

let server: ReturnType<typeof createMockServer>;
test.beforeEach(async ({ page }) => {
  server = createMockServer({
    initialActiveOperations: test
      .info()
      .title.startsWith("initial conversation"),
    initialOperationItems: Array.from({ length: 3 }, (_, index) => ({
      ...liveCommand(`historical-summary-${index}`),
      status: "completed",
      exitCode: 0,
      durationMs: 100,
    })),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing address");
  await page.route("**/codex-release", (route) =>
    route.fulfill({ json: { version: "0.160.0" } }),
  );
  await page.addInitScript(
    (url) =>
      localStorage.setItem(
        "codex-environments",
        JSON.stringify([
          { id: "local", name: "本机", kind: "local", url, autoConnect: true },
        ]),
      ),
    `ws://127.0.0.1:${address.port}`,
  );
});
test.afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

async function start(
  page: Page,
  foldProcess = true,
  text = "operation-lifecycle-progress",
) {
  if (!foldProcess)
    await page.addInitScript(() =>
      localStorage.setItem("codex-workbench.auto-collapse-process", "false"),
    );
  await page.goto("/?env=local&session=mock-thread-001");
  const editor = page.getByRole("textbox", { name: "消息输入框" });
  await expect(page.locator("[data-prompt-id]").first()).toBeAttached();
  await editor.fill(text);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const turn = page.locator('[data-slot="conversation-turn"]').last();
  const command = turn.locator('[data-item-type="commandExecution"]').first();
  await expect(command.locator(":scope > summary")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  // Sample only the collapse, after the initial expansion has settled.
  await expect
    .poll(() =>
      command.evaluate(
        (el) =>
          el.querySelector('[data-slot="disclosure-content"]')!.getAnimations()
            .length,
      ),
    )
    .toBe(0);
  await settleEntrance(turn);
  return { turn, command };
}

async function settleEntrance(section: Locator) {
  await expect
    .poll(() =>
      section
        .locator(
          '[data-slot="conversation-execution"], [data-slot="conversation-message-motion"], [data-slot="conversation-process-motion"]',
        )
        .evaluateAll((elements) =>
          elements.some(
            (el) =>
              el.getAnimations().length > 0 ||
              (el.firstElementChild?.getAnimations().length ?? 0) > 0,
          ),
        ),
    )
    .toBe(false);
}

async function sampleCollapse(disclosure: Locator) {
  return disclosure.evaluate(
    (element) =>
      new Promise<{ heights: number[]; retained: boolean; animated: boolean }>(
        (resolve, reject) => {
          const body = element.querySelector<HTMLElement>(
            ':scope > [data-slot="disclosure-content"]',
          )!;
          const heights: number[] = [];
          let animated = false;
          let retained = true;
          const started = performance.now();
          const frame = () => {
            heights.push(body.getBoundingClientRect().height);
            const animation = body.getAnimations()[0];
            if (animation && !animated) {
              animated = true;
              // Sample the animation clock directly so a busy runner cannot skip frames.
              animation.pause();
              const duration = Number(animation.effect!.getTiming().duration);
              for (const progress of [
                0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 1,
              ]) {
                animation.currentTime = duration * progress;
                heights.push(body.getBoundingClientRect().height);
                retained &&= !!body.textContent?.trim();
              }
              animation.finish();
            }
            if (body.hidden || !body.isConnected)
              return resolve({ heights, retained, animated });
            if (performance.now() - started > 6000)
              return reject(Error("Disclosure did not collapse"));
            requestAnimationFrame(frame);
          };
          frame();
        },
      ),
  );
}

function expectSmoothCollapse(
  result: Awaited<ReturnType<typeof sampleCollapse>>,
) {
  const initial = result.heights[0];
  expect(initial).toBeGreaterThan(20);
  expect(result.animated).toBe(true);
  expect(result.retained).toBe(true);
  expect(result.heights.at(-1)).toBe(0);
  expect(
    new Set(
      result.heights.filter((height) => height > 1 && height < initial - 1),
    ).size,
  ).toBeGreaterThanOrEqual(3);
}

async function expectStaysExpanded(disclosure: Locator) {
  expect(
    await disclosure.evaluate(
      (element) =>
        new Promise<boolean>((resolve) => {
          const started = performance.now();
          const frame = () => {
            if (
              element
                .querySelector(":scope > summary")
                ?.getAttribute("aria-expanded") !== "true"
            )
              return resolve(false);
            if (performance.now() - started >= 1200) return resolve(true);
            requestAnimationFrame(frame);
          };
          frame();
        }),
    ),
  ).toBe(true);
}

test("completed operations retain their output throughout the height animation", async ({
  page,
}) => {
  const { turn, command } = await start(page, false);
  expectSmoothCollapse(await sampleCollapse(command));
  const batch = turn.locator('[data-slot="execution-summary"]').first();
  await expect(batch.locator(":scope > summary")).toBeHidden();
  await expect(command).not.toHaveAttribute("open");
  await command.locator(":scope > summary").click();
  await expect(command).toContainText("24 tests passed");
});

test("automatic process folding animates without losing bottom following", async ({
  page,
}) => {
  const { turn } = await start(page);
  const progress = turn.getByText("中间进展：正在检查执行结果。", {
    exact: true,
  });
  const disclosure = progress.locator("xpath=ancestor::div[@id][1]");
  expectSmoothCollapse(await sampleCollapse(disclosure));
  await expect(
    turn.getByRole("heading", { name: "实施结果", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /回到底部/ })).toBeHidden();
  await expect
    .poll(() =>
      page
        .locator(
          '[data-slot="conversation-timeline"] [data-radix-scroll-area-viewport]',
        )
        .first()
        .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
    )
    .toBeLessThan(3);
});

test("live growth and automatic folding complete without ResizeObserver loops", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const errors: string[] = [];
    Object.assign(window, { playbackResizeErrors: errors });
    window.addEventListener("error", (event) => {
      if (event.message.includes("ResizeObserver loop"))
        errors.push(event.message);
    });
  });
  // Let every entrance, streamed update, and automatic fold play on the browser
  // clock: pausing a height animation can hide observer feedback between frames.
  const { turn } = await start(page);
  await expect(
    turn.locator('[data-slot="conversation-turn-footer"]'),
  ).toContainText("已完成");
  await expect(
    turn.getByRole("heading", { name: "实施结果", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      turn.evaluate(
        (element) => element.getAnimations({ subtree: true }).length,
      ),
    )
    .toBe(0);
  // Observer errors are dispatched after the rendering step. Cross another frame
  // after the final animation releases its height before reading the collection.
  const errors = await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    return (window as unknown as { playbackResizeErrors: string[] })
      .playbackResizeErrors;
  });
  expect(errors).toEqual([]);
});

test("reopening during collapse continues from the visible height", async ({
  page,
}) => {
  const { command } = await start(page, false, "operation-parallel");
  await expect(command).toHaveAttribute("data-status", "completed");
  await command.locator(":scope > summary").click();
  await expect(command).not.toHaveAttribute("open");
  const result = await command.evaluate(async (element) => {
    const summary = element.querySelector<HTMLElement>(":scope > summary")!;
    const body = element.querySelector<HTMLElement>(
      ':scope > [data-slot="disclosure-content"]',
    )!;
    const frame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    summary.click();
    await frame();
    body.getAnimations()[0].finish();
    await frame();
    const full = body.getBoundingClientRect().height;
    summary.click();
    await frame();
    const closing = body.getAnimations()[0];
    closing.pause();
    closing.currentTime = 100;
    const before = body.getBoundingClientRect().height;
    const retained = body.textContent?.includes("24 tests passed");
    summary.click();
    await frame();
    const reopening = body.getAnimations()[0];
    reopening.pause();
    reopening.currentTime = 0;
    const after = body.getBoundingClientRect().height;
    reopening.currentTime = 5;
    const continued = body.getBoundingClientRect().height;
    reopening.finish();
    await frame();
    return {
      full,
      before,
      after,
      continued,
      retained,
      final: body.getBoundingClientRect().height,
    };
  });
  expect(result.before).toBeGreaterThan(0);
  expect(result.before).toBeLessThan(result.full);
  expect(result.after).toBeCloseTo(result.before, 0);
  expect(result.continued).toBeLessThan(result.before);
  expect(result.retained).toBe(true);
  expect(result.final).toBeCloseTo(result.full, 0);
  await expect(command.locator(":scope > summary")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});

test("reduced motion folds immediately without starting height animations", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { turn, command } = await start(page, false);
  const result = await sampleCollapse(command);
  expect(result.animated).toBe(false);
  expect(result.heights.at(-1)).toBe(0);
  const batch = turn.locator('[data-slot="execution-summary"]').first();
  await expect(batch.locator(":scope > summary")).toBeHidden();
  await expect(command).not.toHaveAttribute("open");
  await command.locator(":scope > summary").click();
  await expect(command).toContainText("24 tests passed");
});

function liveCommand(
  id: string,
): Extract<ThreadItem, { type: "commandExecution" }> {
  return {
    type: "commandExecution",
    id,
    command: `check-${id}`,
    cwd: "/demo/atlas-web",
    pluginId: null,
    scriptPath: null,
    processId: null,
    source: "agent",
    status: "inProgress",
    commandActions: [],
    aggregatedOutput: null,
    exitCode: null,
    durationMs: null,
  };
}

async function controlledTurn(page: Page) {
  await page.goto("/?env=local&session=mock-thread-001");
  await expect(page.locator("[data-prompt-id]").first()).toBeAttached();
  const turn: Turn = {
    id: "controlled-animation-turn",
    rootTurnId: null,
    items: [
      {
        type: "userMessage",
        id: "controlled-prompt",
        clientId: null,
        content: [
          { type: "text", text: "检查执行中的动画", text_elements: [] },
        ],
      },
    ],
    itemsView: "full",
    status: "inProgress",
    error: null,
    startedAt: Math.floor(Date.now() / 1000),
    completedAt: null,
    durationMs: null,
  };
  const base = { threadId: "mock-thread-001", turnId: turn.id };
  server.publish({
    method: "turn/started",
    params: { threadId: base.threadId, turn },
  });
  const section = page.locator(`[data-turn-id="${turn.id}"]`);
  await expect(section).toBeVisible();
  return { base, section, turn };
}

for (const status of ["completed", "failed"] as const) {
  test(`execution spacing stays fixed when a task becomes ${status}`, async ({
    page,
  }) => {
    const { base, section } = await controlledTurn(page);
    const item = liveCommand("spacing-command");
    server.publish({ method: "item/started", params: { ...base, item } });
    const command = section.locator('[data-reading-id="spacing-command"]');
    await expect(command).toHaveAttribute("open");
    await settleEntrance(section);
    const gap = () =>
      section.evaluate((element) => {
        const execution = element.querySelector(
          '[data-slot="conversation-execution"]',
        )!;
        const divider = element.querySelector(
          '[data-slot="turn-process-divider"]',
        )!;
        const row = execution.querySelector('[data-slot="conversation-tool"]')!;
        return {
          container:
            execution.getBoundingClientRect().top -
            divider.getBoundingClientRect().bottom,
          row:
            row.getBoundingClientRect().top -
            divider.getBoundingClientRect().bottom,
        };
      });
    const before = await gap();
    server.publish({
      method: "item/completed",
      params: {
        ...base,
        item: {
          ...item,
          status,
          exitCode: status === "failed" ? 1 : 0,
          durationMs: 100,
        },
      },
    });
    await expect(command).toHaveAttribute("data-status", status);
    await expect(command).toHaveAttribute("open");
    const after = await gap();
    expect(Math.abs(after.container - before.container)).toBeLessThan(1);
    expect(Math.abs(after.row - before.row)).toBeLessThan(1);
  });
}

for (const status of ["completed", "interrupted"] as const) {
  test(`an empty ${status} thinking record leaves no extra conversation spacing`, async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem("codex-workbench.auto-collapse-process", "false"),
    );
    const { base, section, turn } = await controlledTurn(page);
    const messages: ThreadItem[] = [
      "before",
      "reference",
      "previous",
      "after",
    ].map((id) => ({
      type: "agentMessage",
      id: `spacing-${id}`,
      text: "间距参照消息。",
      phase: "commentary",
      memoryCitation: null,
      delivery: null,
      questions: null,
    }));
    for (const item of messages.slice(0, 3))
      server.publish({ method: "item/completed", params: { ...base, item } });
    const thought: ThreadItem = {
      type: "reasoning",
      id: "empty-spacing-thought",
      summary: ["  "],
      content: [],
    };
    server.publish({
      method: "item/started",
      params: { ...base, item: thought },
    });
    await expect(section.getByText("正在思考", { exact: true })).toBeVisible();
    if (status === "completed")
      server.publish({
        method: "item/completed",
        params: { ...base, item: thought },
      });
    server.publish({
      method: "item/completed",
      params: { ...base, item: messages[3] },
    });
    if (status === "interrupted") {
      server.publish({
        method: "turn/completed",
        params: {
          threadId: base.threadId,
          turn: {
            ...turn,
            status,
            items: [
              ...turn.items,
              ...messages.slice(0, 3),
              thought,
              messages[3],
            ],
          },
        },
      });
      await expect(section.locator("footer")).toContainText("已中断");
    }
    await expect(
      section.locator('[data-reading-id="spacing-after"]'),
    ).toBeVisible();
    await expect(
      section.locator('[data-slot="conversation-tool"]'),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        section.evaluate(
          (element) => element.getAnimations({ subtree: true }).length,
        ),
      )
      .toBe(0);
    const gaps = await section.evaluate((element) => {
      const rect = (id: string) =>
        element
          .querySelector(`[data-reading-id="spacing-${id}"]`)!
          .getBoundingClientRect();
      return {
        reference: rect("reference").top - rect("before").bottom,
        withEmptyRecord: rect("after").top - rect("previous").bottom,
      };
    });
    expect(Math.abs(gaps.withEmptyRecord - gaps.reference)).toBeLessThan(1);
    await expect(
      section.locator('[data-slot="conversation-execution"]'),
    ).toHaveCSS("height", "0px");
  });
}

test("execution animation releases its height without shifting the following content", async ({
  page,
}) => {
  const { base, section } = await controlledTurn(page);
  const item = liveCommand("height-release-command");
  server.publish({ method: "item/started", params: { ...base, item } });
  const command = section.locator('[data-reading-id="height-release-command"]');
  await expect(command).toHaveAttribute("open");
  await settleEntrance(section);
  const execution = section.locator('[data-slot="conversation-execution"]');
  await execution.evaluate((element) => {
    const original = element.animate;
    element.animate = function (...args) {
      const animation = original.apply(this, args);
      animation.pause();
      return animation;
    };
  });
  server.publish({
    method: "item/commandExecution/outputDelta",
    params: {
      ...base,
      itemId: item.id,
      delta: Array.from(
        { length: 20 },
        (_, index) => `高度参照输出 ${index}`,
      ).join("\n"),
    },
  });
  await expect(command).toContainText("高度参照输出 19");
  await expect
    .poll(() => execution.evaluate((element) => element.getAnimations().length))
    .toBe(1);
  const before = await execution.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.currentTime = Number(animation.effect!.getTiming().duration);
    const viewport = element.closest("[data-radix-scroll-area-viewport]")!;
    const footer = element.closest("[data-turn-id]")!.querySelector("footer")!;
    const measured = {
      height: element.getBoundingClientRect().height,
      footer: footer.getBoundingClientRect().top + viewport.scrollTop,
    };
    animation.finish();
    return measured;
  });
  await expect
    .poll(() => execution.evaluate((element) => element.getAnimations().length))
    .toBe(0);
  const after = await execution.evaluate((element) => {
    const viewport = element.closest("[data-radix-scroll-area-viewport]")!;
    const footer = element.closest("[data-turn-id]")!.querySelector("footer")!;
    return {
      height: element.getBoundingClientRect().height,
      footer: footer.getBoundingClientRect().top + viewport.scrollTop,
    };
  });
  expect(Math.abs(after.height - before.height)).toBeLessThan(0.5);
  expect(Math.abs(after.footer - before.footer)).toBeLessThan(0.5);
});

async function recordTaskAnimations(page: Page) {
  await page.evaluate(() => {
    Object.assign(window, { taskAnimations: [] });
    const original = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if (this.closest('[data-turn-id="controlled-animation-turn"]')) {
        (window as unknown as { taskAnimations: string[] }).taskAnimations.push(
          this.getAttribute("data-slot") ?? this.tagName,
        );
      }
      return original.apply(this, args);
    };
  });
}

async function taskAnimations(page: Page) {
  return page.evaluate(
    () => (window as unknown as { taskAnimations: string[] }).taskAnimations,
  );
}

function fileChange(id: string): Extract<ThreadItem, { type: "fileChange" }> {
  return {
    type: "fileChange",
    id,
    status: "inProgress",
    changes: [
      {
        path: `/demo/atlas-web/src/${id}.ts`,
        kind: { type: "update", move_path: null },
        diff: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
      },
    ],
  };
}

test("file changes appear collapsed and can be read manually without automatic motion", async ({
  page,
}) => {
  const { base, section } = await controlledTurn(page);
  const pending = liveCommand("patch-neighbor");
  server.publish({
    method: "item/started",
    params: { ...base, item: pending },
  });
  const neighbor = section.locator('[data-reading-id="patch-neighbor"]');
  await expect(neighbor).toHaveAttribute("open");
  await expect
    .poll(() =>
      section
        .locator('[data-slot="conversation-execution"]')
        .evaluate((el) => el.getAnimations().length),
    )
    .toBe(0);
  await recordTaskAnimations(page);
  const item = fileChange("manual-patch");
  server.publish({ method: "item/started", params: { ...base, item } });
  const batch = section.locator(
    '[data-slot="execution-summary"][data-category="file"]',
  );
  await expect(batch.locator(":scope > summary")).toBeHidden();
  expect(await taskAnimations(page)).toEqual([]);
  const patch = section.locator('[data-reading-id="manual-patch"]');
  await expect(patch).toHaveAttribute("data-status", "inProgress");
  await expect(patch.locator(":scope > summary")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(patch).not.toHaveAttribute("open");
  expect(await taskAnimations(page)).toEqual([]);
  await patch.locator(":scope > summary").click();
  await expect(patch).toHaveAttribute("open");
  await expect(patch).toContainText("export const value = 2;");
  server.publish({
    method: "item/completed",
    params: { ...base, item: { ...item, status: "completed" } },
  });
  await expect(patch).toHaveAttribute("data-status", "completed");
  await expect(patch).toHaveAttribute("open");
  await patch.locator(":scope > summary").click();
  await expect(patch).not.toHaveAttribute("open");
  expect(await taskAnimations(page)).toContain("disclosure-content");
  const failed = { ...fileChange("failed-patch"), status: "failed" as const };
  server.publish({
    method: "item/completed",
    params: { ...base, item: failed },
  });
  const failure = section.locator('[data-reading-id="failed-patch"]');
  await expect(failure).toHaveAttribute("data-status", "failed");
  await expect(failure.getByLabel("失败", { exact: true })).toBeVisible();
  await expect(failure).not.toHaveAttribute("open");
  await failure.locator(":scope > summary").click();
  await expect(failure).toContainText("export const value = 2;");
  expect(await taskAnimations(page)).toContain("disclosure-content");
  await expect(neighbor).toHaveAttribute("open");
  await expect(page.getByRole("button", { name: /回到底部/ })).toBeHidden();
});

test("file change summaries enter statically and animate manual folding", async ({
  page,
}) => {
  const { base, section, turn } = await controlledTurn(page);
  const patches = Array.from({ length: 3 }, (_, index) =>
    fileChange(`batch-patch-${index}`),
  );
  await recordTaskAnimations(page);
  for (const item of patches)
    server.publish({ method: "item/started", params: { ...base, item } });
  const summary = section.locator('[data-slot="execution-summary"]').first();
  await expect(summary.locator(":scope > summary")).toHaveText(
    "正在修改 3 个文件 · 3 次修改",
  );
  await expect(summary.locator(":scope > summary")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(summary).not.toHaveAttribute("open");
  expect(await taskAnimations(page)).toEqual([]);
  const results = patches.map((item) => ({
    ...item,
    status: "completed" as const,
  }));
  for (const item of results)
    server.publish({ method: "item/completed", params: { ...base, item } });
  await expect(summary.locator(":scope > summary")).toHaveText(
    "修改了 3 个文件 · 3 次修改",
  );
  await expect(summary).not.toHaveAttribute("open");
  await summary.locator(":scope > summary").click();
  await expect(summary).toHaveAttribute("open");
  await expect(summary.locator('[data-item-type="fileChange"]')).toHaveCount(3);
  await summary.locator(":scope > summary").click();
  await expect(summary).not.toHaveAttribute("open");
  expect(await taskAnimations(page)).toContain("disclosure-content");
  server.publish({
    method: "turn/completed",
    params: {
      threadId: base.threadId,
      turn: {
        ...turn,
        status: "completed",
        items: [...turn.items, ...results],
      },
    },
  });
  await expect(
    section.getByRole("button", { name: "收起执行过程", exact: true }),
  ).toBeVisible();
  expect(await taskAnimations(page)).toContain("disclosure-content");
  await expect(page.getByRole("button", { name: /回到底部/ })).toBeHidden();
});

for (const durationMs of [0, 49, 50]) {
  test(`a task finishing in ${durationMs} ms uses its displayed duration to choose motion`, async ({
    page,
  }) => {
    const { base, section } = await controlledTurn(page);
    const item = liveCommand("timed-command");
    server.publish({ method: "item/started", params: { ...base, item } });
    const command = section.locator('[data-reading-id="timed-command"]');
    await expect(command).toHaveAttribute("open");
    const execution = section.locator('[data-slot="conversation-execution"]');
    await expect
      .poll(() => execution.evaluate((el) => el.getAnimations().length))
      .toBe(0);
    await recordTaskAnimations(page);
    server.publish({
      method: "item/completed",
      params: {
        ...base,
        item: { ...item, status: "completed", exitCode: 0, durationMs },
      },
    });
    if (durationMs < 50) {
      const batch = section.locator('[data-slot="execution-summary"]');
      await expect(batch.locator(":scope > summary")).toBeHidden();
      await expect(command).not.toHaveAttribute("open");
      expect(await taskAnimations(page)).toEqual([]);
      await command.locator(":scope > summary").click();
      await expect(command).toHaveAttribute("open");
      expect(await taskAnimations(page)).toContain("disclosure-content");
    } else {
      await expect(command).toHaveAttribute("data-status", "completed");
      await expect(command).toHaveAttribute("open");
      server.publish({
        method: "item/completed",
        params: {
          ...base,
          item: { type: "plan", id: "timed-next-phase", text: "下一阶段" },
        },
      });
      await expect(command).not.toHaveAttribute("open");
      expect(await taskAnimations(page)).toContain("disclosure-content");
    }
  });
}

test("instant command summaries stay static alongside a running task", async ({
  page,
}) => {
  const { base, section } = await controlledTurn(page);
  const pending = liveCommand("normal-running-command");
  pending.commandActions = [
    {
      type: "read",
      command: pending.command,
      name: "active.txt",
      path: "active.txt",
    },
  ];
  server.publish({
    method: "item/started",
    params: { ...base, item: pending },
  });
  const readBatch = section.locator(
    '[data-slot="execution-summary"][data-category="read"]',
  );
  await expect(readBatch.locator(":scope > summary")).toBeHidden();
  await expect(
    readBatch.locator('[data-slot="conversation-tool"]'),
  ).not.toHaveAttribute("open");
  await expect
    .poll(() =>
      section
        .locator('[data-slot="conversation-execution"]')
        .evaluate((el) => el.getAnimations().length),
    )
    .toBe(0);
  await recordTaskAnimations(page);
  for (let index = 0; index < 3; index++) {
    server.publish({
      method: "item/completed",
      params: {
        ...base,
        item: {
          ...liveCommand(`instant-${index}`),
          status: "completed",
          exitCode: 0,
          durationMs: index,
        },
      },
    });
  }
  const summary = section.locator(
    '[data-slot="execution-summary"][data-category="run"]',
  );
  await expect(summary).toContainText("执行了 3 条命令");
  expect(await taskAnimations(page)).toEqual([]);
  await summary.locator(":scope > summary").click();
  await expect(summary).toHaveAttribute("open");
  expect(await taskAnimations(page)).toContain("disclosure-content");
  await summary.locator(":scope > summary").click();
  await expect(summary).not.toHaveAttribute("open");
  expect(await taskAnimations(page)).toContain("disclosure-content");
  await expect(readBatch).toHaveAttribute("data-status", "inProgress");
  await expect(page.getByRole("button", { name: /回到底部/ })).toBeHidden();
});

test("an instant result cancels pending list motion and folds the process without animation", async ({
  page,
}) => {
  const { base, section, turn } = await controlledTurn(page);
  const item = liveCommand("instant-output-command");
  server.publish({ method: "item/started", params: { ...base, item } });
  const command = section.locator('[data-reading-id="instant-output-command"]');
  await expect(command).toHaveAttribute("open");
  const execution = section.locator('[data-slot="conversation-execution"]');
  // Freeze output growth so the result arrives during an existing transition.
  await execution.evaluate((el) => {
    const original = el.animate;
    el.animate = function (...args) {
      const animation = original.apply(this, args);
      animation.pause();
      return animation;
    };
  });
  server.publish({
    method: "item/commandExecution/outputDelta",
    params: { ...base, itemId: item.id, delta: "output\n".repeat(20) },
  });
  await expect
    .poll(() => execution.evaluate((el) => el.getAnimations().length))
    .toBeGreaterThan(0);
  await recordTaskAnimations(page);
  const result = {
    ...item,
    status: "completed" as const,
    exitCode: 0,
    durationMs: 0,
  };
  server.publish({
    method: "item/completed",
    params: { ...base, item: result },
  });
  await expect(command).not.toHaveAttribute("open");
  expect(await taskAnimations(page)).toEqual([]);
  expect(await execution.evaluate((el) => el.getAnimations().length)).toBe(0);
  server.publish({
    method: "turn/completed",
    params: {
      threadId: base.threadId,
      turn: {
        ...turn,
        items: [...turn.items, result],
        status: "completed",
        durationMs: 0,
      },
    },
  });
  await expect(
    section.getByRole("button", { name: "展开执行过程", exact: true }),
  ).toBeVisible();
  expect(await taskAnimations(page)).toEqual([]);
  await expect(page.getByRole("button", { name: /回到底部/ })).toBeHidden();
});

for (const kind of [
  "command",
  "command after empty thinking",
  "progress",
] as const) {
  test(`new ${kind} enters from zero height and does not replay when reopened`, async ({
    page,
  }) => {
    const { base, section } = await controlledTurn(page);
    await page.evaluate(() => {
      const original = Element.prototype.animate;
      Object.assign(window, { entrances: [] as string[] });
      Element.prototype.animate = function (...args) {
        const animation = original.apply(this, args);
        const slot = this.getAttribute("data-slot");
        if (
          slot &&
          [
            "conversation-execution",
            "conversation-message-motion",
            "conversation-process-motion",
          ].includes(slot)
        ) {
          const frames = (animation.effect as KeyframeEffect).getKeyframes();
          if (parseFloat(String(frames[0]?.height)) === 0) {
            (window as unknown as { entrances: string[] }).entrances.push(slot);
            animation.pause();
          }
        }
        return animation;
      };
    });
    if (kind === "command after empty thinking") {
      server.publish({
        method: "item/completed",
        params: {
          ...base,
          item: {
            type: "reasoning",
            id: "before-entry",
            summary: [],
            content: [],
          },
        },
      });
      const empty = section.locator('[data-slot="conversation-execution"]');
      await expect(empty).toBeAttached();
      expect(
        await empty.evaluate((el) => el.getBoundingClientRect().height),
      ).toBe(0);
      await empty.evaluate((el) => el.setAttribute("data-empty-origin", "yes"));
    }
    const item: ThreadItem =
      kind !== "progress"
        ? liveCommand("enter-command")
        : {
            type: "agentMessage",
            id: "enter-progress",
            text: "",
            phase: "commentary",
            memoryCitation: null,
            delivery: null,
            questions: null,
          };
    server.publish({ method: "item/started", params: { ...base, item } });
    const slot =
      kind !== "progress"
        ? "conversation-execution"
        : "conversation-message-motion";
    const motion = section.locator(`[data-slot="${slot}"]`);
    await expect(motion).toBeAttached();
    await motion.evaluate((el) => el.setAttribute("data-original", "yes"));
    if (kind === "progress") {
      expect(
        await motion.evaluate((el) => el.getBoundingClientRect().height),
      ).toBe(0);
      await expect(
        section.locator('[data-slot="turn-process-divider"]'),
      ).toHaveCount(0);
      server.publish({
        method: "item/agentMessage/delta",
        params: {
          ...base,
          itemId: item.id,
          delta: "正在检查页面。\n\n继续核对动态内容。",
        },
      });
    }
    await expect
      .poll(() => motion.evaluate((el) => el.getAnimations().length))
      .toBe(1);
    const entrance = await motion.evaluate((el) => {
      const animation = el.getAnimations()[0];
      const duration = Number(animation.effect!.getTiming().duration);
      const natural = el.firstElementChild!.getBoundingClientRect().height;
      const heights = [0, 0.1, 0.2, 0.35, 0.5, 0.7, 1].map((progress) => {
        animation.currentTime = duration * progress;
        return el.getBoundingClientRect().height;
      });
      animation.finish();
      const turn = el.closest("[data-turn-id]")!;
      for (const control of turn.querySelectorAll(
        '[data-slot="conversation-process-motion"]',
      ))
        for (const entry of control.getAnimations()) entry.finish();
      return { heights, natural };
    });
    expect(entrance.heights[0]).toBe(0);
    expect(entrance.natural).toBeGreaterThan(40);
    expect(
      new Set(
        entrance.heights.filter(
          (height) => height > 1 && height < entrance.natural - 1,
        ),
      ).size,
    ).toBeGreaterThanOrEqual(4);
    expect(entrance.heights.at(-1)).toBeCloseTo(entrance.natural, 0);
    await expect(motion).toHaveAttribute("data-original", "yes");
    if (kind === "command after empty thinking")
      await expect(motion).toHaveAttribute("data-empty-origin", "yes");
    await settleEntrance(section);
    const entrances = () =>
      page.evaluate(
        () => (window as unknown as { entrances: string[] }).entrances,
      );
    expect(await entrances()).toEqual(
      expect.arrayContaining([slot, "conversation-process-motion"]),
    );
    const count = (await entrances()).length;
    if (kind === "progress") {
      server.publish({
        method: "item/agentMessage/delta",
        params: { ...base, itemId: item.id, delta: "继续更新。" },
      });
      await expect(motion).toContainText("继续更新。");
    }
    await section
      .getByRole("button", { name: "收起执行过程", exact: true })
      .click();
    await expect(motion).toBeHidden();
    await section
      .getByRole("button", { name: "展开执行过程", exact: true })
      .click();
    await expect(motion).toBeVisible();
    await settleEntrance(section);
    expect((await entrances()).length).toBe(count);
    await expect(page.getByRole("button", { name: /回到底部/ })).toBeHidden();
  });
}

test("reduced motion displays new commands and progress without entrance animation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { base, section } = await controlledTurn(page);
  await recordTaskAnimations(page);
  server.publish({
    method: "item/started",
    params: { ...base, item: liveCommand("reduced-entry") },
  });
  await expect(
    section.locator('[data-reading-id="reduced-entry"]'),
  ).toBeVisible();
  server.publish({
    method: "item/started",
    params: {
      ...base,
      item: {
        type: "agentMessage",
        id: "reduced-progress",
        text: "新的进展",
        phase: "commentary",
        memoryCitation: null,
        delivery: null,
        questions: null,
      },
    },
  });
  await expect(section.getByText("新的进展", { exact: true })).toBeVisible();
  expect(await taskAnimations(page)).toEqual([]);
});

async function recordExecutionAnimations(page: Page) {
  await page.evaluate(() => {
    const records: { from: number; to: number }[] = [];
    Object.assign(window, { executionAnimations: records });
    const original = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = original.apply(this, args);
      if (this.matches('[data-slot="conversation-execution"]')) {
        const frames = (animation.effect as KeyframeEffect).getKeyframes();
        records.push({
          from: parseFloat(String(frames[0].height)),
          to: parseFloat(String(frames.at(-1)!.height)),
        });
      }
      return animation;
    };
  });
}

test("a task starts expanded on its first render and live output animates before completion", async ({
  page,
}) => {
  const { base, section } = await controlledTurn(page);
  await recordExecutionAnimations(page);
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      const element = document.querySelector(
        '[data-reading-id="immediate-command"]',
      );
      if (!element) return;
      Object.assign(window, {
        firstOperation: {
          open: element.hasAttribute("open"),
          status: element.getAttribute("data-status"),
        },
      });
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  const item = liveCommand("immediate-command");
  server.publish({ method: "item/started", params: { ...base, item } });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { firstOperation?: unknown }).firstOperation,
      ),
    )
    .toEqual({ open: true, status: "inProgress" });
  const command = section.locator('[data-reading-id="immediate-command"]');
  await expect(command).toContainText("等待命令输出");
  const execution = section.locator('[data-slot="conversation-execution"]');
  await expect
    .poll(() => execution.evaluate((el) => el.getAnimations().length))
    .toBe(0);
  const count = await page.evaluate(
    () =>
      (window as unknown as { executionAnimations: unknown[] })
        .executionAnimations.length,
  );
  server.publish({
    method: "item/commandExecution/outputDelta",
    params: {
      ...base,
      itemId: item.id,
      delta: Array.from(
        { length: 20 },
        (_, index) => `运行中输出 ${index}`,
      ).join("\n"),
    },
  });
  await expect(command).toContainText("运行中输出 19");
  await expect(command).toHaveAttribute("data-status", "inProgress");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              executionAnimations: { from: number; to: number }[];
            }
          ).executionAnimations.filter((entry) => entry.to > entry.from + 1)
            .length,
      ),
    )
    .toBeGreaterThan(count);
});

test("command summaries wait for non-command content before folding", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("codex-workbench.auto-collapse-process", "false"),
  );
  const { base, section, turn } = await controlledTurn(page);
  const completed: ThreadItem[] = [];
  for (let index = 0; index < 2; index++) {
    const item = {
      ...liveCommand(`summary-${index}`),
      status: "completed" as const,
      exitCode: 0,
      durationMs: 100,
    };
    completed.push(item);
    server.publish({ method: "item/completed", params: { ...base, item } });
  }
  const pending = liveCommand("still-running");
  server.publish({
    method: "item/started",
    params: { ...base, item: pending },
  });
  const command = section.locator('[data-reading-id="still-running"]');
  await expect(command).toHaveAttribute("data-status", "inProgress");
  const summary = section.locator('[data-slot="execution-summary"]').first();
  await expect(summary.locator(":scope > summary")).toHaveText(
    "正在执行 3 条命令",
  );
  await expect(summary.locator(":scope > summary")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(
    summary.locator('[data-reading-id="still-running"]'),
  ).toBeVisible();
  await summary.evaluate((el) =>
    el.setAttribute("data-continuity", "original"),
  );
  await page.evaluate(() => {
    const summary = document.querySelector('[data-continuity="original"]')!;
    Object.assign(window, { summaryWasRemoved: false });
    const observer = new MutationObserver(() => {
      if (!summary.isConnected)
        Object.assign(window, { summaryWasRemoved: true });
    });
    observer.observe(summary.parentElement!, { childList: true });
  });
  server.publish({
    method: "item/completed",
    params: {
      ...base,
      item: { ...pending, status: "completed", exitCode: 0, durationMs: 100 },
    },
  });
  await expect(summary.locator(":scope > summary")).toHaveText(
    "执行了 3 条命令",
  );
  await expect(summary.locator(":scope > summary")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(summary).toHaveAttribute("data-continuity", "original");
  await expectStaysExpanded(summary);
  await expectStaysExpanded(command);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { summaryWasRemoved: boolean }).summaryWasRemoved,
    ),
  ).toBe(false);
  const next = liveCommand("next-running");
  completed.push({
    ...pending,
    status: "completed",
    exitCode: 0,
    durationMs: 100,
  });
  server.publish({ method: "item/started", params: { ...base, item: next } });
  await expect(summary.locator(":scope > summary")).toHaveText(
    "正在执行 4 条命令",
  );
  await expect(
    section.locator('[data-reading-id="next-running"]'),
  ).toHaveAttribute("data-status", "inProgress");
  await expect(summary).toHaveAttribute("data-continuity", "original");
  await expect(command).toHaveAttribute("open");
  server.publish({
    method: "item/completed",
    params: {
      ...base,
      item: { ...next, status: "completed", exitCode: 0, durationMs: 100 },
    },
  });
  completed.push({
    ...next,
    status: "completed",
    exitCode: 0,
    durationMs: 100,
  });
  await expect(summary.locator(":scope > summary")).toHaveText(
    "执行了 4 条命令",
  );
  await expectStaysExpanded(summary);
  const boundary: ThreadItem = {
    type: "reasoning",
    id: "batch-boundary-thought",
    summary: ["继续检查下一步。"],
    content: [],
  };
  const collapse = sampleCollapse(summary);
  server.publish({
    method: "item/completed",
    params: { ...base, item: boundary },
  });
  expectSmoothCollapse(await collapse);
  await expect(summary).not.toHaveAttribute("open");
  await expect(page.getByRole("button", { name: /回到底部/ })).toBeHidden();
  const later = liveCommand("later-running");
  server.publish({ method: "item/started", params: { ...base, item: later } });
  await expect(summary.locator(":scope > summary")).toHaveText(
    "执行了 4 条命令",
  );
  await expect(
    section.locator('[data-reading-id="later-running"]'),
  ).toBeVisible();
  await expect(summary).not.toHaveAttribute("open");
  await expect(summary).toHaveAttribute("data-continuity", "original");
  await expect
    .poll(() =>
      summary.evaluate(
        (element) =>
          element
            .querySelector('[data-slot="disclosure-content"]')!
            .getAnimations().length,
      ),
    )
    .toBe(0);
  await recordTaskAnimations(page);
  server.publish({
    method: "turn/completed",
    params: {
      threadId: base.threadId,
      turn: {
        ...turn,
        status: "completed",
        items: [
          ...turn.items,
          ...completed,
          boundary,
          { ...later, status: "completed", exitCode: 0, durationMs: 100 },
        ],
      },
    },
  });
  await expect(
    section.locator('[data-slot="execution-summary"]').last(),
  ).toHaveAttribute("data-status", "completed");
  await expect(summary).not.toHaveAttribute("open");
  expect(await taskAnimations(page)).toContain("disclosure-content");
  await expect(page.getByRole("button", { name: /回到底部/ })).toBeHidden();
});

for (const boundaryType of ["message", "empty-thinking", "file"] as const) {
  test(`${boundaryType} following commands ends their automatic expansion`, async ({
    page,
  }) => {
    const { base, section } = await controlledTurn(page);
    for (let index = 0; index < 3; index++)
      server.publish({
        method: "item/completed",
        params: {
          ...base,
          item: {
            ...liveCommand(`boundary-command-${index}`),
            status: "completed",
            exitCode: 0,
            durationMs: 100,
          },
        },
      });
    const summary = section.locator('[data-slot="execution-summary"]').first();
    await expect(summary.locator(":scope > summary")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expectStaysExpanded(summary);
    const boundary: ThreadItem =
      boundaryType === "message"
        ? {
            type: "agentMessage",
            id: "following-message",
            text: "开始下一步。",
            phase: "commentary",
            memoryCitation: null,
            delivery: null,
            questions: null,
          }
        : boundaryType === "file"
          ? fileChange("following-file")
          : {
              type: "reasoning",
              id: "following-empty-thought",
              summary: [],
              content: [],
            };
    server.publish({
      method: boundaryType === "message" ? "item/completed" : "item/started",
      params: { ...base, item: boundary },
    });
    await expect(summary).not.toHaveAttribute("open");
    if (boundaryType === "empty-thinking") {
      server.publish({
        method: "item/completed",
        params: { ...base, item: boundary },
      });
      await expect(
        section.locator('[data-reading-id="following-empty-thought"]'),
      ).toHaveCount(0);
      await expect(summary).not.toHaveAttribute("open");
    }
    const next = liveCommand("command-after-boundary");
    server.publish({ method: "item/started", params: { ...base, item: next } });
    await expect(
      section.locator('[data-reading-id="command-after-boundary"]'),
    ).toBeVisible();
    await expect(summary.locator(":scope > summary")).toHaveText(
      "执行了 3 条命令",
    );
    await expect(summary).not.toHaveAttribute("open");
    await expect(page.getByRole("button", { name: /回到底部/ })).toBeHidden();
  });
}

for (const finishTurn of [false, true]) {
  test(`an executing command batch folds when ${finishTurn ? "the turn ends without another message" : "its last running command finishes after another message"}`, async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem("codex-workbench.auto-collapse-process", "false"),
    );
    const { base, section, turn } = await controlledTurn(page);
    const items = [0, 1, 2].map((index) => ({
      ...liveCommand(`finishing-${index}`),
      ...(index < 2
        ? { status: "completed" as const, exitCode: 0, durationMs: 100 }
        : {}),
    }));
    for (const item of items)
      server.publish({
        method:
          item.status === "inProgress" ? "item/started" : "item/completed",
        params: { ...base, item },
      });
    const summary = section.locator('[data-slot="execution-summary"]').first();
    await expect(summary.locator(":scope > summary")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    if (!finishTurn) {
      server.publish({
        method: "item/completed",
        params: {
          ...base,
          item: {
            type: "agentMessage",
            id: "parallel-following-message",
            text: "另一项任务已继续。",
            phase: "commentary",
            memoryCitation: null,
            delivery: null,
            questions: null,
          },
        },
      });
      await expect(
        section.locator('[data-reading-id="parallel-following-message"]'),
      ).toBeVisible();
      await expect(summary.locator(":scope > summary")).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      server.publish({
        method: "item/completed",
        params: {
          ...base,
          item: {
            ...items[2],
            status: "completed",
            exitCode: 0,
            durationMs: 100,
          },
        },
      });
    } else {
      server.publish({
        method: "turn/completed",
        params: {
          threadId: base.threadId,
          turn: {
            ...turn,
            status: "completed",
            items: [
              ...turn.items,
              ...items.map((item) => ({
                ...item,
                status: "completed",
                exitCode: 0,
                durationMs: 100,
              })),
            ],
          },
        },
      });
    }
    await expect(summary).not.toHaveAttribute("open");
    await expect(page.getByRole("button", { name: /回到底部/ })).toBeHidden();
  });
}

test("a live command phase stays open across gaps and late instant durations", async ({
  page,
}) => {
  const { base, section } = await controlledTurn(page);
  const first = liveCommand("phase-first");
  server.publish({ method: "item/started", params: { ...base, item: first } });
  const batch = section.locator('[data-batch-id="phase-first"]');
  const firstRow = section.locator('[data-reading-id="phase-first"]');
  await expect(firstRow).toHaveAttribute("open");
  await firstRow.evaluate((el) => el.setAttribute("data-original", "yes"));
  server.publish({
    method: "item/completed",
    params: {
      ...base,
      item: { ...first, status: "completed", durationMs: 0, exitCode: 0 },
    },
  });
  await expect(firstRow).not.toHaveAttribute("open");
  const second = liveCommand("phase-second");
  server.publish({ method: "item/started", params: { ...base, item: second } });
  await expect(batch.locator(":scope > summary")).toBeVisible();
  await expect(batch).toHaveAttribute("open");
  const secondRow = section.locator('[data-reading-id="phase-second"]');
  await expect(secondRow).toHaveAttribute("open");
  server.publish({
    method: "item/completed",
    params: {
      ...base,
      item: { ...second, status: "completed", durationMs: 0, exitCode: 0 },
    },
  });
  await expect(secondRow).not.toHaveAttribute("open");
  await expectStaysExpanded(batch);
  await expect(firstRow).toHaveAttribute("data-original", "yes");
  server.publish({
    method: "item/completed",
    params: {
      ...base,
      item: { type: "plan", id: "phase-end", text: "进入下一阶段" },
    },
  });
  await expect(batch).not.toHaveAttribute("open");
  server.publish({
    method: "item/started",
    params: { ...base, item: liveCommand("phase-next") },
  });
  await expect(
    section.locator('[data-reading-id="phase-next"]'),
  ).toHaveAttribute("open");
  await expect(batch).not.toHaveAttribute("open");
});

test("reading a result pins an executing command batch open", async ({
  page,
}) => {
  const { base, section } = await controlledTurn(page);
  for (let index = 0; index < 2; index++)
    server.publish({
      method: "item/completed",
      params: {
        ...base,
        item: {
          ...liveCommand(`read-result-${index}`),
          status: "completed",
          exitCode: 0,
          durationMs: 100,
        },
      },
    });
  const pending = liveCommand("read-result-live");
  server.publish({
    method: "item/started",
    params: { ...base, item: pending },
  });
  const summary = section.locator('[data-slot="execution-summary"]').first();
  await expect(summary.locator(":scope > summary")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expectStaysExpanded(summary);
  await summary.locator('[data-reading-id="read-result-0"] > summary').click();
  await expect(
    summary.locator('[data-reading-id="read-result-0"]'),
  ).toHaveAttribute("open");
  server.publish({
    method: "item/completed",
    params: {
      ...base,
      item: { ...pending, status: "completed", exitCode: 0, durationMs: 100 },
    },
  });
  await expect(summary.locator(":scope > summary")).toHaveText(
    "执行了 3 条命令",
  );
  // A new activity ends automatic expansion but keeps this explicit reading choice.
  server.publish({
    method: "item/completed",
    params: {
      ...base,
      item: {
        type: "reasoning",
        id: "reading-boundary",
        summary: ["下一步检查。"],
        content: [],
      },
    },
  });
  await expect(section.getByText("思考摘要", { exact: true })).toBeVisible();
  await expect(summary).toHaveAttribute("open");
  const next = liveCommand("read-result-next");
  server.publish({ method: "item/started", params: { ...base, item: next } });
  await expect(summary.locator(":scope > summary")).toHaveText(
    "执行了 3 条命令",
  );
  await expect(
    summary.locator('[data-reading-id="read-result-0"]'),
  ).toHaveAttribute("open");
  await summary.locator(":scope > summary").click();
  await expect(summary).not.toHaveAttribute("open");
  server.publish({
    method: "item/completed",
    params: {
      ...base,
      item: { ...next, status: "completed", exitCode: 0, durationMs: 100 },
    },
  });
  await expect(summary.locator(":scope > summary")).toHaveText(
    "执行了 3 条命令",
  );
  await expect(summary).not.toHaveAttribute("open");
});

test("scrolling command output only leaves following when the conversation actually moves", async ({
  page,
}) => {
  const { base, section } = await controlledTurn(page);
  const item = {
    ...liveCommand("nested-scroll"),
    aggregatedOutput: Array.from({ length: 80 }, (_, i) => `日志 ${i}`).join(
      "\n",
    ),
  };
  server.publish({ method: "item/started", params: { ...base, item } });
  const output = section.locator('[data-slot="operations-output"]').first();
  await expect(output).toBeVisible();
  await settleEntrance(section);
  const viewport = page.locator(
    '[data-slot="conversation-timeline"] > [data-radix-scroll-area-viewport]',
  );
  const latest = page.getByRole("button", { name: /回到底部/ });
  const bottom = await viewport.evaluate((el) => el.scrollTop);
  expect(bottom).toBeGreaterThan(200);
  await output.evaluate((el) => {
    el.scrollTop = 250;
  });
  await output.hover();
  await page.mouse.wheel(0, -100);
  await expect
    .poll(() => output.evaluate((el) => el.scrollTop))
    .toBeLessThan(200);
  expect(await viewport.evaluate((el) => el.scrollTop)).toBe(bottom);
  await expect(latest).toBeHidden();

  // A child may consume an input even at the top of its log. The outer capture
  // handler must not treat that input as a completed conversation scroll.
  await output.evaluate((el) => {
    el.scrollTop = 0;
    el.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        el.setAttribute("data-wheel-consumed", "true");
      },
      { once: true, passive: false },
    );
  });
  await page.mouse.wheel(0, -100);
  await expect(output).toHaveAttribute("data-wheel-consumed", "true");
  expect(await viewport.evaluate((el) => el.scrollTop)).toBe(bottom);
  await expect(latest).toBeHidden();

  // Reading the log must also preserve following as the conversation grows.
  server.publish({
    method: "item/agentMessage/delta",
    params: {
      ...base,
      itemId: "nested-scroll-progress",
      delta: "接下来继续检查。\n".repeat(12),
    },
  });
  await expect(section).toContainText("接下来继续检查。");
  await settleEntrance(section);
  await expect
    .poll(() =>
      viewport.evaluate(
        (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
      ),
    )
    .toBeLessThan(3);
  await expect(latest).toBeHidden();
  await viewport.hover();
  await page.mouse.wheel(0, -200);
  await expect(latest).toBeVisible();
});

test("the top edge of contained tool progress does not show return to bottom", async ({
  page,
}) => {
  const { base, section } = await controlledTurn(page);
  const item: Extract<ThreadItem, { type: "mcpToolCall" }> = {
    type: "mcpToolCall",
    id: "nested-progress",
    server: "demo",
    tool: "check",
    status: "inProgress",
    arguments: {},
    appContext: null,
    mcpAppUi: null,
    pluginId: null,
    readOnlyHint: true,
    result: null,
    error: null,
    durationMs: null,
  };
  server.publish({ method: "item/started", params: { ...base, item } });
  for (let i = 0; i < 40; i++)
    server.publish({
      method: "item/mcpToolCall/progress",
      params: { ...base, itemId: item.id, message: `检查进度 ${i}` },
    });
  const progress = section.locator("details").filter({
    has: page.locator(":scope > summary", { hasText: "查看进度记录" }),
  });
  await progress.locator(":scope > summary").click();
  const output = progress.locator("[data-radix-scroll-area-viewport]");
  await expect(output).toHaveCSS("overscroll-behavior-y", "contain");
  // Progress has its own disclosure motion; the execution list may already be
  // settled while this panel is still moving under the pointer.
  await expect
    .poll(() =>
      progress
        .locator(':scope > [data-slot="disclosure-content"]')
        .evaluate((el) => el.getAnimations().length),
    )
    .toBe(0);
  await settleEntrance(section);
  const viewport = page.locator(
    '[data-slot="conversation-timeline"] > [data-radix-scroll-area-viewport]',
  );
  await output.hover();
  // Hover can bring the target into view while the progress panel settles.
  // Measure the conversation immediately before testing the contained wheel.
  await expect
    .poll(() =>
      viewport.evaluate(
        (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
      ),
    )
    .toBeLessThan(3);
  const bottom = await viewport.evaluate((el) => el.scrollTop);
  expect(bottom).toBeGreaterThan(200);
  await output.evaluate((el) => {
    el.scrollTop = 0;
    el.addEventListener(
      "wheel",
      () => {
        el.setAttribute("data-wheel-received", "true");
      },
      { once: true },
    );
  });
  await page.mouse.wheel(0, -200);
  await expect(output).toHaveAttribute("data-wheel-received", "true");
  expect(await viewport.evaluate((el) => el.scrollTop)).toBe(bottom);
  await expect(page.getByRole("button", { name: /回到底部/ })).toBeHidden();
});

for (const input of ["wheel", "touch", "keyboard"] as const) {
  test(`${input} input cannot pause following when the conversation fits the viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 8000 });
    await controlledTurn(page);
    const viewport = page.locator(
      '[data-slot="conversation-timeline"] > [data-radix-scroll-area-viewport]',
    );
    await expect
      .poll(() => viewport.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeLessThan(5);
    if (input === "wheel") {
      // No native scroll event follows an input that cannot move the viewport.
      await viewport.dispatchEvent("wheel", { deltaY: -200 });
    } else if (input === "touch") {
      await viewport.evaluate((element) => {
        const touch = (clientY: number) =>
          new Touch({ identifier: 1, target: element, clientY });
        for (const [type, clientY] of [
          ["touchstart", 200],
          ["touchmove", 300],
          ["touchend", null],
        ] as const)
          element.dispatchEvent(
            new TouchEvent(type, {
              bubbles: true,
              touches: clientY === null ? [] : [touch(clientY)],
            }),
          );
      });
    } else {
      await viewport.dispatchEvent("keydown", { key: "Home" });
    }
    const latest = page.getByRole("button", { name: /回到底部/ });
    await expect(latest).toBeHidden();
    // Content becoming scrollable later must still follow the latest message.
    await page.setViewportSize({ width: 1440, height: 700 });
    await expect
      .poll(() =>
        viewport.evaluate(
          (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
        ),
      )
      .toBeLessThan(3);
    await expect(latest).toBeHidden();
    await viewport.hover();
    await page.mouse.wheel(0, -200);
    await expect(latest).toBeVisible();
  });
}

test("a conversation fitting the viewport restores bottom following after reading older content", async ({
  page,
}) => {
  await controlledTurn(page);
  const viewport = page.locator(
    '[data-slot="conversation-timeline"] > [data-radix-scroll-area-viewport]',
  );
  await viewport.hover();
  await page.mouse.wheel(0, -10000);
  const latest = page.getByRole("button", { name: /回到底部/ });
  await expect(latest).toBeVisible();
  await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBe(0);
  await page.setViewportSize({ width: 1440, height: 8000 });
  await expect
    .poll(() => viewport.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeLessThan(5);
  await expect(latest).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 700 });
  await expect
    .poll(() =>
      viewport.evaluate(
        (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
      ),
    )
    .toBeLessThan(3);
  await expect(latest).toBeHidden();
});

test("layout clamping at animation completion never exits bottom following", async ({
  page,
}) => {
  await controlledTurn(page);
  const viewport = page.locator(
    '[data-slot="conversation-timeline"] > [data-radix-scroll-area-viewport]',
  );
  await expect
    .poll(() =>
      viewport.evaluate(
        (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
      ),
    )
    .toBeLessThan(3);
  for (const resume of [false, true]) {
    if (resume) {
      await viewport.hover();
      await page.mouse.wheel(0, -500);
      const latest = page.getByRole("button", { name: /回到底部/ });
      await expect(latest).toBeVisible();
      await latest.click();
      await expect(latest).toBeHidden();
    }
    await viewport.evaluate(async (element) => {
      const content = element.querySelector(
        '[data-slot="conversation-content"]',
      )!;
      const spacer = document.createElement("div");
      spacer.style.height = "600px";
      content.append(spacer);
      const frame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await frame();
      await frame();
      await frame();
      Object.assign(window, { bottomButtonFlashed: false });
      const observer = new MutationObserver(() => {
        if (
          [...document.querySelectorAll("button")].some((button) =>
            button.textContent?.includes("回到底部"),
          )
        )
          Object.assign(window, { bottomButtonFlashed: true });
      });
      observer.observe(document.body, { childList: true, subtree: true });
      // The browser clamps scrollTop while outgoing content shrinks, then another
      // layout update restores the height before observers receive the final size.
      spacer.style.height = "0px";
      void element.scrollHeight;
      spacer.style.height = "600px";
      content.append(document.createTextNode(""));
      await frame();
      await frame();
      await frame();
      spacer.remove();
      await frame();
      await frame();
      observer.disconnect();
    });
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { bottomButtonFlashed: boolean })
            .bottomButtonFlashed,
      ),
    ).toBe(false);
    await expect(page.getByRole("button", { name: /回到底部/ })).toBeHidden();
    await expect
      .poll(() =>
        viewport.evaluate(
          (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
        ),
      )
      .toBeLessThan(3);
  }
});

for (const running of [false, true]) {
  test(`initial conversation content renders without animation (${running ? "running" : "completed"})`, async ({
    page,
  }) => {
    if (!running) server.releaseWriter();
    await page.addInitScript(() => {
      localStorage.setItem("codex-workbench.auto-collapse-process", "false");
      const animations: string[] = [];
      Object.assign(window, { initialConversationAnimations: animations });
      const original = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        if (
          this.closest(
            '[data-slot="conversation-execution"], [data-slot="conversation-message-motion"], [data-slot="conversation-process-motion"]',
          )
        )
          animations.push(this.getAttribute("data-slot") ?? "content");
        return original.apply(this, args);
      };
    });
    await page.goto("/?env=local&session=mock-thread-010");
    const execution = page.locator('[data-slot="conversation-execution"]');
    await expect(execution).toHaveCount(1);
    const summary = execution.locator('[data-slot="execution-summary"]');
    await expect(summary.locator(":scope > summary")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    if (running)
      await expect(
        execution.getByText("当前仍在思考", { exact: true }),
      ).toBeVisible();
    const records = () =>
      page.evaluate(
        () =>
          (window as unknown as { initialConversationAnimations: string[] })
            .initialConversationAnimations,
      );
    expect(await records()).toEqual([]);
    if (!running) {
      const thought = execution
        .locator('details[data-item-type="reasoning"]')
        .first();
      await thought.locator(":scope > summary").click();
      await expect(thought).toHaveAttribute("open", "");
      expect(await records()).toContain("disclosure-content");
      await thought.locator(":scope > summary").click();
      await expect(thought).not.toHaveAttribute("open");
      expect(await records()).toContain("disclosure-content");
    }

    await page.evaluate(() => {
      (
        window as unknown as { initialConversationAnimations: string[] }
      ).initialConversationAnimations.length = 0;
    });

    // Returning to a cached conversation must not replay its entrance either.
    for (const title of ["工作区导航与搜索 · 1", "接口分页与错误处理 · 10"]) {
      await page.keyboard.press("Control+k");
      const search = page.getByRole("dialog", { name: "搜索会话" });
      await search.getByPlaceholder("搜索标题、摘要或工作区…").fill(title);
      await page.keyboard.press("Enter");
      await expect(search).toBeHidden();
      await expect(page).toHaveURL(
        new RegExp(
          title.endsWith("10")
            ? "session=mock-thread-010"
            : "session=mock-thread-001",
        ),
      );
    }
    await expect(execution).toHaveCount(1);
    await expect(summary.locator(":scope > summary")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(await records()).toEqual([]);
    if (running) {
      const thought = execution.locator('[data-item-type="reasoning"][open]');
      const itemId = await thought.getAttribute("data-reading-id");
      const turnId = await thought
        .locator("xpath=ancestor::section[@data-turn-id]")
        .getAttribute("data-turn-id");
      server.publish({
        method: "item/reasoning/textDelta",
        params: {
          threadId: "mock-thread-010",
          turnId,
          itemId,
          contentIndex: 0,
          delta: "\n\n后续实时思考内容。".repeat(15),
        },
      });
      await expect.poll(records).not.toEqual([]);
    }
    await page.reload();
    await expect(execution).toHaveCount(1);
    await expect(summary.locator(":scope > summary")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(await records()).toEqual([]);
  });
}

test("the first batch and its active command keep their DOM through growth and failure", async ({
  page,
}) => {
  const { base, section } = await controlledTurn(page);
  const first = liveCommand("stable-first");
  server.publish({ method: "item/started", params: { ...base, item: first } });
  const batch = section.locator('[data-slot="execution-summary"]').first();
  const command = section.locator('[data-reading-id="stable-first"]');
  await expect(command).toHaveAttribute("open");
  await expect(batch.locator(":scope > summary")).toBeHidden();
  await settleEntrance(section);
  const originalBounds = await command.boundingBox();
  expect(originalBounds).not.toBeNull();
  await batch.evaluate((el) => el.setAttribute("data-original", "yes"));
  await command.evaluate((el) => el.setAttribute("data-original", "yes"));
  for (const id of ["stable-second", "stable-third"]) {
    server.publish({
      method: "item/started",
      params: { ...base, item: liveCommand(id) },
    });
    await expect(batch).toHaveAttribute("data-original", "yes");
    await expect(command).toHaveAttribute("data-original", "yes");
    await expect(batch.locator(":scope > summary")).toBeVisible();
    const bounds = await command.boundingBox();
    expect(bounds).not.toBeNull();
    expect(Math.abs(bounds!.x - originalBounds!.x)).toBeLessThan(0.5);
    expect(Math.abs(bounds!.width - originalBounds!.width)).toBeLessThan(0.5);
  }
  server.publish({
    method: "item/completed",
    params: {
      ...base,
      item: {
        ...first,
        status: "failed",
        exitCode: 1,
        durationMs: 1500,
        aggregatedOutput: "useful error",
      },
    },
  });
  await expect(batch).toHaveAttribute("data-status", "attention");
  await expect(batch).toContainText("1 项需关注");
  await expect(command).toHaveAttribute("data-status", "failed");
  await expect(command).toHaveAttribute("open");
  await command.locator(":scope > summary").click();
  await expect(command).not.toHaveAttribute("open");
  await command.locator(":scope > summary").click();
  await expect(command).toContainText("useful error");
  await expect(command).toHaveAttribute("data-original", "yes");
  await expect(batch).toHaveAttribute("data-original", "yes");
});

test("reading a command keeps the batch and process open when the turn completes", async ({
  page,
}) => {
  const { base, section, turn } = await controlledTurn(page);
  const item = {
    ...liveCommand("pinned-command"),
    status: "completed" as const,
    exitCode: 0,
    durationMs: 100,
    aggregatedOutput: "read this result",
  };
  server.publish({ method: "item/completed", params: { ...base, item } });
  const command = section.locator('[data-reading-id="pinned-command"]');
  await command.locator(":scope > summary").click();
  await expect(command).toContainText("read this result");
  await command.evaluate((el) => el.setAttribute("data-original", "yes"));
  server.publish({
    method: "turn/completed",
    params: {
      threadId: base.threadId,
      turn: { ...turn, status: "completed", items: [...turn.items, item] },
    },
  });
  await expect(
    section.locator('[data-slot="conversation-turn-footer"]'),
  ).toContainText("已完成");
  await expect(command).toBeVisible();
  await expect(command).toHaveAttribute("open");
  await expect(command).toHaveAttribute("data-original", "yes");
  await expect(
    section.getByRole("button", { name: "收起执行过程", exact: true }),
  ).toBeVisible();
  await recordTaskAnimations(page);
  await command.locator(":scope > summary").click();
  await expect(command).not.toHaveAttribute("open");
  expect(await taskAnimations(page)).toContain("disclosure-content");
});

for (const completed of [false, true]) {
  test(`collapsed process shows only attention records and keeps their details independent (${completed ? "completed" : "running"})`, async ({
    page,
  }) => {
    const { base, section, turn } = await controlledTurn(page);
    const command = (id: string, failed = false): ThreadItem => ({
      ...liveCommand(id),
      status: failed ? "failed" : "completed",
      exitCode: failed ? 1 : 0,
      durationMs: 100,
      aggregatedOutput: `${id} output`,
    });
    const items: ThreadItem[] = [
      command("attention-success"),
      command("attention-failure", true),
      { type: "plan", id: "attention-plan", text: "successful plan" },
      command("attention-second-failure", true),
      {
        type: "agentMessage",
        id: "attention-answer",
        text: "final answer",
        phase: "final_answer",
        memoryCitation: null,
        delivery: null,
        questions: null,
      },
    ];
    for (const item of items)
      server.publish({ method: "item/completed", params: { ...base, item } });
    if (completed) {
      server.publish({
        method: "turn/completed",
        params: {
          threadId: base.threadId,
          turn: {
            ...turn,
            status: "completed",
            items: [...turn.items, ...items],
          },
        },
      });
    } else {
      await section
        .getByRole("button", { name: "收起执行过程", exact: true })
        .click();
    }
    const toggle = section.locator('[data-slot="turn-process-divider"] button');
    const batches = section.locator('[data-slot="execution-summary"]');
    const first = section.locator('[data-batch-id="attention-success"]');
    const failed = section.locator('[data-reading-id="attention-failure"]');
    const successful = section.locator('[data-reading-id="attention-success"]');
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(
      section.getByRole("status").filter({ hasText: "需要关注" }),
    ).toContainText("有 2 项执行记录需要关注，当前仅显示这些记录");
    await expect(batches).toHaveCount(2);
    await expect(first.locator(":scope > summary")).toBeHidden();
    await expect(failed).toBeVisible();
    await expect(
      section.getByText("final answer", { exact: true }),
    ).toBeVisible();
    await expect(
      section.locator('[data-reading-id="attention-plan"]'),
    ).toBeHidden();
    await expect(successful).toBeHidden();
    await failed.locator(":scope > summary").click();
    const output = failed.getByText(/attention-failure output/);
    await expect(output).toBeVisible();
    await output.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(successful).toBeHidden();
    await failed.evaluate((el) => el.setAttribute("data-original", "yes"));
    await first.evaluate((el) => el.setAttribute("data-original", "yes"));
    await toggle.click();
    await expect(successful).toBeVisible();
    await expect(
      section.locator('[data-reading-id="attention-plan"]'),
    ).toBeVisible();
    await expect(first.locator(":scope > summary")).toHaveText(
      "执行了 2 条命令1 项需关注",
    );
    await expect(first).toHaveAttribute("data-original", "yes");
    await expect(failed).toHaveAttribute("data-original", "yes");
    await expect(output).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(successful).toBeHidden();
    await expect(output).toBeVisible();
    await expect(failed).toHaveAttribute("data-original", "yes");
    await failed.locator(":scope > summary").click();
    await expect(output).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
}

test("successful reads and searches stay compact while their status updates", async ({
  page,
}) => {
  const { base, section } = await controlledTurn(page);
  for (const type of ["read", "search"] as const) {
    const item = liveCommand(`compact-${type}`);
    item.commandActions =
      type === "read"
        ? [{ type, command: "cat", name: "example.ts", path: "example.ts" }]
        : [{ type, command: "rg", query: "pattern", path: null }];
    server.publish({ method: "item/started", params: { ...base, item } });
    const batch = section.locator(
      `[data-slot="execution-summary"][data-category="${type}"]`,
    );
    await expect(batch).toHaveAttribute("data-status", "inProgress");
    await expect(batch.locator(":scope > summary")).toBeHidden();
    await expect(
      batch.locator('[data-slot="conversation-tool"]'),
    ).not.toHaveAttribute("open");
    server.publish({
      method: "item/completed",
      params: {
        ...base,
        item: { ...item, status: "completed", durationMs: 300, exitCode: 0 },
      },
    });
    await expect(batch).toHaveAttribute("data-status", "completed");
    await expect(batch.locator(":scope > summary")).toBeHidden();
    await expect(
      batch.locator('[data-slot="conversation-tool"]'),
    ).not.toHaveAttribute("open");
  }
  await expect(section.locator('[data-slot="execution-summary"]')).toHaveCount(
    2,
  );
});

test("opening disclosure retargets streamed output before releasing its height", async ({
  page,
}) => {
  const { base, section } = await controlledTurn(page);
  const item = {
    ...liveCommand("opening-stream"),
    aggregatedOutput: "first line",
  };
  server.publish({ method: "item/started", params: { ...base, item } });
  const command = section.locator('[data-reading-id="opening-stream"]');
  await expect(command).toHaveAttribute("open");
  await settleEntrance(section);
  await command.locator(":scope > summary").click();
  await expect(command).not.toHaveAttribute("open");
  const body = command.locator(':scope > [data-slot="disclosure-content"]');
  await body.evaluate((element) => {
    const original = element.animate;
    element.animate = function (...args) {
      const animation = original.apply(this, args);
      animation.pause();
      return animation;
    };
  });
  await command.locator(":scope > summary").click();
  await expect
    .poll(() => body.evaluate((el) => el.getAnimations().length))
    .toBe(1);
  const originalTarget = await body.evaluate((element) => {
    const animation = element.getAnimations()[0];
    const duration = Number(animation.effect!.getTiming().duration);
    animation.currentTime = duration;
    const target = element.getBoundingClientRect().height;
    animation.currentTime = duration * 0.4;
    return target;
  });
  server.publish({
    method: "item/commandExecution/outputDelta",
    params: {
      ...base,
      itemId: item.id,
      delta:
        "\n" +
        Array.from({ length: 12 }, (_, i) => `streamed line ${i}`).join("\n"),
    },
  });
  await expect(command).toContainText("streamed line 11");
  // ResizeObserver runs after React commits. Keep the animation paused while
  // waiting for its endpoint to include the newly streamed content.
  await expect
    .poll(() =>
      body.evaluate((element) => {
        const animation = element.getAnimations()[0];
        if (!animation) return false;
        const frames = (animation.effect as KeyframeEffect).getKeyframes();
        return (
          Math.abs(
            Number.parseFloat(String(frames.at(-1)!.height)) -
              element.firstElementChild!.getBoundingClientRect().height,
          ) < 0.5
        );
      }),
    )
    .toBe(true);
  const before = await body.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.currentTime = Number(animation.effect!.getTiming().duration);
    const height = element.getBoundingClientRect().height;
    animation.finish();
    return height;
  });
  await expect
    .poll(() => body.evaluate((el) => el.getAnimations().length))
    .toBe(0);
  const after = await body.evaluate((el) => el.getBoundingClientRect().height);
  expect(before).toBeGreaterThan(originalTarget + 20);
  expect(Math.abs(after - before)).toBeLessThan(0.5);
});

test("a nested fold preserves the visible height of an in-flight execution update", async ({
  page,
}) => {
  const { base, section } = await controlledTurn(page);
  const item = {
    ...liveCommand("nested-in-flight"),
    aggregatedOutput: "first line",
  };
  server.publish({ method: "item/started", params: { ...base, item } });
  const command = section.locator('[data-reading-id="nested-in-flight"]');
  await expect(command).toHaveAttribute("open");
  const sibling = liveCommand("nested-growing-sibling");
  server.publish({
    method: "item/started",
    params: { ...base, item: sibling },
  });
  const siblingRow = section.locator(
    '[data-reading-id="nested-growing-sibling"]',
  );
  await expect(siblingRow).toHaveAttribute("open");
  await settleEntrance(section);
  const execution = section.locator('[data-slot="conversation-execution"]');
  await execution.evaluate((element) => {
    for (const target of [
      element,
      ...element.querySelectorAll('[data-slot="disclosure-content"]'),
    ]) {
      const original = target.animate;
      target.animate = function (...args) {
        const animation = original.apply(this, args);
        animation.pause();
        return animation;
      };
    }
  });
  server.publish({
    method: "item/commandExecution/outputDelta",
    params: {
      ...base,
      itemId: sibling.id,
      delta: "\ngrowing output".repeat(12),
    },
  });
  await expect(siblingRow).toContainText("growing output");
  await expect
    .poll(() => execution.evaluate((el) => el.getAnimations().length))
    .toBe(1);
  const before = await execution.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.currentTime =
      Number(animation.effect!.getTiming().duration) * 0.35;
    return element.getBoundingClientRect().height;
  });
  await command
    .locator(":scope > summary")
    .evaluate((el: HTMLElement) => el.click());
  const body = command.locator(':scope > [data-slot="disclosure-content"]');
  await expect
    .poll(() => body.evaluate((el) => el.getAnimations().length))
    .toBe(1);
  // A simultaneous protocol update used to cancel the parent's held height as
  // soon as it noticed the nested fold, exposing all remaining growth at once.
  server.publish({
    method: "item/commandExecution/outputDelta",
    params: { ...base, itemId: sibling.id, delta: "\nupdate during fold" },
  });
  await expect(siblingRow).toContainText("update during fold");
  const after = await execution.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(Math.abs(after - before)).toBeLessThan(0.5);
});

async function sampleManualMotion(body: Locator, trigger: Locator) {
  await body.evaluate((element) => {
    const original = element.animate;
    element.animate = function (...args) {
      const animation = original.apply(this, args);
      animation.pause();
      return animation;
    };
  });
  await trigger.evaluate((element: HTMLElement) => element.click());
  await expect
    .poll(() => body.evaluate((el) => el.getAnimations().length))
    .toBe(1);
  const heights = await body.evaluate((element) => {
    const animation = element.getAnimations()[0];
    const duration = Number(animation.effect!.getTiming().duration);
    const heights = [0, 0.15, 0.35, 0.6, 0.85, 1].map((progress) => {
      animation.currentTime = duration * progress;
      return element.getBoundingClientRect().height;
    });
    animation.finish();
    return heights;
  });
  await expect
    .poll(() => body.evaluate((el) => el.getAnimations().length))
    .toBe(0);
  const min = Math.min(heights[0], heights.at(-1)!);
  const max = Math.max(heights[0], heights.at(-1)!);
  expect(max - min).toBeGreaterThan(5);
  expect(
    new Set(
      heights.filter((height) => height > min + 0.5 && height < max - 0.5),
    ).size,
  ).toBeGreaterThanOrEqual(2);
  expect(
    Math.abs(
      (await body.evaluate((el) => el.getBoundingClientRect().height)) -
        heights.at(-1)!,
    ),
  ).toBeLessThan(0.5);
}

for (const reduced of [false, true]) {
  test(`completed task, batch and process manual toggles ${reduced ? "respect reduced motion" : "animate with intermediate frames"}`, async ({
    page,
  }) => {
    if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() =>
      localStorage.setItem("codex-workbench.auto-collapse-process", "false"),
    );
    const { base, section, turn } = await controlledTurn(page);
    const items = [0, 1].map((index) => ({
      ...liveCommand(`completed-manual-${index}`),
      status: "completed" as const,
      exitCode: 0,
      durationMs: 0,
      aggregatedOutput: "readable output\n".repeat(8),
    }));
    for (const item of items)
      server.publish({ method: "item/completed", params: { ...base, item } });
    server.publish({
      method: "turn/completed",
      params: {
        threadId: base.threadId,
        turn: {
          ...turn,
          status: "completed",
          items: [...turn.items, ...items],
        },
      },
    });
    await expect(
      section.locator('[data-slot="conversation-turn-footer"]'),
    ).toContainText("已完成");
    const batch = section.locator('[data-slot="execution-summary"]');
    const command = section.locator('[data-reading-id="completed-manual-0"]');
    const toggle = async (body: Locator, trigger: Locator) => {
      if (!reduced) return sampleManualMotion(body, trigger);
      await recordTaskAnimations(page);
      await trigger.evaluate((el: HTMLElement) => el.click());
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
      expect(await taskAnimations(page)).toEqual([]);
      expect(await body.evaluate((el) => el.getAnimations().length)).toBe(0);
    };
    const batchBody = batch.locator(
      ':scope > [data-slot="disclosure-content"]',
    );
    await toggle(batchBody, batch.locator(":scope > summary"));
    const commandBody = command.locator(
      ':scope > [data-slot="disclosure-content"]',
    );
    await toggle(commandBody, command.locator(":scope > summary"));
    if (!reduced) {
      const reversal = await command.evaluate(async (element) => {
        const trigger = element.querySelector<HTMLElement>(":scope > summary")!;
        const body = element.querySelector<HTMLElement>(
          ':scope > [data-slot="disclosure-content"]',
        )!;
        const frame = () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        trigger.click();
        await frame();
        const closing = body.getAnimations()[0];
        closing.currentTime =
          Number(closing.effect!.getTiming().duration) * 0.35;
        const before = body.getBoundingClientRect().height;
        trigger.click();
        await frame();
        const opening = body.getAnimations()[0];
        opening.currentTime = 0;
        const after = body.getBoundingClientRect().height;
        opening.finish();
        return { before, after };
      });
      expect(reversal.before).toBeGreaterThan(0);
      expect(Math.abs(reversal.after - reversal.before)).toBeLessThan(0.5);
      await expect
        .poll(() => commandBody.evaluate((el) => el.getAnimations().length))
        .toBe(0);
    }

    await toggle(commandBody, command.locator(":scope > summary"));
    await toggle(batchBody, batch.locator(":scope > summary"));
    const processId = await section
      .locator('[data-slot="conversation-execution"]')
      .locator('xpath=ancestor::*[@data-slot="disclosure-content"][1]/..')
      .getAttribute("id");
    expect(processId).toBeTruthy();
    const processBody = section.locator(
      `[id="${processId}"] > [data-slot="disclosure-content"]`,
    );
    await toggle(
      processBody,
      section.getByRole("button", { name: "收起执行过程", exact: true }),
    );
    await toggle(
      processBody,
      section.getByRole("button", { name: "展开执行过程", exact: true }),
    );
  });
}

test("completed tool structured and progress disclosures animate independently", async ({
  page,
}) => {
  const { base, section } = await controlledTurn(page);
  const item: Extract<ThreadItem, { type: "mcpToolCall" }> = {
    type: "mcpToolCall",
    id: "nested-manual-tool",
    server: "demo",
    tool: "nested_results",
    status: "inProgress",
    arguments: {},
    appContext: null,
    mcpAppUi: null,
    pluginId: null,
    readOnlyHint: true,
    result: null,
    error: null,
    durationMs: null,
  };
  server.publish({ method: "item/started", params: { ...base, item } });
  server.publish({
    method: "item/mcpToolCall/progress",
    params: {
      ...base,
      itemId: item.id,
      message: "nested progress line\n".repeat(6),
    },
  });
  server.publish({
    method: "item/completed",
    params: {
      ...base,
      item: {
        ...item,
        status: "completed",
        durationMs: 100,
        result: {
          content: [{ type: "text", text: "Visible tool result" }],
          structuredContent: {
            records: Array.from({ length: 6 }, (_, i) => ({ index: i })),
          },
          _meta: null,
        },
      },
    },
  });
  const tool = section.locator('[data-reading-id="nested-manual-tool"]');
  await expect(tool).toHaveAttribute("data-status", "completed");
  const summary = tool.locator(":scope > summary");
  if ((await summary.getAttribute("aria-expanded")) !== "true")
    await summary.click();
  await settleEntrance(section);
  for (const label of [/结构化结果/, /查看进度记录/]) {
    const trigger = tool.locator("summary").filter({ hasText: label });
    const disclosure = trigger.locator("..");
    const body = disclosure.locator(
      ':scope > [data-slot="disclosure-content"]',
    );
    await sampleManualMotion(body, trigger);
    await sampleManualMotion(body, trigger);
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    await expect(tool).toContainText("Visible tool result");
  }
});

test("turn result diffs remain present through animated folding and rapid reversal", async ({
  page,
}) => {
  const { base, section, turn } = await controlledTurn(page);
  const item = {
    ...fileChange("turn-result-motion"),
    status: "completed" as const,
  };
  server.publish({ method: "item/completed", params: { ...base, item } });
  server.publish({
    method: "turn/completed",
    params: {
      threadId: base.threadId,
      turn: { ...turn, status: "completed", items: [...turn.items, item] },
    },
  });
  const results = section.locator('[data-slot="turn-results"]');
  const trigger = results.getByRole("button", { name: /本轮变更 ·/ });
  const body = results.locator(
    ':scope > div > [data-slot="disclosure-content"]',
  );
  await sampleManualMotion(body, trigger);
  const reversal = await results.evaluate(async (element) => {
    const trigger = element.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    )!;
    const body = element.querySelector<HTMLElement>(
      '[data-slot="disclosure-content"]',
    )!;
    const frame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    trigger.click();
    await frame();
    const closing = body.getAnimations()[0];
    closing.currentTime = Number(closing.effect!.getTiming().duration) * 0.35;
    const before = body.getBoundingClientRect().height;
    const retained = body.textContent!.includes("+export const value = 2;");
    trigger.click();
    await frame();
    const opening = body.getAnimations()[0];
    opening.currentTime = 0;
    const after = body.getBoundingClientRect().height;
    opening.finish();
    return { before, after, retained };
  });
  expect(reversal.retained).toBe(true);
  expect(reversal.before).toBeGreaterThan(0);
  expect(Math.abs(reversal.after - reversal.before)).toBeLessThan(0.5);
  await expect
    .poll(() => body.evaluate((el) => el.getAnimations().length))
    .toBe(0);
  await expect(results.getByLabel("变更差异")).toContainText(
    "+export const value = 2;",
  );
  await sampleManualMotion(body, trigger);
  await expect(results.getByLabel("变更差异")).toHaveCount(0);
});

test("manual attention filtering animates completed instant successes while retaining failed task DOM", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("codex-workbench.auto-collapse-process", "false"),
  );
  const { base, section, turn } = await controlledTurn(page);
  const items: ThreadItem[] = [0, 1, 2, 3].map((index) => ({
    ...liveCommand(`manual-filter-${index}`),
    status: index === 3 ? "failed" : "completed",
    exitCode: index === 3 ? 1 : 0,
    durationMs: 0,
    aggregatedOutput:
      index === 3 ? "Retained failure diagnostic" : `instant success ${index}`,
  }));
  for (const item of items)
    server.publish({ method: "item/completed", params: { ...base, item } });
  server.publish({
    method: "turn/completed",
    params: {
      threadId: base.threadId,
      turn: { ...turn, status: "completed", items: [...turn.items, ...items] },
    },
  });
  await expect(
    section.locator('[data-slot="conversation-turn-footer"]'),
  ).toContainText("已完成");
  const batch = section.locator('[data-slot="execution-summary"]');
  const batchToggle = batch.locator(":scope > summary");
  if ((await batchToggle.getAttribute("aria-expanded")) !== "true")
    await batchToggle.click();
  const failed = section.locator('[data-reading-id="manual-filter-3"]');
  const successes = section.locator(
    '[data-reading-id="manual-filter-0"], [data-reading-id="manual-filter-1"], [data-reading-id="manual-filter-2"]',
  );
  await expect(successes).toHaveCount(3);
  await expect
    .poll(() =>
      batch
        .locator(':scope > [data-slot="disclosure-content"]')
        .evaluate((el) => el.getAnimations().length),
    )
    .toBe(0);
  for (const success of await successes.all())
    await expect(success).toBeVisible();
  await expect(failed).toBeVisible();
  await settleEntrance(section);
  await failed.evaluate((element) =>
    element.setAttribute("data-retained-filter", "original"),
  );
  const execution = section.locator('[data-slot="conversation-execution"]');
  await sampleManualMotion(
    execution,
    section.getByRole("button", { name: "收起执行过程", exact: true }),
  );
  await expect(successes).toHaveCount(0);
  await expect(failed).toHaveAttribute("data-retained-filter", "original");
  await expect(failed).toBeVisible();
  await expect(
    section.getByRole("status").filter({ hasText: "需要关注" }),
  ).toContainText("有 1 项执行记录需要关注");
  await sampleManualMotion(
    failed.locator(':scope > [data-slot="disclosure-content"]'),
    failed.locator(":scope > summary"),
  );
  await expect(failed).toContainText("Retained failure diagnostic");
  await expect(
    section.getByRole("button", { name: "展开执行过程", exact: true }),
  ).toBeVisible();
  await sampleManualMotion(
    execution,
    section.getByRole("button", { name: "展开执行过程", exact: true }),
  );
  await expect(successes).toHaveCount(3);
  await expect(failed).toHaveAttribute("data-retained-filter", "original");
  await expect(failed.locator(":scope > summary")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});

test("restoring collapsed completed attention batches starts at the held execution height", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("codex-workbench.auto-collapse-process", "false"),
  );
  const { base, section, turn } = await controlledTurn(page);
  const items: ThreadItem[] = ["run", "read"].flatMap((category) =>
    [0, 1, 2].map((index) => ({
      ...liveCommand(`restore-${category}-${index}`),
      commandActions:
        category === "read"
          ? [
              {
                type: "read" as const,
                command: "cat",
                name: `file-${index}.ts`,
                path: `file-${index}.ts`,
              },
            ]
          : [],
      status: index === 2 ? ("failed" as const) : ("completed" as const),
      exitCode: index === 2 ? 1 : 0,
      durationMs: 100,
      aggregatedOutput: `diagnostic ${category} ${index}\n`.repeat(6),
    })),
  );
  for (const item of items)
    server.publish({ method: "item/completed", params: { ...base, item } });
  server.publish({
    method: "turn/completed",
    params: {
      threadId: base.threadId,
      turn: { ...turn, status: "completed", items: [...turn.items, ...items] },
    },
  });
  await expect(
    section.locator('[data-slot="conversation-turn-footer"]'),
  ).toContainText("已完成");
  // Keep both default batch summaries closed. Attention filtering temporarily
  // turns each group into a single visible failed row, then restores the batch.
  const batches = section.locator('[data-slot="execution-summary"]');
  await expect(batches).toHaveCount(2);
  for (const batch of await batches.all())
    await expect(batch.locator(":scope > summary")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  await expect
    .poll(() =>
      batches
        .locator(':scope > [data-slot="disclosure-content"]')
        .evaluateAll((elements) =>
          elements.reduce((count, el) => count + el.getAnimations().length, 0),
        ),
    )
    .toBe(0);
  await settleEntrance(section);
  await section
    .getByRole("button", { name: "收起执行过程", exact: true })
    .click();
  await expect(
    section.locator('[data-reading-id="restore-run-0"]'),
  ).toHaveCount(0);
  await settleEntrance(section);
  const failures = section.locator('[data-status="failed"][data-reading-id]');
  await expect(failures).toHaveCount(2);
  await failures.evaluateAll((elements) =>
    elements.forEach((el) =>
      el.setAttribute("data-retained-restore", "original"),
    ),
  );
  const execution = section.locator('[data-slot="conversation-execution"]');
  const before = await execution.evaluate((element) => {
    const original = element.animate;
    element.animate = function (...args) {
      const animation = original.apply(this, args);
      animation.pause();
      return animation;
    };
    return element.getBoundingClientRect().height;
  });
  await section
    .getByRole("button", { name: "展开执行过程", exact: true })
    .evaluate((el: HTMLElement) => el.click());
  await expect
    .poll(() => execution.evaluate((el) => el.getAnimations().length))
    .toBe(1);
  const start = await execution.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.currentTime = 0;
    return element.getBoundingClientRect().height;
  });
  expect(Math.abs(start - before)).toBeLessThan(0.5);
  await expect(failures).toHaveCount(2);
  await expect(
    section.locator('[data-retained-restore="original"]'),
  ).toHaveCount(2);
  // Resume real playback after checking the exact first frame. Holding every
  // replacement at zero can leave the parent already at its final natural size,
  // where cancelling is correct; requiring an animation to survive is artificial.
  await execution.evaluate((element) => {
    element.animate = Element.prototype.animate;
    for (const animation of element.getAnimations()) animation.play();
  });
  await expect
    .poll(() =>
      section
        .locator('[data-slot="disclosure-content"]')
        .evaluateAll((elements) =>
          elements.reduce((count, el) => count + el.getAnimations().length, 0),
        ),
    )
    .toBe(0);
  await expect
    .poll(() => execution.evaluate((el) => el.getAnimations().length))
    .toBe(0);
  expect(
    await execution.evaluate((el) =>
      Math.abs(
        el.getBoundingClientRect().height -
          el.firstElementChild!.getBoundingClientRect().height,
      ),
    ),
  ).toBeLessThan(0.5);
  for (const batch of await batches.all())
    await expect(batch.locator(":scope > summary")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
});
