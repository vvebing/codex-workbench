import { t } from "../../lib/i18n";
import { Store, errorMessage } from "../../lib/store";
import { RpcError } from "../../lib/rpc";
import type { ConnectionStore } from "../connection/store";
import type { CommandExecResponse } from "../../generated/v2/CommandExecResponse";
import type { CommandExecTerminalSize } from "../../generated/v2/CommandExecTerminalSize";
import {
  READ_ONLY_TERMINAL_ENVIRONMENT,
  READ_ONLY_TERMINAL_POLICY,
  readOnlyTerminalCommand,
} from "./bootstrap";
import {
  ShellActivityParser,
  ShellInputTracker,
  shellActivityEnvironment,
  type ShellActivity,
} from "./shell-activity";

export type { ShellActivity } from "./shell-activity";

export type TerminalStatus =
  | "starting"
  | "running"
  | "stopping"
  | "exited"
  | "unknown"
  | "unsupported"
  | "failed";
export interface TerminalSession {
  id: string;
  /** Project ownership does not change when the shell changes directories. */
  cwd: string;
  initialCwd: string;
  status: TerminalStatus;
  /** Prompt evidence is separate from the lifetime of the interactive shell. */
  activity: ShellActivity;
  background: boolean;
  output: string;
  /** UTF-16 offset of the first retained output character. */
  outputStart: number;
  truncated: boolean;
  exitCode?: number;
  error?: string;
}
export interface TerminalState {
  sessions: TerminalSession[];
  visible: boolean;
  projectCwd: string;
  selected: Record<string, string>;
  pendingCommand?: { cwd: string; command: string; revision: number };
}
type StorageLike = Pick<Storage, "getItem" | "setItem">;
type Ownership = { epoch: number; scope: number; key: string };
export const TERMINAL_OUTPUT_LIMIT = 256 * 1024;
const HISTORY_LIMIT = 40;
export function normalizeTerminalDirectory(cwd: string): string {
  const path = cwd.trim();
  return path === "/" ? path : path.replace(/\/+$/, "");
}
export function terminalIsLive(status: TerminalStatus): boolean {
  return status === "starting" || status === "running" || status === "stopping";
}
function endpointKey(endpoint: string): string {
  try {
    return new URL(endpoint).href;
  } catch {
    return endpoint;
  }
}
function terminalSize(size: CommandExecTerminalSize): CommandExecTerminalSize {
  return {
    rows: Math.max(1, Math.min(1000, Math.floor(size.rows) || 24)),
    cols: Math.max(2, Math.min(1000, Math.floor(size.cols) || 80)),
  };
}
function browserStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** A connection owns processes; project navigation only changes their presentation. */
export class TerminalStore extends Store<TerminalState> {
  private key = "";
  private epoch = -1;
  private scope = -1;
  private disposed = false;
  private revision = 0;
  private owners = new Map<string, Ownership>();
  private decoders = new Map<string, TextDecoder>();
  private activityParsers = new Map<string, ShellActivityParser>();
  private activityTokens = new Map<string, string>();
  private activityVersions = new Map<string, number>();
  private inputTrackers = new Map<string, ShellInputTracker>();
  private closeOnExit = new Set<string>();
  private sizes = new Map<string, CommandExecTerminalSize>();
  private cached = new Map<
    string,
    Pick<TerminalState, "sessions" | "selected">
  >();
  private disposers: (() => void)[];
  constructor(
    private connection: ConnectionStore,
    private environmentId: string,
    private storage: StorageLike | undefined = browserStorage(),
  ) {
    super({
      sessions: [],
      visible: false,
      projectCwd: "",
      selected: {},
    });
    this.activate();
    this.disposers = [
      connection.subscribe(() => this.activate()),
      connection.client.onNotification((message) => {
        if (message.method !== "command/exec/outputDelta") return;
        const { processId, stream, deltaBase64, capReached } = message.params;
        const owner = this.owners.get(processId);
        const session = this.state.sessions.find(
          (entry) => entry.id === processId,
        );
        if (
          !owner ||
          !this.current(owner) ||
          !session ||
          (!terminalIsLive(session.status) && session.status !== "unknown")
        )
          return;
        try {
          const decoderKey = `${processId}:${stream}`;
          let decoder = this.decoders.get(decoderKey);
          if (!decoder) {
            decoder = new TextDecoder();
            this.decoders.set(decoderKey, decoder);
          }
          const bytes = Uint8Array.from(atob(deltaBase64), (character) =>
            character.charCodeAt(0),
          );
          this.appendShellOutput(
            processId,
            stream,
            decoder.decode(bytes, { stream: true }),
            capReached,
          );
          if (session.status === "starting")
            this.patch(processId, { status: "running" });
        } catch (error) {
          this.patch(processId, {
            error: t("终端输出解码失败：{{value0}}", {
              value0: errorMessage(error),
            }),
          });
        }
      }),
    ];
  }
  private ownership(): Ownership {
    return { epoch: this.epoch, scope: this.scope, key: this.key };
  }
  private current(owner: Ownership): boolean {
    const connection = this.connection.getSnapshot();
    return (
      !this.disposed &&
      owner.key === this.key &&
      owner.epoch === connection.epoch &&
      owner.scope === connection.scope &&
      connection.status === "connected"
    );
  }
  private persist() {
    this.cached.set(this.key, {
      sessions: this.state.sessions,
      selected: this.state.selected,
    });
    if (!this.key) return;
    try {
      // Output and typed commands are deliberately never persisted by the workbench.
      const sessions = this.state.sessions
        .slice(-HISTORY_LIMIT)
        .map(({ id, cwd, initialCwd, status, exitCode }) => ({
          id,
          cwd,
          initialCwd,
          status,
          exitCode,
        }));
      this.storage?.setItem(
        this.key,
        JSON.stringify({ sessions, selected: this.state.selected }),
      );
    } catch {
      // Terminal execution must remain usable if browser storage is unavailable.
    }
  }
  private restore(key: string): Pick<TerminalState, "sessions" | "selected"> {
    const cached = this.cached.get(key);
    if (cached) return cached;
    try {
      const raw = this.storage?.getItem(key);
      if (!raw || raw.length > 200_000) return { sessions: [], selected: {} };
      const parsed: unknown = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !("sessions" in parsed) ||
        !Array.isArray(parsed.sessions)
      )
        return { sessions: [], selected: {} };
      const sessions: TerminalSession[] = parsed.sessions
        .slice(-HISTORY_LIMIT)
        .flatMap((entry: unknown) => {
          if (
            !entry ||
            typeof entry !== "object" ||
            !("id" in entry) ||
            typeof entry.id !== "string" ||
            !("cwd" in entry) ||
            typeof entry.cwd !== "string" ||
            !("initialCwd" in entry) ||
            typeof entry.initialCwd !== "string"
          )
            return [];
          const exited = "status" in entry && entry.status === "exited";
          return [
            {
              id: entry.id,
              cwd: entry.cwd,
              initialCwd: entry.initialCwd,
              status: exited ? "exited" : "unknown",
              activity: "unknown",
              background: false,
              output: "",
              outputStart: 0,
              truncated: false,
              ...(exited &&
              "exitCode" in entry &&
              typeof entry.exitCode === "number"
                ? { exitCode: entry.exitCode }
                : {}),
              ...(!exited
                ? { error: t("页面重建后无法接管原终端，请核实原进程状态。") }
                : {}),
            },
          ];
        });
      const selected: Record<string, string> = {};
      if (
        "selected" in parsed &&
        parsed.selected &&
        typeof parsed.selected === "object"
      ) {
        for (const [cwd, id] of Object.entries(parsed.selected)) {
          if (
            typeof id === "string" &&
            sessions.some((entry) => entry.id === id && entry.cwd === cwd)
          )
            selected[cwd] = id;
        }
      }
      return { sessions, selected };
    } catch {
      return { sessions: [], selected: {} };
    }
  }
  private activate() {
    if (this.disposed) return;
    const connection = this.connection.getSnapshot();
    const key = `codex-terminals:v1:${JSON.stringify([this.environmentId, endpointKey(connection.url)])}`;
    const changed =
      connection.epoch !== this.epoch ||
      connection.scope !== this.scope ||
      key !== this.key;
    if (changed || connection.status !== "connected") {
      const sessions = this.state.sessions.map((session) =>
        terminalIsLive(session.status)
          ? {
              ...session,
              status: "unknown" as const,
              activity: "unknown" as const,
              background: false,
              error: t("连接已改变，无法确认原终端进程状态。"),
            }
          : session,
      );
      this.state = {
        ...this.state,
        sessions,
        pendingCommand: undefined,
      };
      this.persist();
      this.owners.clear();
      this.decoders.clear();
      this.activityParsers.clear();
      this.activityTokens.clear();
      this.activityVersions.clear();
      this.inputTrackers.clear();
      this.closeOnExit.clear();
      this.sizes.clear();
    }
    this.epoch = connection.epoch;
    this.scope = connection.scope;
    if (key !== this.key) {
      this.key = key;
      const restored = this.restore(key);
      this.update({
        ...this.state,
        ...restored,
        visible: false,
        projectCwd: "",
        pendingCommand: undefined,
      });
    } else if (changed || connection.status !== "connected") {
      this.update({ ...this.state });
    }
  }
  private patch(id: string, patch: Partial<TerminalSession>, deferred = false) {
    if (!this.state.sessions.some((session) => session.id === id)) return;
    this.update(
      {
        ...this.state,
        sessions: this.state.sessions.map((session) =>
          session.id === id ? { ...session, ...patch } : session,
        ),
      },
      deferred,
    );
    if (patch.status) this.persist();
  }
  private append(id: string, delta: string, capReached = false) {
    const session = this.state.sessions.find((entry) => entry.id === id);
    if (!session) return;
    const combined = session.output + delta;
    const removed = Math.max(0, combined.length - TERMINAL_OUTPUT_LIMIT);
    this.patch(
      id,
      {
        output: combined.slice(removed),
        outputStart: session.outputStart + removed,
        truncated: session.truncated || removed > 0 || capReached,
      },
      true,
    );
  }
  private setActivity(id: string, activity: ShellActivity, background = false) {
    this.activityVersions.set(id, (this.activityVersions.get(id) ?? 0) + 1);
    this.patch(id, { activity, background });
  }
  private appendShellOutput(
    id: string,
    stream: string,
    delta: string,
    capReached = false,
  ) {
    const token = this.activityTokens.get(id);
    if (!token) return;
    const key = `${id}:${stream}`;
    let parser = this.activityParsers.get(key);
    if (!parser) {
      parser = new ShellActivityParser(token);
      this.activityParsers.set(key, parser);
    }
    const parsed = parser.push(delta);
    this.append(id, parsed.output, capReached);
    for (const event of parsed.events) {
      const activity = this.inputTrackers.get(id)?.prompt(event);
      if (activity)
        this.setActivity(id, activity.activity, activity.background);
    }
  }
  reveal(projectCwd: string) {
    const cwd = normalizeTerminalDirectory(projectCwd);
    this.update({ ...this.state, visible: true, projectCwd: cwd });
  }
  hide() {
    this.update({ ...this.state, visible: false });
  }
  select(projectCwd: string, id: string) {
    const cwd = normalizeTerminalDirectory(projectCwd);
    if (
      !this.state.sessions.some(
        (session) => session.id === id && session.cwd === cwd,
      )
    )
      return;
    this.update({
      ...this.state,
      selected: { ...this.state.selected, [cwd]: id },
    });
    this.persist();
  }
  async create(
    projectCwd: string,
    initialCwd = projectCwd,
    size = { rows: 24, cols: 80 },
  ): Promise<void> {
    const cwd = normalizeTerminalDirectory(projectCwd);
    const directory = normalizeTerminalDirectory(initialCwd);
    if (
      !cwd ||
      !directory ||
      this.disposed ||
      this.connection.getSnapshot().status !== "connected"
    )
      return;
    const id = crypto.randomUUID();
    const owner = this.ownership();
    this.owners.set(id, owner);
    const activityToken = crypto.randomUUID();
    this.activityTokens.set(id, activityToken);
    this.inputTrackers.set(id, new ShellInputTracker());
    const dimensions = terminalSize(size);
    this.sizes.set(id, dimensions);
    this.update({
      ...this.state,
      visible: true,
      projectCwd: cwd,
      selected: { ...this.state.selected, [cwd]: id },
      sessions: [
        ...this.state.sessions,
        {
          id,
          cwd,
          initialCwd: directory,
          status: "starting",
          activity: "unknown",
          background: false,
          output: "",
          outputStart: 0,
          truncated: false,
        },
      ],
    });
    this.persist();
    try {
      const result = await this.connection.client.request<CommandExecResponse>(
        "command/exec",
        {
          command: readOnlyTerminalCommand(),
          cwd: directory,
          processId: id,
          tty: true,
          streamStdin: true,
          streamStdoutStderr: true,
          disableTimeout: true,
          disableOutputCap: true,
          sandboxPolicy: READ_ONLY_TERMINAL_POLICY,
          env: {
            ...READ_ONLY_TERMINAL_ENVIRONMENT,
            ...shellActivityEnvironment(activityToken),
          },
          size: dimensions,
        },
      );
      if (!this.current(owner)) return;
      const session = this.state.sessions.find((entry) => entry.id === id);
      if (
        !session ||
        (!terminalIsLive(session.status) && session.status !== "unknown")
      )
        return;
      for (const stream of ["stdout", "stderr"]) {
        const key = `${id}:${stream}`;
        const decoder = this.decoders.get(key);
        if (decoder) this.appendShellOutput(id, stream, decoder.decode());
      }
      this.appendShellOutput(id, "stdout", result.stdout);
      this.appendShellOutput(id, "stderr", result.stderr);
      for (const stream of ["stdout", "stderr"]) {
        const parser = this.activityParsers.get(`${id}:${stream}`);
        if (parser) this.append(id, parser.finish());
      }
      this.patch(id, {
        status: "exited",
        activity: "unknown",
        background: false,
        exitCode: result.exitCode,
        error: undefined,
      });
      if (this.closeOnExit.delete(id)) this.remove(id);
    } catch (error) {
      if (!this.current(owner)) return;
      const session = this.state.sessions.find((entry) => entry.id === id);
      if (!session || !terminalIsLive(session.status)) return;
      const unsupported = error instanceof RpcError && error.code === -32601;
      // Invalid parameters are known rejection; other failures may happen after launch.
      const rejected =
        error instanceof RpcError && [403, -32602].includes(error.code ?? 0);
      this.patch(id, {
        status: unsupported ? "unsupported" : rejected ? "failed" : "unknown",
        activity: "unknown",
        background: false,
        error: unsupported
          ? t("当前服务不支持交互式终端，请更新服务或使用外部终端。")
          : errorMessage(error),
      });
    } finally {
      if (this.owners.get(id) === owner) this.owners.delete(id);
      this.decoders.delete(`${id}:stdout`);
      this.decoders.delete(`${id}:stderr`);
      this.sizes.delete(id);
      this.activityTokens.delete(id);
      this.activityVersions.delete(id);
      this.activityParsers.delete(`${id}:stdout`);
      this.activityParsers.delete(`${id}:stderr`);
      this.inputTrackers.delete(id);
      this.closeOnExit.delete(id);
    }
  }
  private writable(id: string) {
    const owner = this.owners.get(id);
    const session = this.state.sessions.find((entry) => entry.id === id);
    return owner &&
      this.current(owner) &&
      session &&
      (session.status === "starting" || session.status === "running")
      ? owner
      : undefined;
  }
  async write(id: string, input: string): Promise<void> {
    const owner = this.writable(id);
    if (!owner || !input) return;
    const activity = this.inputTrackers.get(id)?.write(input);
    if (activity?.changed)
      this.setActivity(id, activity.activity, activity.background);
    const version = this.activityVersions.get(id);
    const bytes = new TextEncoder().encode(input);
    let encoded = "";
    for (const byte of bytes) encoded += String.fromCharCode(byte);
    try {
      await this.connection.client.request("command/exec/write", {
        processId: id,
        deltaBase64: btoa(encoded),
      });
    } catch (error) {
      if (!this.current(owner) || !this.writable(id)) return;
      if (version === this.activityVersions.get(id)) {
        this.inputTrackers.get(id)?.invalidate();
        this.setActivity(id, "unknown");
      }
      this.patch(id, {
        error: t("终端输入未确认，请核实后继续：{{value0}}", {
          value0: errorMessage(error),
        }),
      });
    }
  }
  async resize(id: string, size: CommandExecTerminalSize): Promise<void> {
    const owner = this.writable(id);
    if (!owner) return;
    const dimensions = terminalSize(size);
    const previous = this.sizes.get(id);
    if (previous?.rows === dimensions.rows && previous.cols === dimensions.cols)
      return;
    this.sizes.set(id, dimensions);
    try {
      await this.connection.client.request("command/exec/resize", {
        processId: id,
        size: dimensions,
      });
    } catch (error) {
      if (!this.current(owner) || !this.writable(id)) return;
      if (this.sizes.get(id) === dimensions) this.sizes.delete(id);
      this.patch(id, {
        error: t("终端尺寸同步失败：{{value0}}", {
          value0: errorMessage(error),
        }),
      });
    }
  }
  async end(id: string): Promise<void> {
    const owner = this.writable(id);
    if (!owner) return;
    this.patch(id, {
      status: "stopping",
      activity: "unknown",
      background: false,
    });
    try {
      await this.connection.client.request("command/exec/terminate", {
        processId: id,
      });
    } catch (error) {
      if (!this.current(owner)) return;
      if (
        this.state.sessions.find((session) => session.id === id)?.status !==
        "stopping"
      )
        return;
      this.patch(id, {
        status: "unknown",
        activity: "unknown",
        background: false,
        error: t("终端结束状态未确认：{{value0}}", {
          value0: errorMessage(error),
        }),
      });
      this.closeOnExit.delete(id);
    }
  }
  /** Removing a live tab waits for its process exit, not merely a kill acknowledgement. */
  async close(id: string): Promise<void> {
    const session = this.state.sessions.find((entry) => entry.id === id);
    if (!session || session.status === "unknown") return;
    if (!terminalIsLive(session.status)) {
      this.remove(id);
      return;
    }
    if (!this.current(this.owners.get(id) ?? { epoch: -1, scope: -1, key: "" }))
      return;
    this.closeOnExit.add(id);
    if (session.status !== "stopping") await this.end(id);
  }
  remove(id: string) {
    const session = this.state.sessions.find((entry) => entry.id === id);
    if (!session || terminalIsLive(session.status)) return;
    const sessions = this.state.sessions.filter((entry) => entry.id !== id);
    const selected = { ...this.state.selected };
    if (selected[session.cwd] === id) {
      const replacement = sessions.findLast(
        (entry) => entry.cwd === session.cwd,
      );
      if (replacement) selected[session.cwd] = replacement.id;
      else delete selected[session.cwd];
    }
    this.update({ ...this.state, sessions, selected });
    this.persist();
  }
  fill(projectCwd: string, command: string) {
    const cwd = normalizeTerminalDirectory(projectCwd);
    if (!cwd || !command) return;
    this.reveal(cwd);
    this.update({
      ...this.state,
      pendingCommand: { cwd, command, revision: ++this.revision },
    });
  }
  consumeCommand(revision: number) {
    if (this.state.pendingCommand?.revision !== revision) return;
    this.update({ ...this.state, pendingCommand: undefined });
  }
  hasLiveSessions(): boolean {
    return this.state.sessions.some((session) =>
      terminalIsLive(session.status),
    );
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.disposers.forEach((dispose) => dispose());
    this.owners.clear();
    this.decoders.clear();
    this.activityParsers.clear();
    this.activityTokens.clear();
    this.activityVersions.clear();
    this.inputTrackers.clear();
    this.closeOnExit.clear();
    this.persist();
    stores.get(this.connection)?.delete(this.environmentId);
    registrations.get(this.connection)?.forEach((listener) => listener());
  }
}
const stores = new WeakMap<ConnectionStore, Map<string, TerminalStore>>();
const registrations = new WeakMap<ConnectionStore, Set<() => void>>();
export function terminalsFor(
  connection: ConnectionStore,
  environmentId = "",
): TerminalStore {
  let scoped = stores.get(connection);
  if (!scoped) {
    scoped = new Map();
    stores.set(connection, scoped);
  }
  let store = scoped.get(environmentId);
  if (!store) {
    store = new TerminalStore(connection, environmentId);
    scoped.set(environmentId, store);
    registrations.get(connection)?.forEach((listener) => listener());
  }
  return store;
}

/** Read-only exit guard: do not instantiate stores while checking for live work. */
export function hasLiveTerminals(connection: ConnectionStore): boolean {
  return [...(stores.get(connection)?.values() ?? [])].some((store) =>
    store.hasLiveSessions(),
  );
}

/** Observe existing and future terminal stores without creating one for an exit guard. */
export function subscribeTerminalActivity(
  connection: ConnectionStore,
  listener: () => void,
): () => void {
  const subscriptions = new Map<TerminalStore, () => void>();
  const observe = () => {
    const current = new Set(stores.get(connection)?.values() ?? []);
    for (const [store, unsubscribe] of subscriptions) {
      if (current.has(store)) continue;
      unsubscribe();
      subscriptions.delete(store);
    }
    for (const store of current) {
      if (!subscriptions.has(store))
        subscriptions.set(store, store.subscribe(listener));
    }
    listener();
  };
  let listeners = registrations.get(connection);
  if (!listeners) {
    listeners = new Set();
    registrations.set(connection, listeners);
  }
  listeners.add(observe);
  observe();
  return () => {
    listeners.delete(observe);
    subscriptions.forEach((unsubscribe) => unsubscribe());
    subscriptions.clear();
    if (!listeners.size) registrations.delete(connection);
  };
}
