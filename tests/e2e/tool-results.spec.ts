import { expect, test } from "@playwright/test";
import { once } from "node:events";
import { createMockServer } from "../fixtures/app-server";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";

const data = {
  name: "demo-branch",
  commit: { id: "abc123", title: "Improve conversation updates" },
  protected: false,
  files: Array.from({ length: 20 }, (_, i) => `src/example-${i}.ts`),
};
const raw = JSON.stringify(data);
const item: Extract<ThreadItem, { type: "mcpToolCall" }> = {
  type: "mcpToolCall",
  id: "glab-json",
  server: "glab",
  tool: "glab_api",
  status: "completed",
  arguments: { args: ["projects/demo/repository/branches/demo-branch"] },
  appContext: null,
  mcpAppUi: null,
  pluginId: null,
  readOnlyHint: true,
  result: {
    content: [{ type: "text", text: raw }],
    structuredContent: { content: raw, data, request_id: "demo-request" },
    _meta: null,
  },
  error: null,
  durationMs: 200,
};
const imageUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVSQAAAAASUVORK5CYII=";
const audioUrl =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
const longOutput =
  Array.from(
    { length: 120 },
    (_, i) => `完整记录 ${i}: ${"unbroken".repeat(30)}`,
  ).join("\n") + "\nFINAL_OUTPUT_SENTINEL";
const emptyCollaboration: Extract<ThreadItem, { type: "collabAgentToolCall" }> =
  {
    type: "collabAgentToolCall",
    id: "empty-collaboration",
    tool: "wait",
    status: "completed",
    senderThreadId: "mock-thread-010",
    receiverThreadIds: [],
    prompt: null,
    model: null,
    reasoningEffort: null,
    agentsStates: {},
  };
