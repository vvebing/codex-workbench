import { t } from "../lib/i18n";
import type { SocketLike, RpcNotification } from "../lib/rpc";
import type { Thread } from "../generated/v2/Thread";
import type { Turn } from "../generated/v2/Turn";
import type { UserInput } from "../generated/v2/UserInput";
import {
  DEMO_ENDPOINT,
  DEMO_MODEL,
  DEMO_PROJECTS,
  ORIGINAL,
  agent,
  demoFiles,
  makeThread,
  makeTurn,
  now,
} from "./data";

type Params = Record<string, unknown>;
const asString = (value: unknown) => (typeof value === "string" ? value : "");
const record = (value: unknown): Params =>
  value !== null && typeof value === "object" ? (value as Params) : {};
const encode = (text: string) =>
  btoa(
    Array.from(new TextEncoder().encode(text), (byte) =>
      String.fromCharCode(byte),
    ).join(""),
  );
const decode = (text: string) =>
  new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(atob(text), (c) => c.charCodeAt(0)),
  );
const metadata = (thread: Thread) => ({ ...thread, turns: [] });
const configuration = (thread: Thread) => ({
  thread,
  model: "demo-codex",
  modelProvider: "demo",
  serviceTier: null,
  disabledPluginIds: [],
  cwd: thread.cwd,
  instructionSources: [],
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  sandbox: { type: "readOnly" },
  reasoningEffort: "medium",
});
class DemoError extends Error {
  constructor(
    message: string,
    readonly code = -32000,
  ) {
    super(message);
  }
}

