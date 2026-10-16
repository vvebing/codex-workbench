import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { posix } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import type { Thread } from "../../src/generated/v2/Thread.js";
import type { Turn } from "../../src/generated/v2/Turn.js";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem.js";

import type { AppInfo } from "../../src/generated/v2/AppInfo.js";
import type { ExternalAgentConfigMigrationItem } from "../../src/generated/v2/ExternalAgentConfigMigrationItem.js";
import type { ExternalAgentConfigImportItemTypeSuccess } from "../../src/generated/v2/ExternalAgentConfigImportItemTypeSuccess.js";
import type { UserInput } from "../../src/generated/v2/UserInput.js";
import type { ThreadGoal } from "../../src/generated/v2/ThreadGoal.js";
import type { ThreadAttachment } from "../../src/generated/v2/ThreadAttachment.js";
import type { ThreadSection } from "../../src/generated/v2/ThreadSection.js";
import type { ConfigReadResponse } from "../../src/generated/v2/ConfigReadResponse.js";

export const MOCK_WORKSPACES = [
  "/demo/atlas-web",
  "/demo/design-system",
  "/demo/api-service",
];
export interface MockOptions {
  initialImageMessage?: { input: UserInput[]; answer: string };
  base64Files?: Record<string, string>;
  resetCreditsCountOnly?: boolean;
  imageInput?: boolean;
  paginatedHistory?: boolean;
  initialActiveOperations?: boolean;
  mermaidAnswer?: string;
  subagentSessions?: boolean;
  gitStatus?: string | ((cwd: string) => string);
  gitStatusExitCode?: number;
  initialGitFiles?: [string, string][];
  gitWriteError?: string;
  initiallyArchived?: number;
  sameNamedWorkspaces?: boolean;
  streamIntervalMs?: number;
  externalWriter?: boolean;
  rejectEmptyThreadRead?: boolean;
  failThreadStartOnce?: boolean;
  failFirstTurnOnce?: boolean;
  externalActivity?: boolean;
  staleActiveAfterCompletion?: boolean;
  modelDefaultReasoningEffort?: "low" | "medium" | "high";
  responseDelayMs?: number | ((method: string, id: string | number) => number);
  externalPartialHistory?: boolean;
  externalUnloadedHistory?: boolean;
}
const answer =
  `## 实施结果\n\n已完成工作区导航与可访问性改进。所有内容均为虚构演示。\n\n| 检查项 | 状态 | 说明 |\n| --- | --- | --- |\n| 键盘导航 | 完成 | 支持焦点顺序 |\n| 空状态 | 完成 | 提供明确行动 |\n| 分页 | 完成 | 使用稳定游标 |\n\n\`\`\`ts\nexport function workspaceLabel(cwd: string) {\n  return cwd.split('/').filter(Boolean).at(-1) ?? '工作区';\n}\n\`\`\`\n\n` +
  Array.from(
    { length: 12 },
    (_, i) =>
      `### 验证 ${i + 1}\n\n在窄屏、长文本和多会话场景下，界面保持清晰。测试数据覆盖中文标题、Markdown 表格及代码块。下一步可以检查滚动位置、连接恢复和审批后的状态更新。\n\n`,
  ).join("");
