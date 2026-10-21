import { useMemo } from "react";
import { useStore } from "../../components/hooks";
import { useRuntime } from "../../lib/runtime-context";
import type { ConnectionStore } from "../connection/store";
import type { CommandExecResponse } from "../../generated/v2/CommandExecResponse";
import {
  gitStatusCommand,
  parseWorkspaceGitStatus,
  type WorkspaceGitStatus,
} from "./git-status";
import type { FileWorkspaceStore } from "../files/store";
import type { SessionsStore } from "../sessions/store";
import { watchWorkspace } from "./workspace-watch";

type Snapshot = {
  head?: string;
  indexSignatures?: Record<string, string>;
  value?: WorkspaceGitStatus;
  failed: boolean;
  loading: boolean;
};
export class WorkspaceGitStore {
  private snapshot: Snapshot = { failed: false, loading: true };
  private listeners = new Set<() => void>();
  private stop?: () => void;
  private busy = false;
  private pending = false;
  private generation = 0;
  private repoRoot?: string;
  private invalidationTimer?: ReturnType<typeof setTimeout>;
  private lastRevision = -1;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private connection: ConnectionStore,
    readonly cwd: string,
    private epoch: number,
    private scope: number,
    private resolveRoot?: (cwd: string) => Promise<string>,
    private pathsBelongTo?: (paths: string[]) => Promise<boolean>,
  ) {
    this.repoRoot = cwd;
  }
  isSubscribed = () => this.listeners.size > 0;
  getSnapshot = () => this.snapshot;
  invalidate = () => {
    clearTimeout(this.invalidationTimer);
    this.invalidationTimer = setTimeout(() => void this.refresh(), 100);
  };
  observeRevision(revision: number) {
    if (revision === this.lastRevision) return;
    const initial = this.lastRevision < 0;
    this.lastRevision = revision;
    const changed = this.files?.getSnapshot().changedPaths;
    if (initial) return;
    if (!changed?.length) {
      this.invalidate();
      return;
    }
    if (this.pathsBelongTo) {
      void this.pathsBelongTo(changed)
        .then((belongs) => {
          if (belongs && this.current()) this.invalidate();
        })
        .catch(() => {
          if (this.current()) this.invalidate();
        });
    } else {
      const root = this.cwd.replace(/\/$/, "");
      if (changed.some((path) => path === root || path.startsWith(`${root}/`)))
        this.invalidate();
    }
  }

  private publish(snapshot: Snapshot) {
    if (JSON.stringify(snapshot) === JSON.stringify(this.snapshot)) return;
    if (JSON.stringify(snapshot.value) === JSON.stringify(this.snapshot.value))
      snapshot.value = this.snapshot.value;
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
  private current = () => {
    const state = this.connection.getSnapshot();
    return (
      this.listeners.size > 0 &&
      state.status === "connected" &&
      state.epoch === this.epoch &&
      state.scope === this.scope
    );
  };
  refresh = async () => {
    if (!this.cwd || !this.current() || document.visibilityState === "hidden")
      return;
    if (this.busy) {
      this.pending = true;
      return;
    }
    clearTimeout(this.timer);
    this.busy = true;
    const generation = this.generation;
    if (!this.snapshot.value) this.publish({ ...this.snapshot, loading: true });
    try {
      const result = await this.connection.client.request<CommandExecResponse>(
        "command/exec",
        gitStatusCommand(this.cwd),
      );
      if (!this.current() || generation !== this.generation) return;
      if (result.exitCode !== 0) throw new Error("Git unavailable");
      const root = this.repoRoot!;
      const indexSignatures: Record<string, string> = {};
      for (const line of result.stdout.split("\0")) {
        const fields = line.split(" ");
        if (fields[0] === "1")
          indexSignatures[fields.slice(8).join(" ")] = fields[7];
        if (fields[0] === "2")
          indexSignatures[fields.slice(9).join(" ")] = fields[7];
        if (fields[0] === "u")
          indexSignatures[fields.slice(10).join(" ")] = "conflict";
        if (fields[0] === "?") indexSignatures[line.slice(2)] = "untracked";
      }
      this.publish({
        head: /(?:^|\0)# branch\.oid ([^\0]+)/.exec(result.stdout)?.[1],
        indexSignatures,
        value: {
          ...parseWorkspaceGitStatus(result.stdout),
          repoRoot: root,
        },
        failed: false,
        loading: false,
      });
    } catch {
      if (this.current() && generation === this.generation)
        this.publish({ ...this.snapshot, failed: true, loading: false });
    } finally {
      this.busy = false;
      if (this.current()) {
        if (this.pending) {
          this.pending = false;
          void this.refresh();
        } else this.timer = setTimeout(() => void this.refresh(), 10_000);
      }
    }
  };
  files?: FileWorkspaceStore;
  sessions?: SessionsStore;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1 && this.cwd) {
      const refresh = () => {
        void this.refresh();
      };
      this.observeRevision(this.files?.getSnapshot().revision ?? 0);
      const offFiles = this.files?.subscribe(() =>
        this.observeRevision(this.files!.getSnapshot().revision),
      );
      const off = this.connection.client.onNotification((event) => {
        if (
          event.method === "turn/diff/updated" ||
          event.method === "turn/completed"
        ) {
          const threadId = (event.params as { threadId?: string }).threadId;
          const cwd = threadId
            ? this.sessions?.getSnapshot().threads[threadId]?.cwd
            : undefined;
          if (cwd && this.resolveRoot) {
            void this.resolveRoot(cwd)
              .then((root) => {
                if (this.current() && root === this.cwd) this.invalidate();
              })
              .catch(() => {});
          } else if (cwd === this.cwd) this.invalidate();
        }
      });
      let unwatch = () => {};
      let previousStatus = this.connection.getSnapshot().status;
      const startWatch = () => {
        unwatch();
        unwatch = watchWorkspace(this.connection, this.cwd, this.invalidate);
      };
      if (this.current()) startWatch();
      const offConnection = this.connection.subscribe(() => {
        const status = this.connection.getSnapshot().status;
        if (!this.current()) {
          this.generation++;
          this.publish({ failed: true, loading: false });
          unwatch();
        }
        if (status === previousStatus) return;
        previousStatus = status;
        if (this.current()) {
          startWatch();
          refresh();
        }
      });
      window.addEventListener("focus", refresh);
      document.addEventListener("visibilitychange", refresh);
      this.stop = () => {
        this.generation++;
        this.pending = false;
        clearTimeout(this.timer);
        clearTimeout(this.invalidationTimer);
        offFiles?.();
        off();
        offConnection();
        unwatch();
        window.removeEventListener("focus", refresh);
        document.removeEventListener("visibilitychange", refresh);
      };
      refresh();
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.stop?.();
        this.stop = undefined;
      }
    };
  };
}
/** A cwd is resolved by Git itself: lexical ancestors cannot distinguish submodules. */
class WorkspaceGitCache {
  aliases = new Map<string, WorkspaceGitHandle>();
  private resolutions = new Map<string, Promise<string>>();
  private failedResolutions = new Map<string, number>();
  prefixes = new Map<string, string>();
  private roots = new Map<string, WorkspaceGitStore>();
  constructor(
    private connection: ConnectionStore,
    private epoch: number,
    private scope: number,
  ) {}
  current = () => {
    const state = this.connection.getSnapshot();
    return (
      state.epoch === this.epoch &&
      state.scope === this.scope &&
      state.status === "connected"
    );
  };
  resolveRoot = (cwd: string): Promise<string> => {
    const cached = this.resolutions.get(cwd);
    const failedAt = this.failedResolutions.get(cwd);
    if (cached && (failedAt === undefined || Date.now() - failedAt < 5000))
      return cached;
    this.failedResolutions.delete(cwd);
    const result = (async () => {
      if (!this.current()) throw new Error("Connection changed");
      const response =
        await this.connection.client.request<CommandExecResponse>(
          "command/exec",
          {
            command: [
              "git",
              "--no-optional-locks",
              "rev-parse",
              "--path-format=absolute",
              "--show-toplevel",
              "--show-prefix",
            ],
            cwd,
            sandboxPolicy: { type: "readOnly", networkAccess: false },
            timeoutMs: 5000,
          },
        );
      if (!this.current()) throw new Error("Connection changed");
      const output = response.stdout.replace(/\r?\n$/, "");
      const separator = output.lastIndexOf("\n");
      const root =
        separator < 0 ? output : output.slice(0, separator).replace(/\r$/, "");
      const prefix =
        separator < 0
          ? cwd.startsWith(`${root}/`)
            ? `${cwd.slice(root.length + 1)}/`
            : ""
          : output.slice(separator + 1).replace(/\r$/, "");
      if (
        response.exitCode !== 0 ||
        !/^(?:\/|[a-z]:[\\/])/i.test(root) ||
        root.includes("\0")
      )
        throw new Error("Git root unavailable");
      this.prefixes.set(cwd, prefix);
      this.prefixes.set(root, "");
      if (!this.resolutions.has(root))
        this.resolutions.set(root, Promise.resolve(root));
      this.trimResolutions();
      return root;
    })();
    this.resolutions.set(cwd, result);
    void result.catch(() => {
      if (this.resolutions.get(cwd) === result)
        this.failedResolutions.set(cwd, Date.now());
    });
    // Resolutions are hints and can be discarded independently of live stores.
    this.trimResolutions();
    return result;
  };
  retryFailure(cwd: string) {
    if (this.failedResolutions.has(cwd)) {
      this.failedResolutions.delete(cwd);
      this.resolutions.delete(cwd);
    }
  }
  private trimResolutions() {
    while (this.prefixes.size > 256)
      this.prefixes.delete(this.prefixes.keys().next().value!);
    while (this.resolutions.size > 128) {
      const key = this.resolutions.keys().next().value!;
      this.resolutions.delete(key);
      this.failedResolutions.delete(key);
      this.prefixes.delete(key);
    }
  }
  rootStore(root: string) {
    let store = this.roots.get(root);
    if (!store) {
      store = new WorkspaceGitStore(
        this.connection,
        root,
        this.epoch,
        this.scope,
        this.resolveRoot,
        async (paths) => {
          const directories = [
            ...new Set(
              paths.map((path) => {
                const normalized = path.replace(/\\/g, "/");
                return normalized.slice(0, normalized.lastIndexOf("/")) || "/";
              }),
            ),
          ];
          return (
            await Promise.all(
              directories.map(
                async (directory) =>
                  (await this.resolveRoot(directory)) === root,
              ),
            )
          ).some(Boolean);
        },
      );
      this.roots.set(root, store);
    }
    for (const [key, candidate] of this.roots) {
      if (this.roots.size <= 32) break;
      if (key !== root && !candidate.isSubscribed()) this.roots.delete(key);
    }
    return store;
  }
}
/** Stable external-store facade while a cwd joins its canonical worktree store. */
class WorkspaceGitHandle {
  private snapshot: Snapshot = { failed: false, loading: true };
  private listeners = new Set<() => void>();
  private store?: WorkspaceGitStore;
  private offStore?: () => void;
  private offConnection?: () => void;
  private resolving?: Promise<void>;
  private prefix?: string;
  private generation = 0;
  files?: FileWorkspaceStore;
  sessions?: SessionsStore;
  constructor(
    private cache: WorkspaceGitCache,
    private connection: ConnectionStore,
    readonly cwd: string,
  ) {}
  workspacePrefix = () => this.prefix;
  isSubscribed = () => this.listeners.size > 0;
  getSnapshot = () => this.store?.getSnapshot() ?? this.snapshot;
  private notify = () => this.listeners.forEach((listener) => listener());
  private connect = () => {
    if (
      this.resolving ||
      !this.cwd ||
      !this.cache.current() ||
      !this.listeners.size
    )
      return this.resolving;
    if (this.store) return;
    const generation = this.generation;
    this.resolving = (async () => {
      try {
        const root = await this.cache.resolveRoot(this.cwd);
        if (
          generation !== this.generation ||
          !this.cache.current() ||
          !this.listeners.size
        )
          return;
        this.prefix = this.cache.prefixes.get(this.cwd);
        this.store = this.cache.rootStore(root);
        this.store.files = this.files;
        this.store.sessions = this.sessions;
        this.offStore = this.store.subscribe(this.notify);
        this.notify();
      } catch {
        if (
          generation === this.generation &&
          this.cache.current() &&
          this.listeners.size
        ) {
          this.snapshot = { failed: true, loading: false };
          this.notify();
        }
      } finally {
        this.resolving = undefined;
        if (
          generation !== this.generation &&
          this.cache.current() &&
          this.listeners.size
        )
          void this.connect();
      }
    })();
    return this.resolving;
  };
  refresh = async () => {
    const existing = this.store;
    this.cache.retryFailure(this.cwd);
    await this.connect();
    if (existing && this.cache.current()) await existing.refresh();
  };
  observeRevision(revision: number) {
    this.store?.observeRevision(revision);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1 && this.cwd) {
      this.offConnection = this.connection.subscribe(() => {
        if (!this.cache.current()) {
          this.generation++;
          this.offStore?.();
          this.offStore = undefined;
          this.store = undefined;
          this.snapshot = { failed: true, loading: false };
          this.notify();
        } else void this.connect();
      });
      void this.connect();
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.generation++;
        if (this.store) this.snapshot = this.store.getSnapshot();
        this.offStore?.();
        this.offStore = undefined;
        this.store = undefined;
        this.offConnection?.();
        this.offConnection = undefined;
      }
    };
  };
}
const stores = new WeakMap<ConnectionStore, Map<string, WorkspaceGitCache>>();
export function workspaceGitStore(
  connection: ConnectionStore,
  cwd: string,
  epoch: number,
  scope: number,
) {
  let environments = stores.get(connection);
  if (!environments) {
    environments = new Map();
    stores.set(connection, environments);
  }
  const identity = JSON.stringify([epoch, scope]);
  let cache = environments.get(identity);
  if (!cache) {
    cache = new WorkspaceGitCache(connection, epoch, scope);
    environments.clear();
    environments.set(identity, cache);
  }
  let handle = cache.aliases.get(cwd);
  if (!handle) {
    handle = new WorkspaceGitHandle(cache, connection, cwd);
    cache.aliases.set(cwd, handle);
  }
  for (const [path, candidate] of cache.aliases) {
    if (cache.aliases.size <= 64) break;
    if (path !== cwd && !candidate.isSubscribed()) cache.aliases.delete(path);
  }
  return handle;
}
export function useWorkspaceGitStatus(cwd: string) {
  const { connection, files, sessions } = useRuntime();
  const { epoch, scope, status } = useStore(connection);
  const store = useMemo(
    () => workspaceGitStore(connection, cwd, epoch, scope),
    [connection, cwd, epoch, scope],
  );
  store.files = files;
  store.sessions = sessions;
  const snapshot = useStore(store);
  return {
    ...snapshot,
    workspacePrefix: store.workspacePrefix(),
    value: status === "connected" ? snapshot.value : undefined,
    connected: status === "connected",
    refresh: store.refresh,
  };
}