const crossTypeItems: ThreadItem[] = [
  emptyCollaboration,
  { ...emptyCollaboration, id: "whitespace-collaboration", prompt: " \n " },
  {
    ...emptyCollaboration,
    id: "linked-collaboration",
    receiverThreadIds: ["agent-result"],
  },
  { type: "imageView", id: "local-image-view", path: "/demo/reference.png" },
  {
    type: "imageGeneration",
    id: "local-image-generated",
    status: "completed",
    revisedPrompt: null,
    result: "",
    savedPath: "/demo/reference.png",
    failure: null,
  },
  {
    ...item,
    id: "mcp-empty-completed",
    tool: "empty_completed",
    result: { content: [], structuredContent: null, _meta: null },
  },
  {
    ...item,
    id: "mcp-empty-waiting",
    tool: "empty_waiting",
    status: "inProgress",
    result: null,
  },
  {
    type: "functionCallOutput",
    id: "oversized-output",
    name: "oversized_result",
    namespace: null,
    output: "RAW_START\n" + "raw_value_".repeat(6000) + "\nRAW_END",
  },

  {
    ...item,
    id: "mcp-json-mime",
    tool: "json_mime_resource",
    result: {
      content: [
        {
          type: "resource",
          resource: {
            uri: "memory://problem",
            mimeType: "Application/Problem+JSON ; charset=utf-8",
            text: '{"count":2}',
          },
        },
      ],
      structuredContent: null,
      _meta: null,
    },
  },
  {
    ...item,
    id: "mcp-html-resource",
    tool: "html_resource",
    result: {
      content: [
        {
          type: "resource",
          resource: {
            uri: "memory://source.html",
            mimeType: "text/html; charset=utf-8",
            text: '<section data-token="RAW_HTML_SENTINEL"><strong>Source remains literal</strong></section>',
          },
        },
      ],
      structuredContent: null,
      _meta: null,
    },
  },
  {
    type: "functionCallOutput",
    id: "function-large-integer",
    name: "precise_json",
    namespace: null,
    output:
      '{"precise":9007199254740993,"limit":1e400,"zero":-0,"fraction":0.1234567890123456789,"last":"BIGINT_END"}',
  },
  {
    type: "imageGeneration",
    id: "image-generation-failure",
    status: "failed",
    revisedPrompt: null,
    result: "",
    failure: {
      type: "usageLimitExceeded",
      limitId: "image-limit",
      resetsAt: null,
    },
  },
  {
    type: "functionCallOutput",
    id: "function-json",
    name: "json_result",
    namespace: null,
    output: JSON.stringify({
      nested: { valid: true },
      tail: "FUNCTION_JSON_END",
    }),
  },
  {
    type: "functionCallOutput",
    id: "function-markdown",
    name: "markdown_result",
    namespace: null,
    output:
      "### Function report\n\n| Check | Result |\n| --- | --- |\n| Complete | Yes |\n\n[Report link](https://example.com/function)",
  },
  {
    type: "functionCallOutput",
    id: "function-mixed",
    name: "mixed_result",
    namespace: null,
    output: [
      {
        type: "input_text",
        text: "### Mixed function report\n\n**All parts retained**",
      },
      { type: "input_image", image_url: imageUrl },
      { type: "input_audio", audio_url: audioUrl },
      { type: "input_text", text: longOutput },
    ],
  },
  {
    type: "dynamicToolCall",
    id: "dynamic-mixed",
    namespace: null,
    tool: "mixed_dynamic",
    arguments: { query: "media" },
    status: "completed",
    success: true,
    durationMs: 100,
    contentItems: [
      { type: "inputText", text: "### Dynamic report\n\n**Complete media**" },
      { type: "inputImage", imageUrl },
      { type: "inputAudio", audioUrl },
      { type: "inputText", text: longOutput },
    ],
  },
  {
    type: "dynamicToolCall",
    id: "dynamic-failure",
    namespace: null,
    tool: "failed_dynamic",
    arguments: {},
    status: "completed",
    success: false,
    durationMs: 100,
    contentItems: [
      {
        type: "inputText",
        text: "### Failure details\n\nPartial output remains available.",
      },
    ],
  },
  {
    ...item,
    id: "mcp-partial-error",
    tool: "partial_failure",
    status: "failed",
    error: { message: "工具调用失败：保留部分结果" },
    result: {
      content: [
        {
          type: "text",
          text: "### Partial MCP report\n\nUseful partial result.",
        },
      ],
      structuredContent: null,
      _meta: null,
    },
  },
  {
    ...item,
    id: "mcp-plain-resource",
    tool: "plain_resource",
    result: {
      content: [
        {
          type: "resource",
          resource: {
            uri: "memory://plain",
            mimeType: "text/plain",
            text: "# Literal heading\n**literal emphasis**\n" + longOutput,
          },
        },
      ],
      structuredContent: null,
      _meta: null,
    },
  },
  {
    type: "webSearch",
    id: "search-results",
    query: "search query",
    action: {
      type: "findInPage",
      url: "https://example.com/search-source",
      pattern: "important needle",
    },
    results: [
      {
        title: "Search result retained",
        url: "https://example.com/result",
        snippet: longOutput,
      },
    ],
  },
  {
    type: "collabAgentToolCall",
    id: "collab-markdown",
    tool: "sendMessage",
    status: "completed",
    senderThreadId: "mock-thread-010",
    receiverThreadIds: ["agent-result"],
    prompt: "### Collaboration request\n\n**Check all results**",
    model: null,
    reasoningEffort: null,
    agentsStates: {
      "agent-result": {
        status: "completed",
        message:
          "### Agent findings\n\n| Area | Result |\n| --- | --- |\n| Output | Complete |",
      },
    },
  },
  {
    type: "enteredReviewMode",
    id: "review-markdown",
    review:
      "### Review findings\n\n[Review reference](https://example.com/review)\n\n**No output omitted**",
  },
];
let server: ReturnType<typeof createMockServer>;
test.beforeEach(async ({ page }) => {
  server = createMockServer({
    initialActiveOperations: true,
    base64Files: { "/demo/reference.png": imageUrl.split(",")[1] },
    initialOperationItems: [
      ...crossTypeItems,
      item,
      {
        ...item,
        id: "tool-markdown",
        tool: "summary",
        result: {
          content: [
            {
              type: "text",
              text: "### 检查结果\n\n**验证通过**\n\n| 项目 | 结果 |\n| --- | --- |\n| 布局 | 稳定 |\n\n[查看详情](https://example.com/result)",
            },
          ],
          structuredContent: null,
          _meta: null,
        },
      },
      {
        ...item,
        id: "tool-structured",
        tool: "structured_only",
        result: { content: [], structuredContent: { count: 2 }, _meta: null },
      },
    ],
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing address");
  await page.route("**/codex-release", (route) =>
    route.fulfill({ json: { version: "0.160.0" } }),
  );
  await page.addInitScript((url) => {
    localStorage.setItem(
      "codex-environments",
      JSON.stringify([
        { id: "local", name: "本机", kind: "local", url, autoConnect: true },
      ]),
    );
    localStorage.setItem("codex-workbench.auto-collapse-process", "false");
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          Object.assign(window, { copiedToolOutput: text });
        },
      },
    });
  }, `ws://127.0.0.1:${address.port}`);
});
test.afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("empty operations have no disclosure or copy action while agent links remain available", async ({
  page,
}) => {
  await page.goto("/?env=local&session=mock-thread-010");
  for (const id of ["empty-collaboration", "whitespace-collaboration"]) {
    const tool = page.locator(`[data-reading-id="${id}"]`);
    await expect(tool).toBeVisible();
    await expect(tool).toHaveAttribute("data-expandable", "false");
    await expect(tool.locator("summary")).toHaveCount(0);
    await expect(tool.getByRole("button", { name: "复制输出" })).toHaveCount(0);
  }
  const linked = page.locator('[data-reading-id="linked-collaboration"]');
  await linked.locator(":scope > summary").click();
  await expect(
    linked.getByRole("button", { name: /查看子代理/ }),
  ).toBeVisible();
  await expect(linked.getByRole("button", { name: "复制输出" })).toHaveCount(0);
  const populated = page.locator('[data-reading-id="collab-markdown"]');
  await populated.locator(":scope > summary").click();
  await expect(
    populated.getByRole("button", { name: "复制输出" }),
  ).toBeVisible();
  await expect(populated).toContainText("Agent findings");
});