const agent = (
  text: string,
): Extract<ThreadItem, { type: "agentMessage" }> => ({
  type: "agentMessage",
  id: randomUUID(),
  text,
  phase: "final_answer",
  memoryCitation: null,
  delivery: null,
  questions: null,
});
const now = () => Math.floor(Date.now() / 1000);
function makeTurn(text: string): Turn {
  return {
    id: randomUUID(),
    rootTurnId: null,
    items: [
      {
        type: "userMessage",
        id: randomUUID(),
        clientId: null,
        content: [{ type: "text", text, text_elements: [] }],
      },
      agent(answer),
    ],
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: now() - 10,
    completedAt: now(),
    durationMs: 1000,
  };
}
function makeThread(index: number, cwd = MOCK_WORKSPACES[index % 3]!): Thread {
  const title = [
    "工作区导航与搜索",
    "设计令牌与暗色模式",
    "接口分页与错误处理",
    "审批流程演示",
    "用户问题演示",
    "失败恢复演示",
    "断线恢复演示",
  ][index % 7]!;
  return {
    id: `mock-thread-${String(index + 1).padStart(3, "0")}`,
    sessionId: randomUUID(),
    forkedFromId: null,
    parentThreadId: null,
    preview: `请检查${title}，并给出实施建议。`,
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    historyMode: "legacy",
    modelProvider: "mock",
    model: "mock-codex",
    reasoningEffort: "medium",
    createdAt: now() - index * 3600,
    updatedAt: now() - index * 1800,
    recencyAt: now() - index * 1800,
    status: { type: "idle" },
    path: null,
    cwd,
    cliVersion: "mock-1.0",
    originator: "mock-workbench",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: {
      sha: "0000000000000000000000000000000000000000",
      branch: "demo/ui-polish",
      originUrl: null,
    },
    name: `${title} · ${index + 1}`,
    turns: [makeTurn(`请检查${title}`), makeTurn("补充边界情况和验证结果")],
  };
}
export function createMockServer(options: MockOptions = {}) {
  const gitBaselines = new Map<string, string>();
  const gitBlobs = new Map<string, string>();
  const files = new Map<string, string>();
  const directories = new Set([
    "/",
    "/demo",
    "/demo/atlas-web",
    "/demo/atlas-web/src",
    "/demo/atlas-web/tests",
    "/demo/empty",
    "/demo/中文项目",
  ]);
  for (const directory of directories)
    files.set(
      posix.join(directory, "README.md"),
      "# Demo project\nProject file preview.\n",
    );
  for (const root of MOCK_WORKSPACES) {
    files.set(`${root}/README.md`, "# Demo project\nProject file preview.\n");
    files.set(`${root}/src/app.ts`, 'export const app = "demo";\n');
    files.set(`${root}/.gitignore`, "node_modules/\n*.log\n");
  }
  files.set("/demo/atlas-web/package.json", '{"name":"demo-project"}\n');
  files.set("/demo/atlas-web/new-file.txt", "New file\n");
  const fileWatches = new Map<WebSocket, Map<string, string>>();
  const changed = (path: string) => {
    for (const [socket, watches] of fileWatches) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      for (const [watchId, watched] of watches)
        if (
          path === watched ||
          path.startsWith(`${watched.replace(/\/$/, "")}/`)
        )
          socket.send(
            JSON.stringify({
              method: "fs/changed",
              params: { watchId, changedPaths: [path] },
            }),
          );
    }
  };
  const fsPath = (value: unknown) => {
    if (
      typeof value !== "string" ||
      !value.startsWith("/") ||
      value.includes("\0")
    )
      throw new Error("Expected absolute filesystem path");
    return posix.normalize(value).replace(/\/$/, "") || "/";
  };
  const requireParent = (path: string) => {
    if (!directories.has(posix.dirname(path)))
      throw new Error("ENOENT: No such file or directory");
  };
  const gitStates = new Map<
    string,
    { branch: string; head: string; index: number; files: Map<string, string> }
  >();
  const gitState = (cwd: string) => {
    let state = gitStates.get(cwd);
    if (!state) {
      state = {
        branch: "demo/ui-polish",
        head: "a".repeat(40),
        index: 0,
        files: new Map(
          options.initialGitFiles ?? [
            ["src/app.ts", ".M"],
            ["package.json", "M."],
            ["new-file.txt", "??"],
          ],
        ),
      };
      gitStates.set(cwd, state);
    }
    return state;
  };

  const threads = Array.from({ length: 90 }, (_, i) => makeThread(i));
  if (options.initialImageMessage) {
    const items = threads[0].turns[0].items;
    const user = items.find((item) => item.type === "userMessage");
    const assistant = items.find((item) => item.type === "agentMessage");
    if (user?.type === "userMessage")
      user.content.push(...options.initialImageMessage.input);
    if (assistant?.type === "agentMessage")
      assistant.text = options.initialImageMessage.answer;
  }
  if (options.paginatedHistory)
    for (const thread of threads) thread.historyMode = "paginated";
  const goals = new Map<string, ThreadGoal>();
  const attachments = new Map<string, ThreadAttachment[]>();
  const sections: ThreadSection[] = [];
  const migrationHistory: {
    importId: string;
    providerId: string | null;
    completedAtMs: number;
    successes: ExternalAgentConfigImportItemTypeSuccess[];
    failures: [];
  }[] = [];
  const demoApp: AppInfo = {
    id: "mock-notes",
    name: "演示笔记",
    description: "仅用于端到端测试的应用",
    logoUrl: null,
    logoUrlDark: null,
    iconAssets: null,
    iconDarkAssets: null,
    distributionChannel: null,
    branding: null,
    appMetadata: null,
    labels: null,
    installUrl: null,
    isAccessible: true,
    isEnabled: true,
    pluginDisplayNames: [],
  };
  const configState: ConfigReadResponse = {
    config: {
      model: "mock-codex",
      review_model: null,
      model_context_window: null,
      model_auto_compact_token_limit: null,
      model_auto_compact_token_limit_scope: null,
      model_provider: "mock",
      approval_policy: "on-request",
      approvals_reviewer: "user",
      sandbox_mode: "workspace-write",
      sandbox_workspace_write: null,
      forced_chatgpt_workspace_id: null,
      forced_login_method: null,
      web_search: null,
      tools: null,
      instructions: null,
      developer_instructions: null,
      compact_prompt: null,
      model_reasoning_effort: null,
      model_reasoning_summary: null,
      model_verbosity: null,
      service_tier: null,
      analytics: null,
      browser_use: null,
      computer_use: null,
      desktop: null,
    },
    origins: {},
    layers: null,
  };
  const initialLifecycleItems = new Set<string>();
  if (options.initialActiveOperations) {
    const thread = threads[9];
    thread.historyMode = "paginated";
    thread.status = { type: "active", activeFlags: [] };
    const turn = thread.turns.at(-1)!;
    turn.status = "inProgress";
    turn.completedAt = null;
    turn.durationMs = null;
    const thought: ThreadItem = {
      type: "reasoning",
      id: randomUUID(),
      summary: ["已完成的历史思考"],
      content: [],
    };
    const image: ThreadItem = {
      type: "imageView",
      id: randomUUID(),
      path: "/demo/reference.png",
    };
    const live: ThreadItem = {
      type: "reasoning",
      id: randomUUID(),
      summary: ["当前仍在思考"],
      content: [],
    };
    const emptyThought: ThreadItem = {
      type: "reasoning",
      id: randomUUID(),
      summary: [],
      content: [],
    };
    const emptyLive: ThreadItem = {
      type: "reasoning",
      id: randomUUID(),
      summary: ["  "],
      content: [],
    };
    initialLifecycleItems.add(live.id);
    initialLifecycleItems.add(emptyLive.id);
    turn.items = [turn.items[0], thought, image, emptyThought, emptyLive, live];
  }
  const answerText = options.mermaidAnswer ?? answer;
  if (options.subagentSessions)
    for (const thread of threads) {
      thread.source = { subAgent: "review" };
      thread.parentThreadId = "parent-session";
    }
  const requestLog: {
    method: string;
    threadId?: string;
    searchTerm?: string;
    cwd?: string;
    command?: string[];
    sandboxPolicy?: { type: string };
    input?: UserInput[];
    migrationItems?: ExternalAgentConfigMigrationItem[];
    path?: string;
    watchId?: string;
    params?: Record<string, unknown>;
  }[] = [];
  const responseLog: {
    id: string | number;
    result?: unknown;
    error?: unknown;
  }[] = [];
  let listReads = 0;
  let resetCreditConsumed = false;
  if (options.sameNamedWorkspaces) threads[3]!.cwd = "/legacy/atlas-web";
  const archived = new Set(
    threads.slice(0, options.initiallyArchived ?? 0).map((thread) => thread.id),
  );
  const externalReads = new Map<string, number>();
  const server = createServer((req, res) =>
    res
      .writeHead(req.url === "/healthz" ? 200 : 404, {
        "Content-Type": "application/json",
      })
      .end(JSON.stringify({ status: "mock", threads: threads.length })),
  );
  const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 * 1024 });
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  };
  wss.on("connection", (socket) => {
    let initialized = false,
      ready = false;
    const pending = new Map<
      string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Exercise runtime JSON-RPC envelopes including advertised protocol extensions.
      { decisions?: string[]; resume: (value: any) => void }
    >();
    const active = new Map<
      string,
      { turn: Turn; finish: (status: Turn["status"]) => void }
    >();
    const send = (value: unknown) => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify(value));
    };
    const notify = (method: string, params: unknown) =>
      send({ method, params });
    const reply = (id: string | number, result: unknown, method: string) =>
      later(
        () => send({ id, result }),
        typeof options.responseDelayMs === "function"
          ? options.responseDelayMs(method, id)
          : (options.responseDelayMs ?? 0),
      );
    const fail = (id: string | number, message: string) =>
      send({ id, error: { code: -32602, message } });
    const get = (id: string) => {
      const thread = threads.find((t) => t.id === id);
      if (!thread) throw Error("Unknown thread");
      return thread;
    };
    const metadata = (t: Thread) => ({ ...t, turns: [] });
    const config = (t: Thread, history = true) => ({
      thread: history ? t : metadata(t),
      model: t.model,
      modelProvider: "mock",
      serviceTier: null,
      disabledPluginIds: [],
      cwd: t.cwd,
      instructionSources: [],
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: {
        type: "workspaceWrite",
        writableRoots: [t.cwd],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
      reasoningEffort: "medium",
    });
    socket.on("message", (raw) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Exercise runtime JSON-RPC envelopes including advertised protocol extensions.
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send({
          id: null,
          error: { code: -32700, message: "Invalid JSON" },
        });
      }
      if (!msg.method) {
        responseLog.push({ id: msg.id, result: msg.result, error: msg.error });
        const callback = pending.get(String(msg.id));
        if (callback) {
          if (
            callback.decisions &&
            !callback.decisions.includes(msg.result?.decision)
          ) {
            fail(msg.id, "Decision is not available");
            return;
          }
          pending.delete(String(msg.id));
          callback.resume(msg.result);
        }
        return;
      }
      const { id, method } = msg;
      requestLog.push({
        method,
        ...(method.startsWith("fs/")
          ? {
              params: msg.params,
              path: msg.params?.path,
              watchId: msg.params?.watchId,
            }
          : {}),
        threadId: msg.params?.threadId,
        ...(method === "turn/start" ? { input: msg.params?.input } : {}),
        ...(method === "externalAgentConfig/import"
          ? { migrationItems: msg.params?.migrationItems }
          : {}),
        ...(method === "thread/list" && msg.params?.searchTerm
          ? { searchTerm: msg.params.searchTerm }
          : {}),
        ...(method === "config/read" ? { cwd: msg.params?.cwd } : {}),
        ...(method === "command/exec"
          ? {
              cwd: msg.params?.cwd,
              command: msg.params?.command,
              sandboxPolicy: msg.params?.sandboxPolicy,
            }
          : {}),
      });
      const p = msg.params ?? {};
      if (method === "initialized") {
        if (initialized) ready = true;
        return;
      }
      if (method === "initialize") {
        if (initialized) return fail(id, "Already initialized");
        initialized = true;
        return reply(
          id,
          {
            userAgent: "codex-workbench-mock/1.0",
            platformFamily: "unix",
            platformOs: "mock",
          },
          method,
        );
      }
      if (!ready) return fail(id, "Call initialize then initialized first");
      try {
        if (method === "app/list")
          return reply(id, { data: [demoApp], nextCursor: null }, method);
        if (method === "app/installed") return reply(id, { apps: [] }, method);
        if (method === "externalAgentConfig/detect") {
          const cwd = p.cwds?.[0] ?? null;
          const items: ExternalAgentConfigMigrationItem[] = [
            {
              itemType: "AGENTS_MD",
              description: "导入演示代理说明",
              cwd,
              details: null,
            },
            {
              itemType: "CONFIG",
              description: "导入演示模型配置",
              cwd,
              details: null,
            },
          ];
          return reply(id, { items, connectors: [] }, method);
        }
        if (method === "externalAgentConfig/import/readHistories")
          return reply(id, { data: migrationHistory, connectors: [] }, method);
        if (method === "externalAgentConfig/import") {
          const importId = randomUUID();
          const migrationItems =
            p.migrationItems as ExternalAgentConfigMigrationItem[];
          const successes: ExternalAgentConfigImportItemTypeSuccess[] =
            migrationItems.map((item) => ({
              itemType: item.itemType,
              cwd: item.cwd,
              source: "/demo/source",
              target: "/demo/target",
              title: null,
            }));
          reply(id, { importId }, method);
          const itemTypeResults = successes.map((success) => ({
            itemType: success.itemType,
            successes: [success],
            failures: [],
          }));
          later(
            () =>
              notify("externalAgentConfig/import/progress", {
                importId,
                itemTypeResults,
              }),
            100,
          );
          later(() => {
            migrationHistory.push({
              importId,
              providerId: null,
              completedAtMs: Date.now(),
              successes,
              failures: [],
            });
            notify("externalAgentConfig/import/completed", {
              importId,
              itemTypeResults,
            });
          }, 300);
          return;
        }
        if (method === "fs/watch") {
          const watches = fileWatches.get(socket) ?? new Map<string, string>();
          watches.set(p.watchId, fsPath(p.path));
          fileWatches.set(socket, watches);
          return reply(id, { path: p.path }, method);
        }
        if (method === "fs/unwatch") {
          fileWatches.get(socket)?.delete(p.watchId);
          return reply(id, {}, method);
        }
        if (method === "threadSection/list")
          return reply(id, { data: sections, nextCursor: null }, method);
        if (method === "threadSection/create") {
          const section: ThreadSection = {
            id: randomUUID(),
            name: p.name,
            appearance: p.appearance ?? null,
          };
          sections.push(section);
          return reply(id, { section }, method);
        }
        if (method === "threadSection/update") {
          const section = sections.find((entry) => entry.id === p.sectionId);
          if (!section) throw Error("Section not found");
          section.name = p.name;
          for (const thread of threads)
            if (thread.section?.id === section.id) thread.section = section;
          return reply(id, { section }, method);
        }
        if (method === "threadSection/delete") {
          const index = sections.findIndex((entry) => entry.id === p.sectionId);
          if (index < 0) throw Error("Section not found");
          sections.splice(index, 1);
          for (const thread of threads)
            if (thread.section?.id === p.sectionId) thread.section = null;
          return reply(id, {}, method);
        }
        if (method === "account/login/start") {
          if (p.type === "apiKey") return reply(id, { type: "apiKey" }, method);
          const loginId = randomUUID();
          return reply(
            id,
            p.type === "chatgptDeviceCode"
              ? {
                  type: p.type,
                  loginId,
                  verificationUrl: "https://example.invalid/device",
                  userCode: "DEMO-1234",
                }
              : {
                  type: "chatgpt",
                  loginId,
                  authUrl: "https://example.invalid/login",
                },
            method,
          );
        }
        if (method === "account/login/cancel")
          return reply(id, { status: "canceled" }, method);
        if (method === "account/logout") return reply(id, {}, method);
        if (method === "config/read") return reply(id, configState, method);
        if (method === "config/value/write") {
          configState.config[p.keyPath] = p.value;
          return reply(
            id,
            {
              status: "ok",
              version: randomUUID(),
              filePath: "/demo/config.toml",
              overriddenMetadata: null,
            },
            method,
          );
        }
        if (method === "configRequirements/read")
          return reply(id, { requirements: null }, method);
        if (method === "mcpServerStatus/list")
          return reply(
            id,
            {
              data: [
                {
                  name: "demo-mcp",
                  runtimeStatus: "connected",
                  pluginId: null,
                  httpOrigin: "https://example.invalid",
                  serverInfo: null,
                  serverCapabilities: {},
                  tools: {},
                  toolsError: null,
                  resources: [],
                  resourceTemplates: [],
                  authStatus: "notLoggedIn",
                },
              ],
              nextCursor: null,
            },
            method,
          );
        if (method === "mcpServer/oauth/login")
          return reply(
            id,
            {
              authorizationUrl: "https://example.invalid/mcp",
              loginId: "demo-oauth",
            },
            method,
          );
        if (method === "config/mcpServer/reload") return reply(id, {}, method);
        if (method === "thread/attachmentOwner/list") {
          return reply(
            id,
            {
              data: [...attachments.entries()]
                .filter(([, entries]) =>
                  entries.some(
                    (entry) =>
                      entry.attachmentType === p.attachmentType &&
                      entry.identityKey === p.identityKey,
                  ),
                )
                .map(([threadId]) => ({
                  threadId,
                  archived: archived.has(threadId),
                })),
              nextCursor: null,
            },
            method,
          );
        }
        if (method === "command/exec") {
          const args: string[] = p.command ?? [];
          const result = (stdout = "", exitCode = 0, stderr = "") =>
            reply(id, { exitCode, stdout, stderr }, method);
          if (args[0] !== "git")
            return fail(id, "Only Git commands supported by mock");
          const state = gitState(p.cwd);
          if (
            args.includes("rev-parse") &&
            args.includes("--verify") &&
            args.at(-1)?.includes(":")
          )
            return result(
              `${args.at(-1)!.startsWith("HEAD:") ? "c".repeat(40) : "d".repeat(40)}\n`,
            );
          if (args.includes("ls-files") && args.includes("--stage")) {
            const path = `${p.cwd}/${args.at(-1)}`;
            const baseline = gitBaselines.get(path) ?? files.get(path);
            if (
              baseline === undefined ||
              state.files.get(args.at(-1)!) === "??"
            )
              return result("");
            const oid = createHash("sha1").update(baseline).digest("hex");
            gitBlobs.set(oid, baseline);
            return result(`100644 ${oid} 0\t${args.at(-1)}\0`);
          }
          if (args.includes("cat-file") && gitBlobs.has(args.at(-1)!)) {
            const content = gitBlobs.get(args.at(-1)!)!;
            return result(
              args.includes("-s") ? `${Buffer.byteLength(content)}\n` : content,
            );
          }
          if (args.includes("cat-file"))
            return result(
              args.includes("-s")
                ? "7\n"
                : args.at(-1) === "c".repeat(40)
                  ? "before\n"
                  : "after\n",
            );
          if (args.includes("rev-parse"))
            return result(
              args.includes("--show-toplevel")
                ? `${p.cwd}\n`
                : `${state.head}\n`,
            );
          if (args.includes("check-ignore")) {
            const paths = args
              .slice(args.indexOf("--") + 1)
              .filter(
                (path) =>
                  path === "node_modules" ||
                  path.startsWith("node_modules/") ||
                  path.endsWith(".log"),
              );
            return result(
              paths.length
                ? paths
                    .map((path) =>
                      /[\n\r\t"\\]/.test(path) ? JSON.stringify(path) : path,
                    )
                    .join("\n") + "\n"
                : "",
              paths.length ? 0 : 1,
            );
          }
          if (args.includes("symbolic-ref")) return result(`${state.branch}\n`);
          if (args.includes("ls-files"))
            return result(`index-${state.index}\0`);
          if (args.includes("for-each-ref"))
            return result("demo/ui-polish\nfeature/ui\n");
          if (args.includes("config"))
            return result(
              args.at(-1)?.endsWith(".remote")
                ? "origin\n"
                : "refs/heads/main\n",
            );
          if (args.includes("remote"))
            return result("https://example.invalid/demo/repository.git\n");
          const write = [
            "add",
            "restore",
            "rm",
            "commit",
            "switch",
            "push",
          ].find((command) => args.includes(command));
          if (write) {
            if (options.gitWriteError)
              return result("", 1, options.gitWriteError);
            const path = args.at(-1)!;
            const paths = args.slice(args.indexOf("--") + 1);
            if (write === "add")
              for (const path of paths)
                state.files.set(
                  path,
                  state.files.get(path) === "??" ? "A." : "M.",
                );
            if (write === "restore" || write === "rm")
              for (const path of paths)
                state.files.set(
                  path,
                  state.files.get(path)?.startsWith("A") ? "??" : ".M",
                );
            if (write === "commit") {
              for (const [path, xy] of state.files)
                if (xy[0] !== "." && xy[0] !== "?") {
                  if (xy[1] === ".") state.files.delete(path);
                  else state.files.set(path, `.${xy[1]}`);
                }
              state.head = "b".repeat(40);
            }
            if (write === "switch") state.branch = path;
            if (write !== "switch" && write !== "push") state.index++;
            return result("ok\n");
          }
          if (args.includes("diff")) {
            const path = args.at(-1);
            return result(
              `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-before\n+after\n`,
              args.includes("--no-index") ? 1 : 0,
            );
          }
          if (!args.includes("status"))
            return fail(id, "Unsupported mock Git command");
          const stdout =
            typeof options.gitStatus === "function"
              ? options.gitStatus(p.cwd)
              : (options.gitStatus ??
                `# branch.oid ${state.head}\0# branch.head ${state.branch}\0` +
                  [...state.files]
                    .map(([path, xy]) =>
                      xy === "??"
                        ? `? ${path}\0`
                        : `1 ${xy} N... 100644 100644 100644 abc abc ${path}\0`,
                    )
                    .join(""));
          return result(stdout, options.gitStatusExitCode ?? 0);
        }
        if (method === "thread/list") {
          if (options.externalActivity) {
            listReads++;
            // Simulate another client changing activity without broadcasting to this connection.
            if (listReads > 1) threads[9]!.updatedAt = now() + listReads;
            threads[9]!.status =
              listReads === 2
                ? { type: "active", activeFlags: [] }
                : { type: "idle" };
          }
          const cwd = typeof p.cwd === "string" ? [p.cwd] : p.cwd;
          const list = threads.filter(
            (t) =>
              archived.has(t.id) === !!p.archived &&
              (!cwd || cwd.includes(t.cwd)) &&
              (!p.searchTerm || t.name?.includes(p.searchTerm)) &&
              (p.sectionId === undefined ||
                (t.section?.id ?? null) === p.sectionId),
          );
          const sort = p.sortKey === "updated_at" ? "updatedAt" : "createdAt";
          list.sort(
            (a, b) =>
              (b[sort] - a[sort] || a.id.localeCompare(b.id)) *
              (p.sortDirection === "asc" ? -1 : 1),
          );
          let offset = 0;
          if (p.cursor) {
            const anchor = Buffer.from(p.cursor, "base64url").toString();
            const index = list.findIndex((t) => t.id === anchor);
            if (index < 0) throw Error("Invalid cursor for this query");
            offset = index + 1;
          }
          const limit = Math.max(1, Math.min(100, p.limit ?? 25));
          const page = list.slice(offset, offset + limit);
          return reply(
            id,
            {
              data: page.map(metadata),
              nextCursor:
                offset + limit < list.length
                  ? Buffer.from(page.at(-1)!.id).toString("base64url")
                  : null,
              backwardsCursor: page.length
                ? Buffer.from(page[0]!.id).toString("base64url")
                : null,
            },
            method,
          );
        }
        if (method === "skills/list")
          return reply(
            id,
            {
              data: [
                {
                  cwd: p.cwds?.[0] || MOCK_WORKSPACES[0],
                  skills: [
                    {
                      name: "review",
                      description: "检查代码",
                      path: "/demo/skills/review/SKILL.md",
                      enabled: true,
                      scope: "user",
                      pluginId: null,
                    },
                  ],
                  errors: [],
                },
              ],
            },
            method,
          );
        if (method === "fs/readDirectory") {
          const path = fsPath(p.path);
          if (!directories.has(path))
            return fail(id, "ENOENT: No such file or directory");
          const entries = [
            ...[...directories]
              .filter(
                (entry) => entry !== path && posix.dirname(entry) === path,
              )
              .map((entry) => ({
                fileName: posix.basename(entry),
                isDirectory: true,
                isFile: false,
              })),
            ...[...files.keys()]
              .filter(
                (entry) =>
                  posix.dirname(entry) === path &&
                  posix.basename(entry) !== ".gitignore",
              )
              .map((entry) => ({
                fileName: posix.basename(entry),
                isDirectory: false,
                isFile: true,
              })),
          ];
          return reply(id, { entries }, method);
        }
        if (method === "fs/readFile") {
          const path = fsPath(p.path);
          if (options.base64Files?.[path])
            return reply(id, { dataBase64: options.base64Files[path] }, method);
          const text = files.get(path);
          if (text === undefined)
            return fail(id, "ENOENT: No such file or directory");
          return reply(
            id,
            { dataBase64: Buffer.from(text).toString("base64") },
            method,
          );
        }
        if (method === "fs/getMetadata") {
          const path = fsPath(p.path);
          if (!files.has(path) && !directories.has(path))
            return fail(id, "ENOENT: No such file or directory");
          return reply(
            id,
            {
              isDirectory: directories.has(path),
              isFile: files.has(path),
              isSymlink: false,
              createdAtMs: 1,
              modifiedAtMs: 1,
            },
            method,
          );
        }
        if (method === "fs/writeFile") {
          const path = fsPath(p.path);
          requireParent(path);
          if (directories.has(path))
            return fail(id, "EISDIR: Path is a directory");
          if (typeof p.dataBase64 !== "string")
            return fail(id, "Expected base64 file content");
          files.set(path, Buffer.from(p.dataBase64, "base64").toString("utf8"));
          changed(path);
          return reply(id, {}, method);
        }
        if (method === "fs/createDirectory") {
          const path = fsPath(p.path);
          if (files.has(path)) return fail(id, "EEXIST: File exists");
          if (p.recursive === false) requireParent(path);
          else {
            let parent = posix.dirname(path);
            while (!directories.has(parent)) {
              if (files.has(parent))
                return fail(id, "ENOTDIR: Parent is a file");
              directories.add(parent);
              parent = posix.dirname(parent);
            }
          }
          directories.add(path);
          changed(path);
          return reply(id, {}, method);
        }
        if (method === "fs/copy") {
          const source = fsPath(p.sourcePath),
            destination = fsPath(p.destinationPath);
          if (!files.has(source) && !directories.has(source))
            return fail(id, "ENOENT: No such file or directory");
          if (files.has(destination) || directories.has(destination))
            return fail(id, "EEXIST: Destination exists");
          requireParent(destination);
          if (directories.has(source)) {
            if (!p.recursive)
              return fail(id, "Directory copy requires recursive: true");
            if (destination.startsWith(`${source}/`))
              return fail(id, "Cannot copy directory into itself");
            for (const entry of [...directories])
              if (entry === source || entry.startsWith(`${source}/`))
                directories.add(destination + entry.slice(source.length));
            for (const [entry, text] of [...files])
              if (entry.startsWith(`${source}/`))
                files.set(destination + entry.slice(source.length), text);
          } else files.set(destination, files.get(source)!);
          changed(destination);
          return reply(id, {}, method);
        }
        if (method === "fs/remove") {
          const path = fsPath(p.path);
          if (!files.has(path) && !directories.has(path) && p.force === false)
            return fail(id, "ENOENT: No such file or directory");
          if (
            directories.has(path) &&
            p.recursive === false &&
            [...directories, ...files.keys()].some((entry) =>
              entry.startsWith(`${path}/`),
            )
          )
            return fail(id, "ENOTEMPTY: Directory is not empty");
          for (const entry of [...files.keys()])
            if (entry === path || entry.startsWith(`${path}/`))
              files.delete(entry);
          for (const entry of [...directories])
            if (entry === path || entry.startsWith(`${path}/`))
              directories.delete(entry);
          changed(path);
          return reply(id, {}, method);
        }
        if (method === "fuzzyFileSearch")
          return reply(
            id,
            {
              files: [
                {
                  root: p.roots[0],
                  path: "node_modules/app.ts",
                  file_name: "app.ts",
                  score: 200,
                  indices: null,
                  match_type: "file",
                },
                {
                  root: p.roots[0],
                  path: "app.log",
                  file_name: "app.log",
                  score: 150,
                  indices: null,
                  match_type: "file",
                },
                {
                  root: p.roots[0],
                  path: "src/app.ts",
                  file_name: "app.ts",
                  score: 100,
                  indices: null,
                  match_type: "file",
                },
              ],
            },
            method,
          );
        if (method === "model/list")
          return reply(
            id,
            {
              data: [
                {
                  id: "mock-codex",
                  model: "mock-codex",
                  displayName: "Mock Codex · 演示",
                  description: "本地虚构模型，不调用真实模型",
                  upgrade: null,
                  upgradeInfo: null,
                  availabilityNux: null,
                  modelSpecialty: null,
                  hidden: false,
                  supportedReasoningEfforts: ["low", "medium", "high"].map(
                    (reasoningEffort) => ({
                      reasoningEffort,
                      description: reasoningEffort,
                    }),
                  ),
                  defaultReasoningEffort:
                    options.modelDefaultReasoningEffort ?? "medium",
                  inputModalities: options.imageInput
                    ? ["text", "image"]
                    : ["text"],
                  supportsPersonality: false,
                  multiAgentVersion: null,
                  additionalSpeedTiers: [],
                  serviceTiers: [],
                  defaultServiceTier: null,
                  availableAccessPrograms: null,
                  isDefault: true,
                },
              ],
              nextCursor: null,
            },
            method,
          );
        if (method === "account/rateLimitResetCredit/consume") {
          const outcome = resetCreditConsumed ? "alreadyRedeemed" : "reset";
          resetCreditConsumed = true;
          return reply(id, { outcome }, method);
        }
        if (method === "account/rateLimits/read")
          return reply(
            id,
            {
              ordinaryUsageAllowed: true,
              rateLimits: {
                limitId: "codex",
                limitName: "Codex",
                normalModelSlug: null,
                primary: {
                  usedPercent: resetCreditConsumed ? 0 : 25,
                  windowDurationMins: 300,
                  resetsAt: now() + 3600,
                },
                secondary: null,
                credits: null,
                individualLimit: null,
                spendControlReached: null,
                planType: "plus",
                rateLimitReachedType: null,
              },
              rateLimitsByLimitId: null,
              rateLimitResetCredits: {
                availableCount: resetCreditConsumed ? 0 : 1,
                credits: resetCreditConsumed
                  ? []
                  : options.resetCreditsCountOnly
                    ? null
                    : [
                        {
                          id: "mock-reset-credit",
                          resetType: "codexRateLimits",
                          status: "available",
                          grantedAt: now() - 86400,
                          expiresAt: now() + 86400,
                          title: "演示重置机会",
                          description: "重置符合条件的 Codex 用量窗口。",
                        },
                      ],
              },
              accountId: null,
              rateLimitUpsell: null,
            },
            method,
          );
        if (method === "account/read")
          return reply(
            id,
            {
              account: {
                type: "chatgpt",
                email: "demo@example.invalid",
                planType: "plus",
              },
              requiresOpenaiAuth: false,
            },
            method,
          );
        if (method === "thread/start") {
          if (options.failThreadStartOnce) {
            options.failThreadStartOnce = false;
            throw Error("模拟创建失败");
          }
          const t = makeThread(threads.length, p.cwd ?? MOCK_WORKSPACES[0]);
          t.id = randomUUID();
          t.turns = [];
          if (options.paginatedHistory) t.historyMode = "paginated";
          t.name = null;
          t.preview = "";
          threads.unshift(t);
          reply(id, config(t, false), method);
          notify("thread/started", { thread: metadata(t) });
          return;
        }
        const t = get(p.threadId);
        if (method === "thread/goal/get")
          return reply(id, { goal: goals.get(t.id) ?? null }, method);
        if (method === "thread/goal/set") {
          if (p.origin !== "user")
            throw Error("Explicit user goal action required");
          const old = goals.get(t.id);
          const goal: ThreadGoal = {
            threadId: t.id,
            objective: p.objective ?? old?.objective ?? "",
            status: p.status ?? old?.status ?? "active",
            tokenBudget: p.tokenBudget ?? null,
            tokensUsed:
              old && old.objective === p.objective ? old.tokensUsed : 0,
            timeUsedSeconds:
              old && old.objective === p.objective ? old.timeUsedSeconds : 0,
            createdAt: old?.createdAt ?? now(),
            updatedAt: now(),
          };
          goals.set(t.id, goal);
          reply(id, { goal }, method);
          notify("thread/goal/updated", { threadId: t.id, turnId: null, goal });
          return;
        }
        if (method === "thread/goal/clear") {
          const cleared = goals.delete(t.id);
          reply(id, { cleared }, method);
          notify("thread/goal/cleared", { threadId: t.id });
          return;
        }
        if (method === "thread/attachment/list")
          return reply(
            id,
            { data: attachments.get(t.id) ?? [], nextCursor: null },
            method,
          );
        if (method === "thread/attachment/add") {
          const entries = attachments.get(t.id) ?? [];
          const existing = entries.find(
            (entry) =>
              entry.attachmentType === p.attachmentType &&
              entry.identityKey === p.identityKey,
          );
          const attachment: ThreadAttachment = existing ?? {
            id: randomUUID(),
            attachmentType: p.attachmentType,
            identityKey: p.identityKey,
            payload: p.payload,
            createdAt: now(),
          };
          if (!existing) entries.push(attachment);
          attachments.set(t.id, entries);
          reply(
            id,
            { outcome: existing ? "existing" : "created", attachment },
            method,
          );
          if (!existing)
            notify("thread/attachment/updated", {
              threadId: t.id,
              attachmentType: attachment.attachmentType,
              identityKey: attachment.identityKey,
              attachmentId: attachment.id,
              operation: "created",
            });
          return;
        }
        if (method === "thread/attachment/remove") {
          const entries = attachments.get(t.id) ?? [];
          const index = entries.findIndex(
            (entry) =>
              entry.attachmentType === p.attachmentType &&
              entry.identityKey === p.identityKey,
          );
          if (index < 0) throw Error("Attachment not found");
          const [attachment] = entries.splice(index, 1);
          reply(id, {}, method);
          notify("thread/attachment/updated", {
            threadId: t.id,
            attachmentType: attachment.attachmentType,
            identityKey: attachment.identityKey,
            attachmentId: attachment.id,
            operation: "deleted",
          });
          return;
        }
        if (method === "thread/metadata/update") {
          Object.assign(t, { isPinned: p.isPinned });
          return reply(id, { thread: metadata(t) }, method);
        }
        if (method === "thread/section/move") {
          t.section = p.sectionId
            ? (sections.find((entry) => entry.id === p.sectionId) ?? null)
            : null;
          t.sectionEnteredAt = t.section ? now() : null;
          return reply(id, {}, method);
        }
        if (method === "thread/delete") {
          threads.splice(threads.indexOf(t), 1);
          archived.delete(t.id);
          goals.delete(t.id);
          attachments.delete(t.id);
          return reply(id, {}, method);
        }
        if (method === "review/start") {
          const turn = makeTurn("代码审查");
          turn.status = "inProgress";
          turn.completedAt = null;
          turn.items = [
            {
              type: "enteredReviewMode",
              id: randomUUID(),
              review: p.target.type,
            },
          ];
          t.turns.push(turn);
          t.status = { type: "active", activeFlags: [] };
          reply(id, { turn, reviewThreadId: t.id }, method);
          notify("turn/started", { threadId: t.id, turn });
          later(() => {
            const item = agent("模拟代码审查完成：未发现阻塞问题。");
            turn.items.push(item);
            notify("item/started", { threadId: t.id, turnId: turn.id, item });
            notify("item/completed", { threadId: t.id, turnId: turn.id, item });
            turn.status = "completed";
            turn.completedAt = now();
            t.status = { type: "idle" };
            notify("turn/completed", { threadId: t.id, turn });
            notify("thread/status/changed", {
              threadId: t.id,
              status: t.status,
            });
          }, 300);
          return;
        }
        if (
          options.rejectEmptyThreadRead &&
          ["thread/read", "thread/resume"].includes(method) &&
          !t.turns.length
        )
          throw Error("会话不存在：空会话尚未保存");
        if (options.externalWriter && method === "thread/read") {
          t.status = { type: "active", activeFlags: [] };
          t.turns.at(-1)!.status = "inProgress";
        }
        if (options.externalWriter && method === "thread/resume")
          return fail(id, `thread ${t.id} already has an active writer`);
        if (
          (options.externalPartialHistory || options.externalUnloadedHistory) &&
          method === "thread/read"
        ) {
          const reads =
            (externalReads.get(t.id) ?? 0) + (p.includeTurns ? 1 : 0);
          externalReads.set(t.id, reads);
          t.status = {
            type:
              options.externalUnloadedHistory || reads <= 1
                ? "notLoaded"
                : "idle",
          };
          t.updatedAt = now();
          const turn = t.turns.at(-1)!;
          turn.completedAt = null;
          turn.durationMs = null;
          turn.status =
            options.externalUnloadedHistory || reads <= 1
              ? "interrupted"
              : "inProgress";
          if (reads > 1) {
            const last = turn.items.findLast(
              (item) => item.type === "agentMessage",
            );
            if (last?.type === "agentMessage")
              last.text = "终端仍在执行，历史持续更新";
          }
        }
        if (options.externalPartialHistory && method === "thread/resume")
          return fail(id, `thread ${t.id} already has an active writer`);
        if (
          options.externalWriter &&
          method === "thread/read" &&
          p.includeTurns
        ) {
          const reads = (externalReads.get(t.id) ?? 0) + 1;
          externalReads.set(t.id, reads);
          if (reads === 2) {
            const last = t.turns
              .at(-1)
              ?.items.findLast((item) => item.type === "agentMessage");
            if (last?.type === "agentMessage")
              last.text += "\n\n终端新增输出已同步";
          }
        }
        if (
          method === "thread/read" &&
          t.historyMode === "paginated" &&
          p.includeTurns
        )
          return fail(
            id,
            "Full-history hydration is deprecated for paginated threads; use paginated history methods.",
          );
        if (method === "thread/resume" || method === "thread/read")
          return reply(
            id,
            method === "thread/read"
              ? { thread: p.includeTurns ? t : metadata(t) }
              : config(t),
            method,
          );
        if (method === "thread/turns/list")
          return reply(
            id,
            {
              data:
                p.sortDirection === "desc" ? [...t.turns].reverse() : t.turns,
              nextCursor: null,
            },
            method,
          );
        if (method === "thread/items/list") {
          const turn = t.turns.find((turn) => turn.id === p.turnId);
          if (!turn) throw Error("Unknown turn");
          return reply(
            id,
            {
              data: turn.items.map((item) => ({
                turnId: turn.id,
                item,
                startedAtMs: (turn.startedAt ?? now()) * 1000,
                completedAtMs:
                  initialLifecycleItems.has(item.id) ||
                  ("status" in item &&
                    (item.status === "inProgress" ||
                      item.status === "in_progress"))
                    ? null
                    : (turn.completedAt ?? now()) * 1000,
              })),
              nextCursor: null,
              backwardsCursor: null,
            },
            method,
          );
        }
        if (method === "thread/revert") {
          const index = t.turns.findIndex((turn) => turn.id === p.beforeTurnId);
          if (index < 0 || t.status.type === "active")
            throw Error("Invalid revert");
          t.turns = t.turns.slice(0, index);
          return reply(id, { thread: metadata(t) }, method);
        }
        if (method === "thread/name/set") {
          t.name = p.name;
          reply(id, {}, method);
          notify("thread/name/updated", { threadId: t.id, threadName: t.name });
          return;
        }
        if (method === "thread/unarchive") {
          archived.delete(t.id);
          reply(id, {}, method);
          notify("thread/unarchived", { threadId: t.id });
          return;
        }
        if (method === "thread/archive") {
          archived.add(t.id);
          reply(id, {}, method);
          notify("thread/archived", { threadId: t.id });
          return;
        }
        if (method === "thread/fork") {
          const fork = structuredClone(t);
          fork.id = randomUUID();
          fork.forkedFromId = t.id;
          fork.name = `${t.name ?? "新会话"} · 分支`;
          if (p.lastTurnId) {
            const i = fork.turns.findIndex((turn) => turn.id === p.lastTurnId);
            if (i < 0 || fork.turns[i]!.status === "inProgress")
              throw Error("Invalid lastTurnId");
            fork.turns = fork.turns.slice(0, i + 1);
          }
          fork.cwd = p.cwd ?? t.cwd;
          threads.unshift(fork);
          return reply(id, config(fork, !p.excludeTurns), method);
        }
        if (method === "turn/interrupt") {
          const run = active.get(t.id);
          if (!run || run.turn.id !== p.turnId)
            throw Error("No matching active turn");
          run.finish("interrupted");
          return reply(id, {}, method);
        }
        if (method === "turn/steer") {
          const run = active.get(t.id);
          if (!run || run.turn.id !== p.expectedTurnId)
            throw Error("No matching active turn");
          const item: ThreadItem = {
            type: "userMessage",
            id: randomUUID(),
            clientId: null,
            content: p.input,
          };
          run.turn.items.push(item);
          notify("item/completed", {
            threadId: t.id,
            turnId: run.turn.id,
            item,
          });
          return reply(id, { turnId: run.turn.id }, method);
        }
        if (method !== "turn/start")
          throw Error(`Unsupported method: ${method}`);
        if (options.failFirstTurnOnce) {
          options.failFirstTurnOnce = false;
          throw Error("模拟首条消息发送失败");
        }
        if (active.has(t.id)) throw Error("Turn already active");
        const text = (p.input ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Exercise runtime JSON-RPC envelopes including advertised protocol extensions.
          .filter((x: any) => x.type === "text")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Exercise runtime JSON-RPC envelopes including advertised protocol extensions.
          .map((x: any) => x.text)
          .join("\n");
        const turn = makeTurn(text);
        const user = turn.items[0];
        if (user.type === "userMessage") user.content = p.input ?? [];
        turn.items = turn.items.slice(0, 1);
        turn.status = "inProgress";
        turn.completedAt = null;
        turn.durationMs = null;
        turn.startedAt = now();
        t.turns.push(turn);
        t.updatedAt = now();
        t.preview = text;
        t.status = { type: "active", activeFlags: [] };
        let done = false;
        const finish = (status: Turn["status"]) => {
          if (done) return;
          done = true;
          pending.forEach((v, k) => {
            if (k.startsWith(turn.id)) pending.delete(k);
          });
          turn.status = status;
          turn.completedAt = now();
          turn.durationMs = (turn.completedAt - turn.startedAt!) * 1000;
          if (status === "failed")
            turn.error = {
              message: "模拟服务暂时不可用，请重试。",
              codexErrorInfo: null,
              additionalDetails: null,
              misalignment: null,
            };
          active.delete(t.id);
          if (!options.staleActiveAfterCompletion) t.status = { type: "idle" };
          notify("turn/completed", { threadId: t.id, turn });
          notify("thread/status/changed", { threadId: t.id, status: t.status });
        };
        active.set(t.id, { turn, finish });
        reply(id, { turn: { ...turn, items: [] } }, method);
        const base = { threadId: t.id, turnId: turn.id };
        const completeItem = (item: ThreadItem) => {
          turn.items.push(item);
          notify("item/started", { ...base, item });
          notify("item/completed", { ...base, item });
        };
        const run = () => {
          if (done || socket.readyState !== WebSocket.OPEN) return;
          if (/disconnect|断线/.test(text)) {
            socket.close(1011, "Simulated disconnect");
            active.delete(t.id);
            turn.status = "interrupted";
            t.status = { type: "idle" };
            return;
          }
          if (/fail|失败/.test(text)) {
            notify("error", {
              ...base,
              error: {
                message: "模拟失败",
                codexErrorInfo: null,
                additionalDetails: null,
                misalignment: null,
              },
              willRetry: false,
            });
            finish("failed");
            return;
          }
          notify("turn/plan/updated", {
            ...base,
            explanation: "检查并完善演示工作区",
            plan: [
              { step: "检查现状", status: "completed" },
              { step: "实施修改", status: "inProgress" },
              { step: "验证结果", status: "pending" },
            ],
          });
          completeItem({
            type: "reasoning",
            id: randomUUID(),
            summary: ["检查布局、状态和恢复行为。"],
            content: [],
          });
          if (text.includes("operation-lifecycle-progress")) {
            const progress = agent("中间进展：正在检查执行结果。");
            progress.phase = "commentary";
            completeItem(progress);
          }
          const command: ThreadItem = {
            type: "commandExecution",
            id: randomUUID(),
            pluginId: null,
            scriptPath: null,
            command: "npm run test",
            cwd: t.cwd,
            processId: "mock-process",
            source: "agent",
            status: "completed",
            commandActions: [],
            aggregatedOutput: "✓ 24 tests passed\n",
            exitCode: 0,
            durationMs: 640,
          };
          command.status = "inProgress";
          command.exitCode = null;
          command.durationMs = null;
          turn.items.push(command);
          notify("item/started", {
            ...base,
            item: {
              ...command,
              status: "inProgress",
              aggregatedOutput: null,
              exitCode: null,
              durationMs: null,
            },
          });
          if (text.includes("operation-rich"))
            command.aggregatedOutput =
              Array.from(
                { length: 100 },
                (_, index) => `日志第 ${index + 1} 行`,
              ).join("\n") + "\n完整输出末尾";
          notify("item/commandExecution/outputDelta", {
            ...base,
            itemId: command.id,
            delta: command.aggregatedOutput ?? "",
          });
          if (text.includes("operation-parallel")) {
            const parallel: Extract<ThreadItem, { type: "commandExecution" }> =
              {
                ...command,
                id: randomUUID(),
                command: "parallel-check",
                status: "inProgress",
                aggregatedOutput: "并行任务启动",
                exitCode: null,
                durationMs: null,
              };
            turn.items.push(parallel);
            notify("item/started", { ...base, item: parallel });
            later(() => {
              if (done) return;
              parallel.status = "completed";
              parallel.exitCode = 0;
              parallel.aggregatedOutput += "\n并行任务完成";
              notify("item/completed", { ...base, item: parallel });
            }, 4500);
          }
          const continueRun = () => {
            if (done) return;
            command.status = "completed";
            command.exitCode = 0;
            command.durationMs = 640;
            if (text.includes("operation-error")) {
              command.status = "failed";
              command.exitCode = 1;
              command.aggregatedOutput = "模拟命令执行错误";
            }
            notify("item/completed", { ...base, item: command });
            if (text.includes("operation-summary-updates")) {
              for (let index = 1; index <= 2; index++)
                completeItem({
                  ...command,
                  id: randomUUID(),
                  command: `summary-command-${index}`,
                });
              for (const [index, delay] of [
                [3, 3000],
                [4, 6000],
              ]) {
                const next: Extract<ThreadItem, { type: "commandExecution" }> =
                  {
                    ...command,
                    id: randomUUID(),
                    command: `summary-command-${index}`,
                    status: "inProgress",
                    aggregatedOutput: "正在执行后续命令",
                    exitCode: null,
                    durationMs: null,
                  };
                later(() => {
                  if (done) return;
                  turn.items.push(next);
                  notify("item/started", {
                    ...base,
                    item: next,
                    startedAtMs: Date.now(),
                  });
                }, delay);
                later(() => {
                  if (done) return;
                  next.status = "completed";
                  next.exitCode = 0;
                  next.durationMs = 1000;
                  notify("item/completed", {
                    ...base,
                    item: next,
                    completedAtMs: Date.now(),
                  });
                }, delay + 1000);
              }
              later(() => {
                if (done) return;
                completeItem(agent("后续命令已完成"));
                finish("completed");
              }, 8500);
              return;
            }
            if (text.includes("operation-history")) {
              for (let index = 0; index < 14; index++)
                completeItem({
                  ...command,
                  id: randomUUID(),
                  command: `history-command-${index}`,
                  status: "completed",
                });
              completeItem({
                ...command,
                id: randomUUID(),
                command: "historical-error",
                status: "failed",
                exitCode: 1,
                aggregatedOutput: "保留历史错误原因",
              });
            }
            if (
              [
                "agent-detail",
                "agent-stream",
                "agent-reconnect",
                "agent-nested",
                "agent-confirmation",
              ].some((marker) => text.includes(marker))
            ) {
              const childTurn = makeTurn("子代理验证协议");
              childTurn.status = "inProgress";
              childTurn.completedAt = null;
              childTurn.durationMs = null;
              const childMessage = agent("正在检查协议");
              childMessage.phase = "commentary";
              const childCommand: Extract<
                ThreadItem,
                { type: "commandExecution" }
              > = {
                ...command,
                id: randomUUID(),
                command: "检查连接事件",
                status: "inProgress",
                aggregatedOutput: "开始检查",
                exitCode: null,
                durationMs: null,
              };
              childTurn.items = [
                childTurn.items[0],
                childMessage,
                childCommand,
              ];
              const child: Thread = {
                ...makeThread(0),
                id: randomUUID(),
                parentThreadId: t.id,
                sessionId: t.sessionId,
                source: { subAgent: "review" },
                agentNickname: "协议检查",
                agentRole: "reviewer",
                name: "子代理详情",
                status: { type: "active", activeFlags: [] },
                turns: [childTurn],
              };
              threads.push(child);
              notify("thread/started", { thread: { ...child, turns: [] } });
              const childBase = { threadId: child.id, turnId: childTurn.id };
              completeItem({
                type: "collabAgentToolCall",
                id: randomUUID(),
                tool: "spawnAgent",
                status: "completed",
                senderThreadId: t.id,
                receiverThreadIds: [child.id],
                prompt: "检查协议支持",
                model: null,
                reasoningEffort: null,
                agentsStates: {
                  [child.id]: { status: "running", message: null },
                },
              });
              if (text.includes("agent-nested")) {
                const grandchild: Thread = {
                  ...makeThread(0),
                  id: randomUUID(),
                  parentThreadId: child.id,
                  sessionId: t.sessionId,
                  source: { subAgent: "review" },
                  agentNickname: "日志检查",
                  agentRole: "reviewer",
                  turns: [makeTurn("下级代理验证日志")],
                };
                threads.push(grandchild);
                notify("thread/started", {
                  thread: { ...grandchild, turns: [] },
                });
                childTurn.items.push({
                  type: "collabAgentToolCall",
                  id: randomUUID(),
                  tool: "spawnAgent",
                  status: "completed",
                  senderThreadId: child.id,
                  receiverThreadIds: [grandchild.id],
                  prompt: "验证日志",
                  model: null,
                  reasoningEffort: null,
                  agentsStates: {
                    [grandchild.id]: {
                      status: "completed",
                      message: "日志通过",
                    },
                  },
                });
              }
              later(() => {
                childCommand.aggregatedOutput += "\n实时事件：检查连接";
                notify("item/commandExecution/outputDelta", {
                  ...childBase,
                  itemId: childCommand.id,
                  delta: "\n实时事件：检查连接",
                });
              }, 2000);
              const completeChild = (
                status: "completed" | "interrupted" = "completed",
              ) => {
                childCommand.status = "completed";
                childCommand.exitCode = 0;
                childCommand.durationMs = 4500;
                notify("item/completed", { ...childBase, item: childCommand });
                const result = agent(
                  status === "completed" ? "协议验证完成" : "子代理任务已中断",
                );
                childTurn.items.push(result);
                notify("item/started", { ...childBase, item: result });
                notify("item/completed", { ...childBase, item: result });
                childTurn.status = status;
                childTurn.completedAt = now();
                childTurn.durationMs = 4500;
                child.status = { type: "idle" };
                notify("turn/completed", {
                  threadId: child.id,
                  turn: childTurn,
                });
                notify("thread/status/changed", {
                  threadId: child.id,
                  status: child.status,
                });
              };
              if (text.includes("agent-confirmation")) {
                const requestId = `${child.id}-approval`;
                later(() => {
                  child.status = {
                    type: "active",
                    activeFlags: ["waitingOnApproval"],
                  };
                  pending.set(requestId, {
                    decisions: ["accept", "decline", "cancel"],
                    resume: (value) => {
                      notify("serverRequest/resolved", {
                        threadId: child.id,
                        requestId,
                      });
                      completeChild(
                        value.decision === "accept"
                          ? "completed"
                          : "interrupted",
                      );
                    },
                  });
                  send({
                    id: requestId,
                    method: "item/commandExecution/requestApproval",
                    params: {
                      ...childBase,
                      itemId: childCommand.id,
                      startedAtMs: Date.now(),
                      environmentId: null,
                      command: childCommand.command,
                      cwd: child.cwd,
                      reason: "子代理检查连接需要确认",
                      availableDecisions: ["accept", "decline", "cancel"],
                    },
                  });
                }, 1500);
              } else later(() => completeChild(), 4500);
            }
            if (text.includes("operation-rich")) {
              const png =
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVSQAAAAASUVORK5CYII=";
              const mcp: Extract<ThreadItem, { type: "mcpToolCall" }> = {
                type: "mcpToolCall",
                id: randomUUID(),
                server: "demo",
                tool: "media-result",
                status: "inProgress",
                arguments: { query: "示例" },
                appContext: null,
                mcpAppUi: null,
                pluginId: null,
                readOnlyHint: true,
                result: null,
                error: null,
                durationMs: null,
              };
              turn.items.push(mcp);
              notify("item/started", { ...base, item: mcp });
              notify("item/mcpToolCall/progress", {
                ...base,
                itemId: mcp.id,
                message: "媒体准备完成",
              });
              mcp.status = "completed";
              mcp.result = {
                content: [
                  { type: "text", text: "媒体结果返回" },
                  { type: "image", mimeType: "image/png", data: png },
                  {
                    type: "audio",
                    mimeType: "audio/wav",
                    data: "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=",
                  },
                  {
                    type: "resource_link",
                    name: "参考资源",
                    uri: "https://example.com/resource",
                  },
                  {
                    type: "resource",
                    resource: {
                      uri: "memory://result",
                      mimeType: "text/plain",
                      text: "内嵌资源内容",
                    },
                  },
                ],
                structuredContent: { count: 2 },
                _meta: null,
              };
              notify("item/completed", { ...base, item: mcp });
            }
            const diff =
              '--- a/src/navigation.ts\n+++ b/src/navigation.ts\n@@ -1 +1 @@\n-export const label = "Workspace";\n+export const label = "工作区";\n';
            completeItem({
              type: "fileChange",
              id: randomUUID(),
              changes: [
                {
                  path: `${t.cwd}/src/navigation.ts`,
                  kind: { type: "update", move_path: null },
                  diff,
                },
                ...(text.includes("operation-rich")
                  ? [
                      {
                        path: `${t.cwd}/src/activity.ts`,
                        kind: { type: "update" as const, move_path: null },
                        diff: "--- a/src/activity.ts\n+++ b/src/activity.ts\n@@ -1 +1 @@\n-oldState\n+newState",
                      },
                    ]
                  : []),
              ],
              status: "completed",
            });
            notify("turn/diff/updated", { ...base, diff });
            const item = agent("");
            turn.items.push(item);
            notify("item/started", { ...base, item });
            let cursor = 0;
            const chunk = () => {
              if (done || socket.readyState !== WebSocket.OPEN) return;
              const delta = answerText.slice(cursor, cursor + 80);
              cursor += 80;
              item.text += delta;
              notify("item/agentMessage/delta", {
                ...base,
                itemId: item.id,
                delta,
              });
              if (cursor < answerText.length)
                later(chunk, options.streamIntervalMs ?? 25);
              else {
                notify("item/completed", { ...base, item });
                notify("turn/plan/updated", {
                  ...base,
                  explanation: null,
                  plan: [
                    { step: "检查现状", status: "completed" },
                    { step: "实施修改", status: "completed" },
                    { step: "验证结果", status: "completed" },
                  ],
                });
                if (text.includes("operation-parallel"))
                  later(() => finish("completed"), 3500);
                else finish("completed");
              }
            };
            chunk();
          };
          if (
            text.includes("operation-lifecycle") ||
            text.includes("operation-error") ||
            text.includes("operation-parallel")
          )
            later(continueRun, 1600);
          else continueRun();
        };
        later(
          () => {
            if (done) return;
            notify("turn/started", {
              threadId: t.id,
              turn: { ...turn, items: [] },
            });
            notify("item/completed", { ...base, item: turn.items[0] });
            if (/approval|审批/.test(text)) {
              const requestId = `${turn.id}-approval`;
              const itemId = randomUUID();
              const decisions = ["accept", "decline", "cancel"];
              pending.set(requestId, {
                decisions,
                resume: (value) =>
                  value.decision === "accept" ? run() : finish("interrupted"),
              });
              send({
                id: requestId,
                method: /文件审批/.test(text)
                  ? "item/fileChange/requestApproval"
                  : "item/commandExecution/requestApproval",
                params: {
                  ...base,
                  itemId,
                  kind: "command",
                  startedAtMs: Date.now(),
                  environmentId: null,
                  command: "npm run test",
                  cwd: t.cwd,
                  reason: "演示命令审批；不会执行真实命令",
                  availableDecisions: decisions,
                },
              });
              return;
            }
            if (/question|问题/.test(text)) {
              const requestId = `${turn.id}-question`;
              pending.set(requestId, { resume: () => run() });
              send({
                id: requestId,
                method: "item/tool/requestUserInput",
                params: {
                  ...base,
                  itemId: randomUUID(),
                  isBlocking: true,
                  autoResolutionMs: null,
                  questions: [
                    {
                      id: "layout",
                      header: "布局",
                      question: "请选择导航布局，或输入自定义方案。",
                      isOther: true,
                      isSecret: false,
                      options: [
                        { label: "侧栏", description: "适合多工作区" },
                        { label: "顶部", description: "保留横向空间" },
                      ],
                    },
                    {
                      id: "demoSecret",
                      header: "测试密钥",
                      question: "输入虚构测试口令（请勿填写真实密钥）。",
                      isOther: true,
                      isSecret: true,
                      options: null,
                    },
                  ],
                },
              });
              return;
            }
            run();
          },
          /slow|慢/.test(text) ? 800 : 20,
        );
      } catch (error) {
        fail(id, error instanceof Error ? error.message : "Invalid request");
      }
    });
    socket.on("close", () => {
      fileWatches.delete(socket);
      for (const [threadId, { turn }] of active.entries()) {
        const thread = threads.find((t) => t.id === threadId);
        if (thread) thread.status = { type: "idle" };
        turn.status = "interrupted";
        turn.completedAt = now();
      }
      active.clear();
      pending.clear();
    });
  });
  const close = server.close.bind(server);
  server.close = ((callback?: (error?: Error) => void) => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const socket of wss.clients) socket.terminate();
    wss.close();
    return close(callback);
  }) as typeof server.close;
  return Object.assign(server, {
    requestLog,
    responseLog,
    setDirectory(path: string) {
      directories.add(fsPath(path));
      changed(fsPath(path));
    },
    setGitBaseline(path: string, text: string) {
      gitBaselines.set(fsPath(path), text);
      changed(fsPath(path));
    },
    setFile(path: string, text: string) {
      path = fsPath(path);
      files.set(path, text);
      changed(path);
    },
    fileText(path: string) {
      return files.get(fsPath(path));
    },
    publish(message: {
      method: string;
      params: unknown;
      id?: string | number;
    }) {
      for (const socket of wss.clients)
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify(message));
    },
    releaseWriter() {
      options.externalWriter = false;
      for (const thread of threads) {
        thread.status = { type: "idle" };
        const turn = thread.turns.at(-1);
        if (turn?.status === "inProgress") {
          turn.status = "completed";
          turn.completedAt = now();
        }
      }
    },
  });
}