/** Browser-only JSON-RPC service. No fetch, WebSocket, shell, or real filesystem. */
export class DemoService {
  readonly threads = Array.from({ length: 6 }, (_, index) => makeThread(index));
  private files = demoFiles();
  private versions = new Map(
    [...this.files].map(([path, text], index) => [
      path,
      {
        oid: (index + 1).toString(16).padStart(40, "0"),
        text: path.endsWith("/src/ProjectList.tsx") ? ORIGINAL : text,
      },
    ]),
  );
  private archived = new Set<string>();
  private sockets = new Set<DemoSocket>();
  private watches = new Map<DemoSocket, Map<string, string>>();
  private active = new Map<
    string,
    { turn: Turn; timer: ReturnType<typeof setTimeout>; socket: DemoSocket }
  >();
  attach(socket: DemoSocket) {
    this.sockets.add(socket);
  }
  detach(socket: DemoSocket) {
    this.sockets.delete(socket);
    this.watches.delete(socket);
    for (const [id, run] of this.active) {
      if (run.socket !== socket) continue;
      clearTimeout(run.timer);
      this.finish(id, "interrupted");
    }
  }
  private notify(method: RpcNotification["method"], params: unknown) {
    for (const socket of this.sockets) socket.deliver({ method, params });
  }
  private getThread(id: unknown) {
    const thread = this.threads.find((thread) => thread.id === id);
    if (!thread)
      throw new DemoError(t("演示会话不存在，请选择其他会话或重置演示。"));
    return thread;
  }
  private finish(id: string, status: "completed" | "interrupted") {
    const run = this.active.get(id);
    if (!run) return;
    clearTimeout(run.timer);
    this.active.delete(id);
    run.turn.status = status;
    run.turn.completedAt = now();
    run.turn.durationMs = 900;
    const thread = this.getThread(id);
    thread.status = { type: "idle" };
    this.notify("turn/completed", { threadId: id, turn: run.turn });
    this.notify("thread/status/changed", {
      threadId: id,
      status: thread.status,
    });
  }
  private path(value: unknown) {
    const path = asString(value).replace(/\/$/, "") || "/";
    if (
      !path.startsWith("/") ||
      path.includes("\0") ||
      path.split("/").includes("..")
    )
      throw new DemoError(t("请使用演示项目内的绝对路径。"));
    return path;
  }
  private directories() {
    const result = new Set(["/", "/demo"]);
    for (const path of this.files.keys()) {
      const parts = path.split("/");
      for (let end = 2; end < parts.length; end++)
        result.add(parts.slice(0, end).join("/"));
    }
    return result;
  }
  private fileChanged(path: string) {
    for (const [socket, watches] of this.watches)
      for (const [watchId, root] of watches)
        if (path === root || path.startsWith(root + "/"))
          socket.deliver({
            method: "fs/changed",
            params: { watchId, changedPaths: [path] },
          });
  }
  private git(p: Params, socket: DemoSocket) {
    const command = Array.isArray(p.command) ? p.command.map(asString) : [];
    const cwd = asString(p.cwd);
    const root = DEMO_PROJECTS.find(
      (root) => cwd === root || cwd.startsWith(root + "/"),
    );
    const output = (stdout: string) => ({ stdout, stderr: "", exitCode: 0 });
    if (!root || command[0] !== "git")
      throw new DemoError(
        t("演示模式不执行终端命令。请在本机安装工作台后运行真实任务。"),
      );
    const args = command
      .slice(1)
      .filter(
        (arg) => !["--no-optional-locks", "--literal-pathspecs"].includes(arg),
      );
    if (args[0] === "status" && args.includes("--porcelain=v2")) {
      let status = "# branch.head demo/workbench\0";
      for (const [path, content] of this.files) {
        if (!path.startsWith(root + "/")) continue;
        const baseline = this.versions.get(path);
        if (!baseline) status += `? ${path.slice(root.length + 1)}\0`;
        else if (content !== baseline.text)
          status += `1 .M N... 100644 100644 100644 ${baseline.oid} ${baseline.oid} ${path.slice(root.length + 1)}\0`;
      }
      return output(status);
    }
    if (
      args[0] === "-c" &&
      args[1] === "core.quotePath=false" &&
      args[2] === "check-ignore"
    )
      return { stdout: "", stderr: "", exitCode: 1 };
    if (args[0] === "ls-files" && args.includes("--stage")) {
      const path = args.at(-1)!;
      const baseline = this.versions.get(root + "/" + path);
      return output(baseline ? `100644 ${baseline.oid} 0\t${path}\0` : "");
    }
    if (args[0] === "rev-parse" && args.includes("--show-toplevel"))
      return output(
        root +
          "\n" +
          (args.includes("--show-prefix")
            ? (cwd === root ? "" : cwd.slice(root.length + 1) + "/") + "\n"
            : ""),
      );
    if (args[0] === "rev-parse" && args[1] === "--verify") {
      const path = args[2].replace(/^(?:HEAD)?:/, "");
      const baseline = this.versions.get(root + "/" + path);
      if (baseline) return output(baseline.oid + "\n");
    }
    if (args[0] === "cat-file") {
      const baseline = [...this.versions.values()].find(
        (version) => version.oid === args[2],
      );
      if (baseline && args[1] === "-s")
        return output(
          String(new TextEncoder().encode(baseline.text).length) + "\n",
        );
      if (baseline && args[1] === "blob") {
        if (p.streamStdoutStderr && p.processId) {
          socket.deliver({
            method: "command/exec/outputDelta",
            params: {
              processId: p.processId,
              stream: "stdout",
              deltaBase64: encode(baseline.text),
              capReached: false,
            },
          });
          return output("");
        }
        return output(baseline.text);
      }
    }
    throw new DemoError(
      t(
        "此 Git 操作未在演示中模拟。可以查看变更文件与差异；真实 Git 操作请在本机工作台进行。",
      ),
    );
  }
  handle(method: string, p: Params, socket: DemoSocket): unknown {
    switch (method) {
      case "initialize":
        return {
          userAgent: "codex_web/demo (browser simulation)",
          platformFamily: "unix",
          platformOs: "demo",
        };
      case "model/list":
        return { data: [DEMO_MODEL], nextCursor: null };
      case "account/read":
        return {
          account: {
            type: "chatgpt",
            email: "demo@example.invalid",
            planType: "free",
            workspaceName: t("虚构演示账号"),
          },
          requiresOpenaiAuth: false,
        };
      case "account/rateLimits/read":
        return {
          rateLimits: {
            limitId: "demo",
            limitName: t("模拟额度"),
            primary: null,
            secondary: null,
            credits: null,
            planType: "free",
          },
          rateLimitsByLimitId: {},
        };
      case "config/read":
        return {
          config: {
            model: "demo-codex",
            model_provider: "demo",
            approval_policy: "on-request",
            approvals_reviewer: "user",
            sandbox_mode: "read-only",
            model_reasoning_effort: "medium",
          },
          origins: {},
          layers: null,
        };
      case "configRequirements/read":
        return { requirements: null };
      case "threadSection/list":
        return { data: [], nextCursor: null };
      case "mcpServerStatus/list":
        return { data: [], nextCursor: null };
      case "skills/list":
        return {
          data: (Array.isArray(p.cwds) ? p.cwds : DEMO_PROJECTS).map((cwd) => ({
            cwd,
            skills: [],
            errors: [],
          })),
        };
      case "app/list":
      case "app/installed":
        return { data: [], apps: [], nextCursor: null };
      case "plugin/list":
        return {
          marketplaces: [],
          marketplaceLoadErrors: [],
          featuredPluginIds: [],
        };
      case "hooks/list":
        return { data: [] };
      case "thread/attachment/list":
        return { data: [], nextCursor: null };
      case "thread/attachmentOwner/list":
        return { data: [], nextCursor: null };
      case "thread/goal/get":
        return { goal: null };
      case "thread/loaded/list":
        return {
          data: this.threads.map((thread) => thread.id),
          nextCursor: null,
        };
      case "thread/list": {
        const search = asString(p.searchTerm).toLowerCase();
        const list = this.threads.filter(
          (thread) =>
            this.archived.has(thread.id) === !!p.archived &&
            (!search ||
              (thread.name + thread.preview).toLowerCase().includes(search)) &&
            (!p.cwd ||
              (Array.isArray(p.cwd)
                ? p.cwd.includes(thread.cwd)
                : p.cwd === thread.cwd)) &&
            (!Array.isArray(p.excludedThreadIds) ||
              !p.excludedThreadIds.includes(thread.id)) &&
            (p.sectionId === undefined || p.sectionId === null),
        );
        const key = p.sortKey === "created_at" ? "createdAt" : "updatedAt";
        list.sort(
          (a, b) =>
            (b[key] - a[key] || a.id.localeCompare(b.id)) *
            (p.sortDirection === "asc" ? -1 : 1),
        );
        const offset = p.cursor
          ? list.findIndex((thread) => thread.id === p.cursor) + 1
          : 0;
        const limit = Math.max(
          1,
          Math.min(100, typeof p.limit === "number" ? p.limit : 25),
        );
        const page = list.slice(offset, offset + limit);
        return {
          data: page.map(metadata),
          nextCursor: offset + limit < list.length ? page.at(-1)?.id : null,
          backwardsCursor: page[0]?.id ?? null,
        };
      }
      case "thread/read": {
        const thread = this.getThread(p.threadId);
        return { thread: p.includeTurns ? thread : metadata(thread) };
      }
      case "thread/resume":
        return configuration(this.getThread(p.threadId));
      case "thread/unsubscribe":
        return {};
      case "thread/start": {
        const cwd = asString(p.cwd) || DEMO_PROJECTS[0];
        if (!DEMO_PROJECTS.includes(cwd))
          throw new DemoError(t("请选择已有的演示项目。"));
        const thread = makeThread(this.threads.length, cwd);
        thread.id = crypto.randomUUID();
        thread.turns = [];
        thread.name = null;
        thread.preview = "";
        this.threads.unshift(thread);
        this.notify("thread/started", { thread: metadata(thread) });
        return configuration(thread);
      }
      case "thread/name/set": {
        const thread = this.getThread(p.threadId);
        thread.name = asString(p.name);
        this.notify("thread/name/updated", {
          threadId: thread.id,
          threadName: thread.name,
        });
        return {};
      }
      case "thread/archive":
      case "thread/unarchive": {
        const thread = this.getThread(p.threadId);
        if (this.active.has(thread.id))
          throw new DemoError(t("请等待演示回复结束后再归档。"));
        if (method === "thread/archive") this.archived.add(thread.id);
        else this.archived.delete(thread.id);
        this.notify(
          method === "thread/archive" ? "thread/archived" : "thread/unarchived",
          { threadId: thread.id },
        );
        return {};
      }
      case "thread/fork": {
        const source = this.getThread(p.threadId);
        const thread = structuredClone(source);
        thread.id = crypto.randomUUID();
        thread.sessionId = crypto.randomUUID();
        thread.forkedFromId = source.id;
        thread.name = t("{{value0}} · 分叉", {
          value0: source.name || t("演示会话"),
        });
        thread.status = { type: "idle" };
        thread.turns = thread.turns.filter(
          (turn) => turn.status !== "inProgress",
        );
        this.threads.unshift(thread);
        this.notify("thread/started", { thread: metadata(thread) });
        return configuration(thread);
      }
      case "thread/turns/list": {
        const turns = this.getThread(p.threadId).turns;
        return {
          data: p.sortDirection === "desc" ? [...turns].reverse() : turns,
          nextCursor: null,
        };
      }
      case "turn/start": {
        const thread = this.getThread(p.threadId);
        if (this.active.has(thread.id))
          throw new DemoError(t("请等待当前演示回复结束。"));
        const input = (Array.isArray(p.input) ? p.input : []) as UserInput[];
        const text = input
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n");
        const turn = makeTurn(text, "");
        turn.items = turn.items.slice(0, 1);
        const user = turn.items[0];
        if (user.type === "userMessage") {
          user.clientId = asString(p.clientUserMessageId) || null;
          user.content = input;
        }
        turn.status = "inProgress";
        turn.startedAt = now();
        turn.completedAt = null;
        turn.durationMs = null;
        thread.turns.push(turn);
        thread.updatedAt = now();
        thread.recencyAt = now();
        thread.status = { type: "active", activeFlags: [] };
        if (!thread.name) {
          thread.name = text.slice(0, 50) || t("新演示会话");
          thread.preview = text;
        }
        const timer = setTimeout(() => {
          const item = agent(
            t(
              "这是一条预设的演示回复，未调用模型。\n\n当前项目：{{value0}}\n\n你可以在右侧查看文件和模拟 Git 差异，也可以继续发送消息、创建会话或切换主题。所有任务和文件操作仅影响浏览器内的虚构数据。",
              { value0: thread.cwd },
            ),
          );
          turn.items.push(item);
          this.notify("item/started", {
            threadId: thread.id,
            turnId: turn.id,
            item,
          });
          this.notify("item/completed", {
            threadId: thread.id,
            turnId: turn.id,
            item,
          });
          this.finish(thread.id, "completed");
        }, 900);
        this.active.set(thread.id, { turn, timer, socket });
        this.notify("turn/started", {
          threadId: thread.id,
          turn: { ...turn, items: [] },
        });
        this.notify("item/completed", {
          threadId: thread.id,
          turnId: turn.id,
          item: user,
        });
        this.notify("thread/status/changed", {
          threadId: thread.id,
          status: thread.status,
        });
        return { turn: { ...turn, items: [] } };
      }
      case "turn/interrupt": {
        const run = this.active.get(asString(p.threadId));
        if (!run || run.turn.id !== p.turnId)
          throw new DemoError(t("当前没有可停止的演示回复。"));
        this.finish(asString(p.threadId), "interrupted");
        return {};
      }
      case "fs/readDirectory": {
        const path = this.path(p.path);
        const dirs = this.directories();
        if (!dirs.has(path))
          throw new DemoError(t("此目录不在演示文件系统中。"));
        const parent = (entry: string) =>
          entry.slice(0, entry.lastIndexOf("/")) || "/";
        return {
          entries: [...dirs]
            .filter((entry) => entry !== path && parent(entry) === path)
            .map((entry) => ({
              fileName: entry.split("/").at(-1),
              isDirectory: true,
              isFile: false,
            }))
            .concat(
              [...this.files.keys()]
                .filter((entry) => parent(entry) === path)
                .map((entry) => ({
                  fileName: entry.split("/").at(-1),
                  isDirectory: false,
                  isFile: true,
                })),
            ),
        };
      }
      case "fs/readFile": {
        const text = this.files.get(this.path(p.path));
        if (text === undefined)
          throw new DemoError(t("此文件不在演示文件系统中。"));
        return { dataBase64: encode(text) };
      }
      case "fs/getMetadata": {
        const path = this.path(p.path);
        const isDirectory = this.directories().has(path);
        if (!isDirectory && !this.files.has(path))
          throw new DemoError(t("此路径不在演示文件系统中。"));
        return {
          isDirectory,
          isFile: !isDirectory,
          isSymlink: false,
          createdAtMs: 1,
          modifiedAtMs: 1,
        };
      }
      case "fs/writeFile": {
        const path = this.path(p.path);
        if (
          !DEMO_PROJECTS.some((root) => path.startsWith(root + "/")) ||
          !this.directories().has(path.slice(0, path.lastIndexOf("/")))
        )
          throw new DemoError(t("仅支持保存演示项目内已有目录中的文件。"));
        const value = asString(p.dataBase64);
        if (value.length > 2_000_000)
          throw new DemoError(t("演示文件过大，请缩小至 1 MB 以内。"));
        this.files.set(path, decode(value));
        this.fileChanged(path);
        return {};
      }
      case "fs/watch": {
        const watchId = asString(p.watchId);
        const watches = this.watches.get(socket) || new Map<string, string>();
        watches.set(watchId, this.path(p.path));
        this.watches.set(socket, watches);
        return { path: this.path(p.path) };
      }
      case "fs/unwatch":
        this.watches.get(socket)?.delete(asString(p.watchId));
        return {};
      case "fuzzyFileSearch": {
        const query = asString(p.query).toLowerCase();
        const roots = Array.isArray(p.roots)
          ? p.roots.map(asString)
          : DEMO_PROJECTS;
        return {
          files: [...this.files.keys()]
            .filter(
              (path) =>
                roots.some((root) => path.startsWith(root + "/")) &&
                path.toLowerCase().includes(query),
            )
            .map((path) => {
              const root = roots.find((root) => path.startsWith(root + "/"))!;
              return {
                root,
                path: path.slice(root.length + 1),
                file_name: path.split("/").at(-1),
                score: 100,
                indices: [],
              };
            }),
        };
      }
      case "command/exec":
        return this.git(p, socket);
      default:
        throw new DemoError(
          t(
            "演示模式未模拟此操作（{{value0}}）。真实登录、终端执行和外部服务请在本机工作台使用。",
            { value0: method },
          ),
          -32601,
        );
    }
  }
}