for (const width of [1440, 390]) {
  test(`MCP results are formatted, bounded and preserve complete copy at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?env=local&session=mock-thread-010");
    const tool = page.locator('[data-reading-id="glab-json"]');
    await tool.locator(":scope > summary").click();
    await expect(tool.getByText("返回结果", { exact: true })).toBeVisible();
    const result = tool.locator("code.language-json").nth(1);
    await expect(result).toContainText('"name": "demo-branch"');
    expect((await result.textContent())!.split("\n").length).toBeGreaterThan(
      20,
    );
    await expect(result.locator(".hljs-attr").first()).toBeAttached();
    await expect(tool.getByText(/"request_id"/)).toHaveCount(0);

    const output = result.locator(
      "xpath=ancestor::*[@data-radix-scroll-area-viewport][2]",
    );
    expect(await output.evaluate((el) => el.clientHeight)).toBeLessThanOrEqual(
      300,
    );
    expect(await output.evaluate((el) => el.scrollHeight)).toBeGreaterThan(300);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);

    await tool.getByRole("button", { name: "复制输出", exact: true }).click();
    const copied = await page.evaluate(
      () =>
        (window as unknown as { copiedToolOutput: string }).copiedToolOutput,
    );
    expect(copied).toContain(raw);
    expect(copied).toContain('"request_id": "demo-request"');
    await tool.getByText("结构化结果", { exact: true }).click();
    await expect(tool.locator("code.language-json").last()).toContainText(
      '"request_id": "demo-request"',
    );

    const markdown = page.locator('[data-reading-id="tool-markdown"]');
    await markdown.locator(":scope > summary").click();
    await expect(
      markdown.getByRole("heading", { name: "检查结果" }),
    ).toBeVisible();
    await expect(markdown.getByRole("table")).toBeVisible();
    await expect(
      markdown.getByRole("link", { name: "查看详情" }),
    ).toHaveAttribute("href", "https://example.com/result");

    const structured = page.locator('[data-reading-id="tool-structured"]');
    await structured.locator(":scope > summary").click();
    await expect(structured.locator("code.language-json").last()).toContainText(
      '"count": 2',
    );
    await expect(
      structured.getByText("结构化结果", { exact: true }),
    ).toHaveCount(0);
  });
}

for (const width of [1440, 390]) {
  test(`cross-type results retain formatted text, media, failures and complete copy at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?env=local&session=mock-thread-010");
    const conversationViewport = page.locator(
      '[data-slot="conversation-timeline"] > [data-radix-scroll-area-viewport]',
    );
    await conversationViewport.hover();
    await page.mouse.wheel(0, -300);
    await expect(page.getByRole("button", { name: /回到底部/ })).toBeVisible();
    const open = async (id: string) => {
      const row = page.locator(`[data-reading-id="${id}"]`);
      await row.locator(":scope > summary").click();
      return row;
    };
    const copy = async (row: import("@playwright/test").Locator) => {
      await page.evaluate(() =>
        Object.assign(window, { copiedToolOutput: null }),
      );
      await row.getByRole("button", { name: "复制输出", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { copiedToolOutput: string | null })
                .copiedToolOutput,
          ),
        )
        .not.toBeNull();
      return page.evaluate(
        () =>
          (window as unknown as { copiedToolOutput: string }).copiedToolOutput,
      );
    };
    const mimeJson = await open("mcp-json-mime");
    await expect(mimeJson.locator("code.language-json").last()).toContainText(
      '"count": 2',
    );
    await expect(
      mimeJson.locator("code.language-json").last().locator(".hljs-attr"),
    ).toBeAttached();
    const html = await open("mcp-html-resource");
    await expect(html).toContainText(
      '<section data-token="RAW_HTML_SENTINEL">',
    );
    await expect(html.locator("section[data-token]")).toHaveCount(0);
    expect(await copy(html)).toContain(
      "<strong>Source remains literal</strong>",
    );
    const precise = await open("function-large-integer");
    const preciseCode = precise.locator("code.language-json");
    for (const token of [
      "9007199254740993",
      "1e400",
      "-0",
      "0.1234567890123456789",
    ])
      await expect(preciseCode).toContainText(token);
    await expect(precise).not.toContainText("9007199254740992");
    expect(await copy(precise)).toContain("9007199254740993");
    const imageFailure = await open("image-generation-failure");
    await expect(imageFailure).toHaveAttribute("data-status", "failed");
    await expect(imageFailure).toContainText(
      /图片.*(?:额度|上限)|(?:额度|上限).*图片/,
    );
    const json = await open("function-json");
    await expect(json.locator("code.language-json")).toContainText(
      '"valid": true',
    );
    await expect(json.locator(".hljs-attr").first()).toBeAttached();
    const markdown = await open("function-markdown");
    await expect(
      markdown.getByRole("heading", { name: "Function report" }),
    ).toBeVisible();
    await expect(markdown.getByRole("table")).toBeVisible();
    await expect(
      markdown.getByRole("link", { name: "Report link" }),
    ).toHaveAttribute("href", "https://example.com/function");
    for (const [id, heading] of [
      ["function-mixed", "Mixed function report"],
      ["dynamic-mixed", "Dynamic report"],
    ]) {
      const row = await open(id);
      await expect(row.getByRole("heading", { name: heading })).toBeVisible();
      await expect(
        row.getByRole("img", { name: "工具返回图片" }),
      ).toBeVisible();
      await expect(row.locator("audio")).toHaveAttribute("src", audioUrl);
      await expect(row).toContainText("FINAL_OUTPUT_SENTINEL");
      const copied = await copy(row);
      expect(copied).toContain(longOutput);
      expect(copied).toContain(imageUrl);
      expect(copied).toContain(audioUrl);
      const viewport = row
        .getByText(/完整记录 0:/)
        .locator("xpath=ancestor::*[@data-radix-scroll-area-viewport][1]");
      expect(await viewport.evaluate((el) => el.scrollHeight)).toBeGreaterThan(
        await viewport.evaluate((el) => el.clientHeight),
      );
      await viewport.scrollIntoViewIfNeeded();
      await viewport.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await expect(row.getByText(/FINAL_OUTPUT_SENTINEL/)).toBeInViewport();
    }
    const failed = await open("dynamic-failure");
    await expect(failed).toHaveAttribute("data-status", "failed");
    await expect(
      failed.getByRole("heading", { name: "Failure details" }),
    ).toBeVisible();
    const partial = await open("mcp-partial-error");
    await expect(partial).toContainText("工具调用失败：保留部分结果");
    await expect(
      partial.getByRole("heading", { name: "Partial MCP report" }),
    ).toBeVisible();
    expect(await copy(partial)).toContain("Useful partial result.");
    const plain = await open("mcp-plain-resource");
    await expect(plain.getByRole("heading")).toHaveCount(0);
    await expect(plain).toContainText("# Literal heading");
    await expect(plain).toContainText("**literal emphasis**");
    expect(await copy(plain)).toContain(longOutput);
    const search = await open("search-results");
    await expect(search).toContainText("important needle");
    await expect(search).toContainText("https://example.com/search-source");
    await expect(search.locator("code.language-json")).toContainText(
      "Search result retained",
    );
    expect(await copy(search)).toContain("FINAL_OUTPUT_SENTINEL");
    const collab = await open("collab-markdown");
    await expect(
      collab.getByRole("heading", { name: "Collaboration request" }),
    ).toBeVisible();
    await expect(
      collab.getByRole("heading", { name: "Agent findings" }),
    ).toBeVisible();
    await expect(collab.getByRole("table")).toBeVisible();
    const review = await open("review-markdown");
    await expect(
      review.getByRole("heading", { name: "Review findings" }),
    ).toBeVisible();
    await expect(
      review.getByRole("link", { name: "Review reference" }),
    ).toHaveAttribute("href", "https://example.com/review");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });
}

