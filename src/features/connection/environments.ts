import { t } from "../../lib/i18n";
import { sameEnvironmentSessions } from "./environment-summary";
import { createRuntime } from "../../lib/runtime";
import { sameEndpoint } from "./store";
import { Store } from "../../lib/store";

export interface Environment {
  id: string;
  name: string;
  kind: "local" | "remote";
  url: string;
  autoConnect?: boolean;
  runtime: ReturnType<typeof createRuntime>;
}
export type EnvironmentProfile = Omit<Environment, "runtime">;
const local: EnvironmentProfile = {
  id: "local",
  get name() {
    return t("本机");
  },
  kind: "local",
  url: "ws://127.0.0.1:4501",
};
function savedProfiles(): EnvironmentProfile[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem("codex-environments") || "null",
    );
    if (!Array.isArray(value)) return [local];
    const profiles = value.filter((entry): entry is EnvironmentProfile => {
      if (!entry || typeof entry !== "object") return false;
      const e = entry as EnvironmentProfile;
      return (
        typeof e.id === "string" &&
        /^[\w-]{1,80}$/.test(e.id) &&
        typeof e.name === "string" &&
        typeof e.url === "string" &&
        (e.kind === "local" || e.kind === "remote")
      );
    });
    return [
      profiles.find((e) => e.id === "local") || local,
      ...profiles.filter((e) => e.id !== "local").slice(0, 19),
    ];
  } catch {
    return [local];
  }
}
export class EnvironmentsStore extends Store<{
  entries: Environment[];
  activeId: string;
}> {
  constructor(profiles: EnvironmentProfile[] = savedProfiles()) {
    const entries = profiles.map((profile) => ({
      ...profile,

      runtime: createRuntime({}, profile.id, profile.url),
    }));
    for (const entry of entries) {
      const profile = profiles.find((item) => item.id === entry.id)!;
      if (profile.id === "local" && ["本机", "Local"].includes(profile.name)) {
        Object.defineProperty(entry, "name", {
          enumerable: true,
          configurable: true,
          get: () => t("本机"),
        });
      }
    }
    let activeId = entries[0].id;
    try {
      const saved = localStorage.getItem("codex-active-environment");
      if (entries.some((entry) => entry.id === saved)) activeId = saved!;
    } catch {
      /* Storage can be unavailable. */
    }
    super({ entries, activeId });
    for (const entry of entries) {
      this.observe(entry);
      entry.runtime.sessions.setForeground(entry.id === this.state.activeId);
      entry.runtime.files.setForeground(entry.id === this.state.activeId);
    }
  }
  private restored = false;
  restoreConnections() {
    if (this.restored) return;
    this.restored = true;
    for (const entry of this.state.entries) {
      if (
        entry.autoConnect !== false &&
        entry.runtime.connection.getSnapshot().status === "disconnected"
      )
        void entry.runtime.connect(entry.url).catch(() => {});
    }
  }
  private observers = new Map<string, (() => void)[]>();
  private observe(entry: Environment) {
    let sessions = entry.runtime.sessions.getSnapshot();
    this.observers.set(
      entry.id,
      [
        entry.runtime.sessions,
        entry.runtime.connection,
        entry.runtime.requests,
      ].map((store) =>
        store.subscribe(() => {
          if (store === entry.runtime.sessions) {
            const next = entry.runtime.sessions.getSnapshot();
            if (sameEnvironmentSessions(sessions, next)) return;
            sessions = next;
          }
          if (store === entry.runtime.connection) {
            const current = this.state.entries.find((e) => e.id === entry.id);
            if (current)
              current.autoConnect = entry.runtime.connection.reconnectOnReload;
            this.persist();
          }
          this.update({ ...this.state });
        }),
      ),
    );
  }
  active() {
    return this.state.entries.find((e) => e.id === this.state.activeId)!;
  }
  select(id: string) {
    if (!this.state.entries.some((e) => e.id === id)) return;
    for (const entry of this.state.entries) {
      entry.runtime.sessions.setForeground(entry.id === id);
      entry.runtime.files.setForeground(entry.id === id);
    }
    this.update({ ...this.state, activeId: id });
    try {
      localStorage.setItem("codex-active-environment", id);
    } catch {
      /* Storage can be unavailable. */
    }
  }
  save(profile: EnvironmentProfile, activate = true): Environment {
    const old = this.state.entries.find((e) => e.id === profile.id);
    if (!old && this.state.entries.length >= 20)
      throw Error(t("最多添加 20 个工作环境。"));
    const entry = {
      ...profile,
      autoConnect: profile.autoConnect ?? old?.autoConnect,
      runtime: old?.runtime || createRuntime({}, profile.id, profile.url),
    };
    if (old && !sameEndpoint(old.url, profile.url))
      old.runtime.connection.disconnect();
    const entries = old
      ? this.state.entries.map((e) => (e.id === profile.id ? entry : e))
      : [...this.state.entries, entry];
    this.update({ ...this.state, entries });
    if (!old) this.observe(entry);
    entry.runtime.files.setForeground(entry.id === this.state.activeId);
    this.persist();
    if (activate) this.select(entry.id);
    return entry;
  }
  remove(id: string) {
    if (id === "local") return;
    this.state.entries
      .find((e) => e.id === id)
      ?.runtime.connection.disconnect();
    for (const unsubscribe of this.observers.get(id) || []) unsubscribe();
    this.observers.delete(id);
    const entries = this.state.entries.filter((e) => e.id !== id);
    this.update({
      entries,
      activeId:
        this.state.activeId === id ? entries[0].id : this.state.activeId,
    });
    this.select(this.state.activeId);
    this.persist();
  }
  private persist() {
    try {
      localStorage.setItem(
        "codex-environments",
        JSON.stringify(
          this.state.entries.map(({ id, name, kind, url, autoConnect }) => ({
            id,
            name,
            kind,
            url,
            autoConnect,
          })),
        ),
      );
    } catch {
      /* Connections work when browser storage is unavailable. */
    }
  }
}
export const environments = new EnvironmentsStore();
