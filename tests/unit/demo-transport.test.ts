import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexClient } from "../../src/lib/rpc";
import { DemoService, DemoSocket } from "../../src/demo/transport";
import {
  DEMO_ENDPOINT,
  DEMO_FIRST_THREAD,
  MODIFIED,
  ORIGINAL,
} from "../../src/demo/data";
import { readGitComparison } from "../../src/features/files/git-content";
import {
  parseWorkspaceGitStatus,
  gitStatusCommand,
} from "../../src/features/shell/git-status";
import type { Thread } from "../../src/generated/v2/Thread";
import type { Turn } from "../../src/generated/v2/Turn";
import type { FsReadFileResponse } from "../../src/generated/v2/FsReadFileResponse";
import type { CommandExecResponse } from "../../src/generated/v2/CommandExecResponse";

const clients: CodexClient[] = [];
async function connect(service = new DemoService()) {
  const client = new CodexClient({
    bridgeUrl: "ws://unused.invalid",
    webSocketFactory: () => new DemoSocket(service),
  });
  clients.push(client);
  await client.connect(DEMO_ENDPOINT);
  return client;
}
afterEach(() => {
  clients.splice(0).forEach((client) => client.disconnect());
  vi.useRealTimers();
});

describe("browser demo through the production JSON-RPC client", () => {
  it("loads protocol history, filters searches and keeps new services independent", async () => {
    const client = await connect();
    const history = await client.request<{ thread: Thread }>("thread/read", {
      threadId: DEMO_FIRST_THREAD,
      includeTurns: true,
    });
    expect(history.thread.turns[0].items).toHaveLength(2);
    const list = await client.request<{ data: Thread[] }>("thread/list", {
      searchTerm: "搜索",
    });
    expect(list.data.map((thread) => thread.id)).toEqual([DEMO_FIRST_THREAD]);
    await client.request("thread/name/set", {
      threadId: DEMO_FIRST_THREAD,
      name: "changed",
    });
    const fresh = await connect();
    expect(
      (
        await fresh.request<{ thread: Thread }>("thread/read", {
          threadId: DEMO_FIRST_THREAD,
        })
      ).thread.name,
    ).toBe("为项目列表添加搜索");
  });
  it("feeds real Git status and streaming comparison code without running commands", async () => {
    const client = await connect();
    const response = await client.request<CommandExecResponse>(
      "command/exec",
      gitStatusCommand("/demo/atlas-web"),
    );
    expect(parseWorkspaceGitStatus(response.stdout).files[0].path).toBe(
      "src/ProjectList.tsx",
    );
    const comparison = await readGitComparison(client, {
      cwd: "/demo/atlas-web",
      path: "src/ProjectList.tsx",
      group: "unstaged",
    });
    expect(comparison.comparison.original).toBe(ORIGINAL);
    expect(comparison.modified).toBe(MODIFIED);
    await expect(
      client.request("command/exec", {
        command: ["sh", "-c", "echo hi"],
        cwd: "/demo/atlas-web",
      }),
    ).rejects.toThrow("演示模式不执行终端命令");
    await expect(
      client.request("command/exec", {
        command: ["git", "push"],
        cwd: "/demo/atlas-web",
      }),
    ).rejects.toThrow("未在演示中模拟");
  });
  it("saves UTF-8 only in virtual files and uses client-provided watch IDs", async () => {
    const client = await connect();
    const changes: string[] = [];
    client.onNotification((message) => {
      if (message.method === "fs/changed") changes.push(message.params.watchId);
    });
    await client.request("fs/watch", {
      path: "/demo/atlas-web",
      watchId: "editor-watch",
    });
    const text = "# 中文演示\n";
    await client.request("fs/writeFile", {
      path: "/demo/atlas-web/README.md",
      dataBase64: Buffer.from(text).toString("base64"),
    });
    const result = await client.request<FsReadFileResponse>("fs/readFile", {
      path: "/demo/atlas-web/README.md",
    });
    expect(Buffer.from(result.dataBase64, "base64").toString()).toBe(text);
    expect(changes).toEqual(["editor-watch"]);
    await expect(
      client.request("fs/readFile", { path: "/etc/passwd" }),
    ).rejects.toThrow("不在演示文件系统");
    await expect(
      client.request("fs/writeFile", {
        path: "/demo/atlas-web/../secret",
        dataBase64: "",
      }),
    ).rejects.toThrow("演示项目内");
  });
  it("completes simulated turns and cancels pending replies when interrupted", async () => {
    vi.useFakeTimers();
    const client = await connect();
    const events: string[] = [];
    client.onNotification((message) => events.push(message.method));
    const { turn } = await client.request<{ turn: Turn }>("turn/start", {
      threadId: DEMO_FIRST_THREAD,
      input: [{ type: "text", text: "hello", text_elements: [] }],
      clientUserMessageId: "local-echo",
    });
    await vi.advanceTimersByTimeAsync(1000);
    const read = await client.request<{ thread: Thread }>("thread/read", {
      threadId: DEMO_FIRST_THREAD,
      includeTurns: true,
    });
    expect(read.thread.turns.at(-1)?.status).toBe("completed");
    expect(read.thread.turns.at(-1)?.items[0]).toMatchObject({
      clientId: "local-echo",
    });
    expect(events).toContain("turn/completed");
    expect(read.thread.turns.at(-1)?.id).toBe(turn.id);
    const next = await client.request<{ turn: Turn }>("turn/start", {
      threadId: DEMO_FIRST_THREAD,
      input: [{ type: "text", text: "stop", text_elements: [] }],
    });
    await client.request("turn/interrupt", {
      threadId: DEMO_FIRST_THREAD,
      turnId: next.turn.id,
    });
    await vi.advanceTimersByTimeAsync(1000);
    const stopped = await client.request<{ thread: Thread }>("thread/read", {
      threadId: DEMO_FIRST_THREAD,
      includeTurns: true,
    });
    expect(stopped.thread.turns.at(-1)).toMatchObject({
      status: "interrupted",
      items: [{ type: "userMessage" }],
    });
  });
  it("rejects real endpoints and unsupported operations instead of pretending success", async () => {
    const client = new CodexClient({
      bridgeUrl: "ws://unused.invalid",
      webSocketFactory: () => new DemoSocket(new DemoService()),
    });
    clients.push(client);
    await expect(client.connect("ws://127.0.0.1:4501")).rejects.toThrow(
      "不会建立真实网络连接",
    );
    const demo = await connect();
    await expect(demo.request("account/logout")).rejects.toThrow(
      "演示模式未模拟此操作",
    );
  });
});
