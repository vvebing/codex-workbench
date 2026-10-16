import { Store } from "../../lib/store";
import type { EnvironmentsStore } from "../connection/environments";

export function readSessionUrl(url: URL) {
  return {
    environmentId: url.searchParams.get("env") || "local",
    sessionId: url.searchParams.get("session"),
    explicit: url.searchParams.has("env") || url.searchParams.has("session"),
  };
}
export function writeSessionUrl(
  url: URL,
  environmentId: string,
  sessionId: string | null,
) {
  const next = new URL(url);
  next.searchParams.set("env", environmentId);
  if (sessionId) next.searchParams.set("session", sessionId);
  else next.searchParams.delete("session");
  return next;
}

type RouteState = {
  status: "ready" | "waiting" | "loading" | "error";
  message: string;
};
/** Owns browser navigation; session/connection notifications never add history entries. */
export class SessionUrlStore extends Store<RouteState> {
  private target: ReturnType<typeof readSessionUrl> | null = null;
  private generation = 0;
  private opening = false;
  private queued = false;
  private lastSelection = "";
  constructor(
    private environments: EnvironmentsStore,
    private browser: Window,
  ) {
    super({ status: "ready", message: "" });
  }
  start() {
    const stop = this.environments.subscribe(this.schedule);
    this.browser.addEventListener("popstate", this.navigate);
    this.navigate();
    return () => {
      stop();
      this.browser.removeEventListener("popstate", this.navigate);
      this.generation++;
    };
  }
  private selection() {
    const entry = this.environments.active();
    return {
      environmentId: entry.id,
      sessionId: entry.runtime.sessions.getSnapshot().selectedId,
    };
  }
  private key() {
    return JSON.stringify(this.selection());
  }
  private navigate = () => {
    this.generation++;
    this.opening = false;
    const route = readSessionUrl(new URL(this.browser.location.href));
    this.target = route.explicit ? route : null;
    if (this.target) {
      this.environments.select(route.environmentId);
      const entry = this.environments
        .getSnapshot()
        .entries.find((e) => e.id === route.environmentId);
      entry?.runtime.sessions.clearSelection();
    }
    this.lastSelection = this.key();
    this.update({ status: "ready", message: "" });
    this.reconcile();
  };
  private schedule = () => {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.reconcile();
    });
  };
  private reconcile() {
    const key = this.key();
    const selection = this.selection();
    const selectingTarget =
      this.opening &&
      selection.environmentId === this.target?.environmentId &&
      selection.sessionId === this.target?.sessionId;
    if (key !== this.lastSelection && !selectingTarget) {
      this.target = null;
      this.generation++;
      this.opening = false;
      this.update({ status: "ready", message: "" });
    }
    this.lastSelection = key;
    if (!this.target) {
      const { environmentId, sessionId } = this.selection();
      const url = writeSessionUrl(
        new URL(this.browser.location.href),
        environmentId,
        sessionId,
      );
      if (url.href !== this.browser.location.href) {
        const previous = readSessionUrl(new URL(this.browser.location.href));
        const promoted =
          previous.environmentId === environmentId &&
          !!previous.sessionId &&
          !!sessionId &&
          this.environments.active().runtime.sessions.getSnapshot()
            .draftOrigins[sessionId] === previous.sessionId;
        const method =
          previous.explicit && !promoted ? "pushState" : "replaceState";
        this.browser.history[method](null, "", url);
      }
      return;
    }
    const target = this.target;
    const entry = this.environments
      .getSnapshot()
      .entries.find((e) => e.id === target.environmentId);
    if (!entry) {
      this.update({
        status: "error",
        message:
          "此链接对应的工作环境尚未配置或已移除。请在连接设置中检查工作环境。",
      });
      return;
    }
    if (!target.sessionId) {
      this.target = null;
      return;
    }
    if (this.opening || this.state.status === "error") return;
    if (entry.runtime.connection.getSnapshot().status !== "connected") {
      this.update({
        status: "waiting",
        message: `等待连接「${entry.name}」，连接成功后将打开此会话。`,
      });
      return;
    }
    this.opening = true;
    const generation = this.generation;
    this.update({ status: "loading", message: "正在打开链接中的会话…" });
    void entry.runtime.sessions
      .open(target.sessionId)
      .then(() => {
        if (generation !== this.generation) return;
        this.target = null;
        this.update({ status: "ready", message: "" });
      })
      .catch(() => {
        if (generation !== this.generation) return;
        this.update({
          status: "error",
          message: target.sessionId?.startsWith("local-draft-")
            ? "此草稿只在创建它的页面中可用。请选择历史会话或开始新会话。"
            : "无法打开此会话：它可能已删除，或当前工作环境暂时无法读取。请确认工作环境后重试。",
        });
      })
      .finally(() => {
        if (generation !== this.generation) return;
        this.opening = false;
        this.lastSelection = this.key();
        this.schedule();
      });
  }
  retry = () => {
    this.update({ status: "ready", message: "" });
    this.reconcile();
  };
  home = () => {
    this.target = null;
    this.generation++;
    this.opening = false;
    this.environments.active().runtime.sessions.clearSelection();
    this.lastSelection = this.key();
    this.update({ status: "ready", message: "" });
    const url = writeSessionUrl(
      new URL(this.browser.location.href),
      this.environments.active().id,
      null,
    );
    this.browser.history.pushState(null, "", url);
  };
}
