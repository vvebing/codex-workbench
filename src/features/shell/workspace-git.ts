import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useStore } from "../../components/hooks";
import { useRuntime } from "../../lib/runtime-context";
import type { ConnectionStore } from "../connection/store";
import type { CommandExecResponse } from "../../generated/v2/CommandExecResponse";
import {
  gitStatusCommand,
  parseWorkspaceGitStatus,
  type WorkspaceGitStatus,
} from "./git-status";
import { watchWorkspace } from "./workspace-watch";

type Snapshot = {
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
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private connection: ConnectionStore,
    readonly cwd: string,
    private epoch: number,
    private scope: number,
  ) {}
  getSnapshot = () => this.snapshot;
  private publish(snapshot: Snapshot) {
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
    this.publish({ ...this.snapshot, loading: true });
    try {
      const result = await this.connection.client.request<CommandExecResponse>(
        "command/exec",
        gitStatusCommand(this.cwd),
      );
      if (!this.current() || generation !== this.generation) return;
      if (result.exitCode !== 0) throw new Error("Git unavailable");
      const root = await this.connection.client.request<CommandExecResponse>(
        "command/exec",
        {
          command: [
            "git",
            "--no-optional-locks",
            "rev-parse",
            "--show-toplevel",
          ],
          cwd: this.cwd,
          sandboxPolicy: { type: "readOnly", networkAccess: false },
          timeoutMs: 5000,
        },
      );
      if (!this.current() || generation !== this.generation) return;
      if (root.exitCode !== 0 || !root.stdout.trim())
        throw new Error("Git root unavailable");
      this.publish({
        value: {
          ...parseWorkspaceGitStatus(result.stdout),
          repoRoot: root.stdout.replace(/\r?\n$/, ""),
        },
        failed: false,
        loading: false,
      });
    } catch {
      if (this.current() && generation === this.generation)
        this.publish({ failed: true, loading: false });
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
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1 && this.cwd) {
      const refresh = () => {
        void this.refresh();
      };
      const off = this.connection.client.onNotification((event) => {
        if (
          event.method === "turn/diff/updated" ||
          event.method === "turn/completed"
        )
          refresh();
      });
      let unwatch = () => {};
      let previousStatus = this.connection.getSnapshot().status;
      const startWatch = () => {
        unwatch();
        unwatch = watchWorkspace(this.connection, this.cwd, refresh);
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
const stores = new WeakMap<ConnectionStore, Map<string, WorkspaceGitStore>>();
export function workspaceGitStore(
  connection: ConnectionStore,
  cwd: string,
  epoch: number,
  scope: number,
) {
  let cache = stores.get(connection);
  if (!cache) {
    cache = new Map();
    stores.set(connection, cache);
  }
  const key = JSON.stringify([epoch, scope, cwd]);
  let store = cache.get(key);
  if (!store) {
    store = new WorkspaceGitStore(connection, cwd, epoch, scope);
    // Retain current environment only; old subscribers still own their store.
    for (const old of cache.keys())
      if (!old.startsWith(`[${epoch},${scope},`)) cache.delete(old);
    cache.set(key, store);
  }
  return store;
}
export function useWorkspaceGitStatus(cwd: string) {
  const { connection, files } = useRuntime();
  const revision = useSyncExternalStore(
    files.subscribe,
    () => files.getSnapshot().revision,
  );
  const previousRevision = useRef(revision);
  const { epoch, scope, status } = useStore(connection);
  const store = useMemo(
    () => workspaceGitStore(connection, cwd, epoch, scope),
    [connection, cwd, epoch, scope],
  );
  const snapshot = useStore(store);
  useEffect(() => {
    if (previousRevision.current === revision) return;
    previousRevision.current = revision;
    void store.refresh();
  }, [revision, store]);
  return {
    ...snapshot,
    value: status === "connected" ? snapshot.value : undefined,
    connected: status === "connected",
    refresh: store.refresh,
  };
}
