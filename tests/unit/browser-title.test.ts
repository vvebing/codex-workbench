import { expect, it } from "vitest";
import { browserTitle } from "../../src/features/navigation/browser-title";
import { placeholderThread } from "../../src/lib/state";
import type { Thread } from "../../src/generated/v2/Thread";
import type { RpcRequest } from "../../src/lib/rpc";

const thread: Thread = { ...placeholderThread("selected"), name: "实现搜索" };
const idle = { thread, connected: true, pendingRequests: [] };
const running: Thread = {
  ...thread,
  status: { type: "active", activeFlags: [] },
};
const question = (threadId: string): RpcRequest => ({
  id: "question",
  method: "item/tool/requestUserInput",
  params: {
    threadId,
    turnId: "turn",
    itemId: "item",
    questions: [],
    isBlocking: true,
    autoResolutionMs: null,
  },
});

it("uses the brand for home or an unsent draft and includes the environment only when supplied", () => {
  expect(browserTitle({ ...idle, thread: undefined })).toBe("Codex 工作台");
  expect(
    browserTitle({ ...idle, draft: true, environmentName: "开发机" }),
  ).toBe("Codex 工作台");
  expect(browserTitle(idle)).toBe("实现搜索 · Codex 工作台");
  expect(browserTitle({ ...idle, environmentName: "开发机" })).toBe(
    "实现搜索 · 开发机 · Codex 工作台",
  );
});

it("reflects the selected session's running and waiting status with waiting taking priority", () => {
  expect(browserTitle({ ...idle, thread: running })).toBe(
    "执行中 · 实现搜索 · Codex 工作台",
  );
  expect(
    browserTitle({
      ...idle,
      thread: running,
      pendingRequests: [question(thread.id)],
    }),
  ).toBe("待确认 · 实现搜索 · Codex 工作台");
  expect(
    browserTitle({
      ...idle,
      thread: {
        ...running,
        status: { type: "active", activeFlags: ["waitingOnApproval"] },
      },
    }),
  ).toBe("待确认 · 实现搜索 · Codex 工作台");
  expect(
    browserTitle({ ...idle, pendingRequests: [question("background")] }),
  ).toBe("实现搜索 · Codex 工作台");
});

it("does not advertise stale execution or requests after disconnect", () => {
  expect(
    browserTitle({
      ...idle,
      thread: running,
      connected: false,
      pendingRequests: [question(thread.id)],
    }),
  ).toBe("实现搜索 · Codex 工作台");
});

it("matches sidebar preview labels for unnamed sessions without falling back to cwd", () => {
  const unnamed = {
    ...thread,
    name: null,
    preview: "检查搜索逻辑",
    cwd: "/private/workspace",
  };
  expect(browserTitle({ ...idle, thread: unnamed })).toBe(
    "检查搜索逻辑 · Codex 工作台",
  );
  expect(
    browserTitle({
      ...idle,
      thread: { ...unnamed, id: "other", preview: "修复导航" },
    }),
  ).toBe("修复导航 · Codex 工作台");
  expect(browserTitle({ ...idle, thread: { ...unnamed, preview: "" } })).toBe(
    "新会话 · Codex 工作台",
  );
  expect(browserTitle({ ...idle, thread: { ...thread, name: "新标题" } })).toBe(
    "新标题 · Codex 工作台",
  );
  const longName = "长标题".repeat(100);
  expect(browserTitle({ ...idle, thread: { ...thread, name: longName } })).toBe(
    `${longName} · Codex 工作台`,
  );
  expect(
    browserTitle({ ...idle, thread: { ...thread, name: "  标题\n换行  " } }),
  ).toBe("标题 换行 · Codex 工作台");
});
