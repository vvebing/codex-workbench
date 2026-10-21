import { Store, errorMessage } from "../../lib/store";
import { RpcError } from "../../lib/rpc";
import type { ConnectionStore } from "../connection/store";
import type { CommandExecResponse } from "../../generated/v2/CommandExecResponse";

export interface Project {
  cwd: string;
  description: string;
  model: string;
  commands: { test: string; build: string; dev: string };
  previewUrl: string;
}
export type ProjectTaskConfig = Pick<Project, "cwd" | "description" | "model">;
export interface ProjectRun {
  id: string;
  cwd: string;
  command: string;
  status: "running" | "stopping" | "exited" | "unknown" | "unsupported";
  output: string;
  exitCode?: number;
  error?: string;
  truncated?: boolean;
}
interface ProjectState {
  projects: Project[];
  selected: string;
  runs: ProjectRun[];
  warning: string | null;
}
export const emptyProject = (cwd: string): Project => ({
  cwd,
  description: "",
  model: "",
  commands: { test: "", build: "", dev: "" },
  previewUrl: "",
});
const limit = 200_000;
export function normalizeProjectDirectory(cwd: string) {
  const trimmed = cwd.trim();
  return trimmed === "/" ? trimmed : trimmed.replace(/\/+$/, "");
}
function endpointScope(value: string) {
  try {
    return new URL(value).href;
  } catch {
    return value;
  }
}
export function previewAddress(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export class ProjectsStore extends Store<ProjectState> {
  private key = "";
  private epoch = -1;
  private disposers: (() => void)[];
  constructor(
    private connection: ConnectionStore,
    private environment: string,
    private storage?: Pick<Storage, "getItem" | "setItem">,
  ) {
    super({ projects: [], selected: "", runs: [], warning: null });
    this.activate();
    this.disposers = [
      connection.subscribe(() => this.activate()),
      connection.client.onNotification((message) => {
        if (message.method !== "command/exec/outputDelta") return;
        const { processId, deltaBase64, capReached, stream } = message.params;
        const run = this.state.runs.find((item) => item.id === processId);
        if (!run || !["running", "stopping"].includes(run.status)) return;
        try {
          const bytes = Uint8Array.from(atob(deltaBase64), (character) =>
            character.charCodeAt(0),
          );
          const text = this.decoder(`${processId}:${stream}`).decode(bytes, {
            stream: true,
          });
          this.patch(processId, {
            output: (run.output + text).slice(-limit),
            truncated:
              run.truncated ||
              capReached ||
              run.output.length + text.length > limit,
          });
        } catch {
          this.patch(processId, { error: "输出解码失败" });
        }
      }),
    ];
  }
  private decoders = new Map<string, TextDecoder>();
  private decoder(id: string) {
    let decoder = this.decoders.get(id);
    if (!decoder) {
      decoder = new TextDecoder();
      this.decoders.set(id, decoder);
    }
    return decoder;
  }
  private activate() {
    const connection = this.connection.getSnapshot();
    const key = `codex-projects:v1:${JSON.stringify([this.environment, endpointScope(connection.url)])}`;
    if (this.epoch !== connection.epoch || connection.status !== "connected") {
      this.update({
        ...this.state,
        runs: this.state.runs.map((run) =>
          ["running", "stopping"].includes(run.status)
            ? {
                ...run,
                status: "unknown",
                error: "连接已改变；无法确认最终退出状态",
              }
            : run,
        ),
      });
      this.decoders.clear();
    }
    this.epoch = connection.epoch;
    if (key === this.key) return;
    this.key = key;
    let projects: Project[] = [];
    let selected = "";
    let runs: ProjectRun[] = [];
    let warning: string | null = null;
    try {
      const raw = this.storage?.getItem(key);
      if (raw) {
        if (raw.length > 500_000) throw new Error("项目配置过大");
        const data: unknown = JSON.parse(raw);
        if (
          !data ||
          typeof data !== "object" ||
          !("projects" in data) ||
          !Array.isArray(data.projects)
        )
          throw new Error("项目配置格式无效");
        projects = data.projects
          .filter(
            (item): item is Project =>
              !!item &&
              typeof item.cwd === "string" &&
              typeof item.description === "string" &&
              typeof item.model === "string" &&
              typeof item.previewUrl === "string" &&
              !!item.commands &&
              ["test", "build", "dev"].every(
                (key) => typeof item.commands[key] === "string",
              ),
          )
          .slice(0, 100);
        if ("runs" in data && Array.isArray(data.runs)) {
          runs = data.runs
            .filter(
              (run) =>
                run &&
                typeof run.id === "string" &&
                typeof run.cwd === "string" &&
                typeof run.command === "string",
            )
            .slice(-20)
            .map((run) => ({
              id: run.id,
              cwd: run.cwd,
              command: run.command,
              status: "unknown" as const,
              output: "",
              error: "页面重建后无法恢复进程；最终退出状态未知",
            }));
        }
        selected =
          "selected" in data && typeof data.selected === "string"
            ? data.selected
            : "";
      }
    } catch (error) {
      warning = `项目配置无法恢复：${errorMessage(error)}`;
    }
    this.update({ projects, selected, warning, runs });
  }
  private persist() {
    try {
      const serialized = JSON.stringify({
        projects: this.state.projects,
        selected: this.state.selected,
        runs: this.state.runs
          .filter((run) =>
            ["running", "stopping", "unknown"].includes(run.status),
          )
          .map(({ id, cwd, command }) => ({ id, cwd, command })),
      });
      if (serialized.length > 500_000)
        throw new Error(
          "项目配置超过 500,000 字符容量；当前修改仅保留在本页，刷新将恢复上次保存版本。请缩短说明或命令后重试",
        );
      if (!this.storage)
        throw new Error("本地存储不可用；当前修改仅保留在本页");
      this.storage.setItem(this.key, serialized);
      if (this.state.warning) this.update({ ...this.state, warning: null });
    } catch (error) {
      this.update({
        ...this.state,
        warning: `项目配置未保存：${errorMessage(error)}`,
      });
    }
  }
  getProject(cwd: string) {
    return this.state.projects.find(
      (project) => project.cwd === normalizeProjectDirectory(cwd),
    );
  }
  select(cwd: string) {
    cwd = normalizeProjectDirectory(cwd);
    if (!cwd.trim()) return;
    if (!this.getProject(cwd) && this.state.projects.length >= 100) {
      this.update({
        ...this.state,
        warning: "最多保存 100 个项目；请删除不再使用的本地配置后新增。",
      });
      return;
    }
    const projects = this.state.projects.some((project) => project.cwd === cwd)
      ? this.state.projects
      : [...this.state.projects, emptyProject(cwd)];
    this.update({ ...this.state, projects, selected: cwd });
    this.persist();
  }
  save(project: Project) {
    project = { ...project, cwd: normalizeProjectDirectory(project.cwd) };
    if (!project.cwd.trim()) return;
    const exists = this.state.projects.some((item) => item.cwd === project.cwd);
    if (!exists && this.state.projects.length >= 100) {
      this.update({
        ...this.state,
        warning: "最多保存 100 个项目；请删除不再使用的本地配置后新增。",
      });
      return;
    }
    this.update({
      ...this.state,
      projects: exists
        ? this.state.projects.map((item) =>
            item.cwd === project.cwd ? project : item,
          )
        : [...this.state.projects, project],
    });
    this.persist();
  }
  remove(cwd: string) {
    cwd = normalizeProjectDirectory(cwd);
    if (
      this.state.runs.some(
        (run) =>
          run.cwd === cwd &&
          ["running", "stopping", "unknown"].includes(run.status),
      )
    ) {
      this.update({
        ...this.state,
        warning:
          "该项目存在运行中或状态未知的命令，请先停止或在外部核实后解除运行锁。",
      });
      return;
    }
    const projects = this.state.projects.filter(
      (project) => project.cwd !== cwd,
    );
    this.update({
      ...this.state,
      projects,
      selected:
        this.state.selected === cwd
          ? (projects[0]?.cwd ?? "")
          : this.state.selected,
    });
    this.persist();
  }
  acknowledgeUnknown(id: string) {
    this.update({
      ...this.state,
      runs: this.state.runs.filter(
        (run) => run.id !== id || run.status !== "unknown",
      ),
    });
    this.persist();
  }
  private patch(id: string, patch: Partial<ProjectRun>) {
    this.update({
      ...this.state,
      runs: this.state.runs.map((run) =>
        run.id === id ? { ...run, ...patch } : run,
      ),
    });
    if (patch.status) this.persist();
  }
  async run(kind: keyof Project["commands"], cwd = this.state.selected) {
    const project = this.state.projects.find(
      (item) => item.cwd === normalizeProjectDirectory(cwd),
    );
    const command = project?.commands[kind].trim();
    if (
      !project ||
      !command ||
      this.connection.getSnapshot().status !== "connected"
    )
      return;
    // One command per connection: prevents duplicate launches and runaway dev servers.
    if (
      this.state.runs.some((run) =>
        ["running", "stopping", "unknown"].includes(run.status),
      )
    )
      return;
    const id = crypto.randomUUID();
    const epoch = this.epoch;
    const key = this.key;
    this.update({
      ...this.state,
      runs: [
        ...this.state.runs.slice(-19),
        { id, cwd: project.cwd, command, status: "running", output: "" },
      ],
    });
    this.persist();
    try {
      const result = await this.connection.client.request<CommandExecResponse>(
        "command/exec",
        {
          command: ["/bin/sh", "-lc", command],
          cwd: project.cwd,
          processId: id,
          streamStdoutStderr: true,
          streamStdin: true,
          outputBytesCap: limit,
          timeoutMs: kind === "dev" ? 86_400_000 : 600_000,
        },
      );
      if (epoch !== this.epoch || key !== this.key) return;
      const run = this.state.runs.find((item) => item.id === id);
      if (run?.status === "unknown") return;
      const bufferedLength =
        (run?.output.length ?? 0) + result.stdout.length + result.stderr.length;
      this.patch(id, {
        truncated: run?.truncated || bufferedLength > limit,
        status: "exited",
        exitCode: result.exitCode,
        output: (
          (run?.output ?? "") +
          ["stdout", "stderr"]
            .map((stream) => this.decoder(`${id}:${stream}`).decode())
            .join("") +
          result.stdout +
          result.stderr
        ).slice(-limit),
      });
    } catch (error) {
      if (epoch !== this.epoch || key !== this.key) return;
      // No retry: an error may arrive after the process has already started.
      const unsupported = error instanceof RpcError && error.code === -32601;
      this.patch(id, {
        status: unsupported ? "unsupported" : "unknown",
        error: unsupported
          ? `当前服务不支持此稳定命令接口/流式参数：${errorMessage(error)}。请在终端手动执行。`
          : `无法确认退出状态：${errorMessage(error)}`,
      });
    } finally {
      this.decoders.delete(`${id}:stdout`);
      this.decoders.delete(`${id}:stderr`);
    }
  }
  async stop(id: string) {
    const run = this.state.runs.find((item) => item.id === id);
    if (!run || run.status !== "running") return;
    const epoch = this.epoch;
    const key = this.key;
    this.patch(id, { status: "stopping" });
    try {
      await this.connection.client.request("command/exec/terminate", {
        processId: id,
      });
    } catch (error) {
      if (epoch !== this.epoch || key !== this.key) return;
      if (this.state.runs.find((item) => item.id === id)?.status === "exited")
        return;
      this.patch(id, {
        status: "unknown",
        error: `停止未确认：${errorMessage(error)}`,
      });
    }
  }
  async write(id: string, input: string) {
    if (
      !this.state.runs.some((run) => run.id === id && run.status === "running")
    )
      return;
    const epoch = this.epoch;
    const key = this.key;
    const bytes = new TextEncoder().encode(input);
    try {
      await this.connection.client.request("command/exec/write", {
        processId: id,
        deltaBase64: btoa(
          Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""),
        ),
      });
    } catch (error) {
      if (epoch !== this.epoch || key !== this.key) return;
      this.patch(id, { error: `输入未确认：${errorMessage(error)}` });
    }
  }
  dispose() {
    this.disposers.forEach((dispose) => dispose());
    this.decoders.clear();
    if (stores.get(this.connection)?.get(this.environment) === this)
      stores.get(this.connection)?.delete(this.environment);
  }
}
const stores = new WeakMap<ConnectionStore, Map<string, ProjectsStore>>();
/** Runtime-owned cache: panel remounts must not lose command ownership. */
export function projectsFor(connection: ConnectionStore, environment = "") {
  let scoped = stores.get(connection);
  if (!scoped) {
    scoped = new Map();
    stores.set(connection, scoped);
  }
  let store = scoped.get(environment);
  if (!store) {
    let storage: Storage | undefined;
    try {
      storage = globalThis.localStorage;
    } catch {
      /* Browser privacy mode. */
    }
    store = new ProjectsStore(connection, environment, storage);
    scoped.set(environment, store);
  }
  return store;
}