/** Injected through the existing CodexClient socket factory; never patches browser globals. */
export class DemoSocket implements SocketLike {
  readyState = 0;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onerror: SocketLike["onerror"] = null;
  onclose: SocketLike["onclose"] = null;
  constructor(private service: DemoService) {
    service.attach(this);
    queueMicrotask(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.onopen?.(new Event("open"));
    });
  }
  deliver(message: unknown) {
    const data = JSON.stringify(message);
    queueMicrotask(() => {
      if (this.readyState === 1)
        this.onmessage?.(new MessageEvent("message", { data }));
    });
  }
  send(data: string) {
    if (this.readyState !== 1) throw new Error(t("演示连接已关闭。"));
    const message = record(JSON.parse(data));
    if (message.type === "connect") {
      if (
        asString(message.url).replace(/\/$/, "") !== DEMO_ENDPOINT ||
        message.token
      )
        this.deliver({
          type: "bridge/error",
          message: t("演示模式只能连接内置模拟环境，不会建立真实网络连接。"),
        });
      else this.deliver({ type: "bridge/ready" });
      return;
    }
    if (message.id === undefined || typeof message.method !== "string") return;
    try {
      this.deliver({
        id: message.id,
        result: this.service.handle(
          message.method,
          record(message.params),
          this,
        ),
      });
    } catch (error) {
      this.deliver({
        id: message.id,
        error: {
          code: error instanceof DemoError ? error.code : -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.service.detach(this);
    this.onclose?.(new Event("close") as CloseEvent);
  }
}
let service: DemoService | undefined;
export function createDemoSocket(): SocketLike {
  return new DemoSocket((service ??= new DemoService()));
}