test("local image results, empty tool states and oversized raw output remain usable", async ({
  page,
}) => {
  await page.goto("/?env=local&session=mock-thread-010");
  const open = async (id: string) => {
    const row = page.locator(`[data-reading-id="${id}"]`);
    const summary = row.locator(":scope > summary");
    if ((await summary.getAttribute("aria-expanded")) !== "true")
      await summary.click();
    return row;
  };
  for (const [id, name] of [
    ["local-image-view", "工具查看图片"],
    ["local-image-generated", "工具生成图片"],
  ]) {
    const row = await open(id);
    const image = row.getByRole("img", { name, exact: true });
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
    await row
      .getByRole("button", { name: `预览图片 ${name}`, exact: true })
      .click();
    await expect(page.getByRole("dialog", { name, exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "关闭图片预览", exact: true })
      .click();
  }
  const empty = await open("mcp-empty-completed");
  await expect(
    empty.getByText("工具未返回内容", { exact: true }),
  ).toBeVisible();
  const waiting = await open("mcp-empty-waiting");
  await expect(
    waiting.getByText("等待工具返回结果", { exact: true }),
  ).toBeVisible();
  const oversized = await open("oversized-output");
  const rawOutput = "RAW_START\n" + "raw_value_".repeat(6000) + "\nRAW_END";
  await expect(oversized.locator("pre")).toHaveText(rawOutput);
  await expect(oversized.locator("code.language-json")).toHaveCount(0);
  await oversized
    .getByRole("button", { name: "复制输出", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { copiedToolOutput: string }).copiedToolOutput,
      ),
    )
    .toContain(rawOutput);
});
