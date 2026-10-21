import type { McpServerOauthLoginCompletedNotification } from "../../generated/v2/McpServerOauthLoginCompletedNotification";
import type { RpcCall } from "../../lib/rpc";
import type { ListMcpServerStatusResponse } from "../../generated/v2/ListMcpServerStatusResponse";
import type { ConfigReadResponse } from "../../generated/v2/ConfigReadResponse";
import type { ConfigRequirementsReadResponse } from "../../generated/v2/ConfigRequirementsReadResponse";
import type { SkillsListResponse } from "../../generated/v2/SkillsListResponse";
import type { HooksListResponse } from "../../generated/v2/HooksListResponse";
import type { AppsListResponse } from "../../generated/v2/AppsListResponse";
import type { AppsInstalledResponse } from "../../generated/v2/AppsInstalledResponse";
import type { AppsReadResponse } from "../../generated/v2/AppsReadResponse";
import type { McpServerOauthLoginResponse } from "../../generated/v2/McpServerOauthLoginResponse";
import type { ConfigWriteResponse } from "../../generated/v2/ConfigWriteResponse";
import type { ConnectionStore } from "../connection/store";
import { Store, errorMessage } from "../../lib/store";

type Data = {
  mcp: ListMcpServerStatusResponse;
  config: ConfigReadResponse;
  requirements: ConfigRequirementsReadResponse;
  skills: SkillsListResponse;
  hooks: HooksListResponse;
  apps: AppsListResponse;
  installed: AppsInstalledResponse;
  app: AppsReadResponse;
};
export type ToolSection = keyof Data;
type Resource<T> = { data: T | null; busy: boolean; error: string | null };
type State = { [K in ToolSection]: Resource<Data[K]> } & {
  action: string | null;
  actionError: string | null;
  message: string | null;
  oauth: ({ name: string } & McpServerOauthLoginResponse) | null;
  startup: string[];
};
const empty = () => ({ data: null, busy: false, error: null });
export function safeAuthorizationUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export class EnvironmentToolsStore extends Store<State> {
  private alive = false;
  private generation = 0;
  private loginName: string | null = null;
  private earlyLogin: McpServerOauthLoginCompletedNotification[] = [];
  private requests = new Map<ToolSection, number>();
  private disposeCallbacks: (() => void)[] = [];
  constructor(
    readonly connection: ConnectionStore,
    readonly cwd?: string,
    readonly epoch = connection.getSnapshot().epoch,
  ) {
    super({
      mcp: empty(),
      config: empty(),
      requirements: empty(),
      skills: empty(),
      hooks: empty(),
      apps: empty(),
      installed: empty(),
      app: empty(),
      action: null,
      actionError: null,
      message: null,
      oauth: null,
      startup: [],
    });
  }
  start(): () => void {
    if (this.alive) return () => this.dispose();
    this.alive = true;
    const connection = this.connection;
    this.disposeCallbacks = [
      connection.client.onNotification((event) => {
        if (!this.current(this.epoch)) return;
        if (event.method === "skills/changed") void this.load("skills");
        if (event.method === "app/list/updated") {
          void this.load("apps");
          void this.load("installed");
        }
        if (event.method === "mcpServer/startupStatus/updated")
          this.update({
            ...this.state,
            startup: [
              ...this.state.startup,
              `${event.params.name}: ${event.params.status}${event.params.error ? ` · ${event.params.error}` : ""}`,
            ].slice(-10),
          });
        if (event.method === "mcpServer/oauthLogin/completed") {
          if (!this.state.oauth && this.loginName === event.params.name) {
            this.earlyLogin = [...this.earlyLogin, event.params].slice(-10);
          } else this.completeLogin(event.params);
        }
      }),
      connection.subscribe(() => {
        if (connection.getSnapshot().status === "disconnected")
          this.update({ ...this.state, oauth: null, action: null });
      }),
    ];
    return () => this.dispose();
  }
  private completeLogin(event: McpServerOauthLoginCompletedNotification) {
    const pending = this.state.oauth;
    if (
      !this.current(this.epoch) ||
      !pending ||
      pending.name !== event.name ||
      (pending.loginId && pending.loginId !== event.loginId)
    )
      return;
    this.update({
      ...this.state,
      oauth: null,
      message: event.success
        ? "MCP 登录成功"
        : `MCP 登录失败：${event.error ?? "未知错误"}`,
    });
    void this.load("mcp");
  }
  dispose() {
    this.alive = false;
    this.generation++;
    this.disposeCallbacks.forEach((off) => off());
    this.disposeCallbacks = [];
    this.loginName = null;
    this.earlyLogin = [];
    this.update({
      ...this.state,
      action: null,
      oauth: null,
      ...Object.fromEntries(
        (
          [
            "mcp",
            "config",
            "requirements",
            "skills",
            "hooks",
            "apps",
            "installed",
            "app",
          ] as const
        ).map((key) => [key, { ...this.state[key], busy: false }]),
      ),
    });
  }
  private current(epoch: number, generation = this.generation) {
    return (
      this.alive &&
      generation === this.generation &&
      epoch === this.epoch &&
      this.connection.getSnapshot().epoch === epoch &&
      this.connection.getSnapshot().status === "connected"
    );
  }
  private request<T>(...call: RpcCall) {
    return this.connection.client.request<T>(...call);
  }
  async load<K extends ToolSection>(
    key: K,
    more = false,
    appId?: string,
  ): Promise<void> {
    if (this.state[key].busy || !this.current(this.epoch)) return;
    const epoch = this.connection.getSnapshot().epoch;
    const generation = this.generation;
    const serial = (this.requests.get(key) ?? 0) + 1;
    this.requests.set(key, serial);
    this.update({
      ...this.state,
      [key]: { ...this.state[key], busy: true, error: null },
    });
    try {
      const context = this.cwd ? { cwds: [this.cwd] } : {};
      let result: Data[ToolSection];
      switch (key) {
        case "mcp":
          result = await this.request<Data["mcp"]>("mcpServerStatus/list", {
            cursor: more ? this.state.mcp.data?.nextCursor : null,
            limit: 50,
            detail: "toolsAndAuthOnly",
          });
          break;
        case "config":
          result = await this.request<Data["config"]>("config/read", {
            cwd: this.cwd,
            includeLayers: false,
          });
          break;
        case "requirements":
          result = await this.request<Data["requirements"]>(
            "configRequirements/read",
            undefined,
          );
          break;
        case "skills":
          result = await this.request<Data["skills"]>("skills/list", {
            ...context,
            forceReload: true,
          });
          break;
        case "hooks":
          result = await this.request<Data["hooks"]>("hooks/list", context);
          break;
        case "apps":
          result = await this.request<Data["apps"]>("app/list", {
            cursor: more ? this.state.apps.data?.nextCursor : null,
            limit: 50,
          });
          break;
        case "installed":
          result = await this.request<Data["installed"]>("app/installed", {});
          break;
        case "app":
          result = await this.request<Data["app"]>("app/read", {
            appIds: appId ? [appId] : [],
            includeTools: true,
          });
          break;
      }
      if (!this.current(epoch, generation) || this.requests.get(key) !== serial)
        return;
      if (more && (key === "mcp" || key === "apps")) {
        const previous = this.state[key].data as
          Data["mcp"] | Data["apps"] | null;
        const page = result as Data["mcp"] | Data["apps"];
        if (page.nextCursor && page.nextCursor === previous?.nextCursor)
          throw Error("服务端重复分页游标");
        result = {
          ...page,
          data: [...(previous?.data ?? []), ...page.data],
        } as Data[typeof key];
      }
      this.update({
        ...this.state,
        [key]: { data: result, busy: false, error: null },
      });
    } catch (error) {
      if (this.current(epoch, generation) && this.requests.get(key) === serial)
        this.update({
          ...this.state,
          [key]: {
            ...this.state[key],
            busy: false,
            error: errorMessage(error),
          },
        });
    }
  }
  private async action(
    label: string,
    task: (current: () => boolean) => Promise<void>,
  ) {
    if (this.state.action || !this.current(this.epoch)) return;
    const epoch = this.connection.getSnapshot().epoch;
    const generation = this.generation;
    this.update({
      ...this.state,
      action: label,
      actionError: null,
      message: null,
    });
    try {
      await task(() => this.current(epoch, generation));
    } catch (error) {
      if (this.current(epoch, generation))
        this.update({ ...this.state, actionError: errorMessage(error) });
    } finally {
      if (label === "oauth" && generation === this.generation) {
        this.loginName = null;
        this.earlyLogin = [];
      }
      if (this.current(epoch, generation))
        this.update({ ...this.state, action: null });
    }
  }
  login(name: string) {
    return this.action("oauth", async (current) => {
      this.loginName = name;
      this.earlyLogin = [];
      const result = await this.request<McpServerOauthLoginResponse>(
        "mcpServer/oauth/login",
        { name },
      );
      if (!safeAuthorizationUrl(result.authorizationUrl))
        throw Error("服务端返回无效登录地址");
      if (current()) {
        this.update({ ...this.state, oauth: { ...result, name } });
        for (const event of this.earlyLogin) this.completeLogin(event);
      }
      if (current()) {
        this.loginName = null;
        this.earlyLogin = [];
      }
    });
  }
  reloadMcp() {
    return this.action("reload", async (current) => {
      await this.request("config/mcpServer/reload", undefined);
      if (current()) {
        this.update({ ...this.state, message: "已请求重新加载 MCP 配置" });
        await this.load("mcp");
      }
    });
  }
  setSkill(path: string, enabled: boolean) {
    return this.action("skill", async (current) => {
      await this.request("skills/config/write", { path, enabled });
      if (current()) await this.load("skills");
    });
  }
  setRoots(roots: string[]) {
    return this.action("roots", async (current) => {
      if (
        roots.some(
          (root) => !root.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(root),
        )
      )
        throw Error("技能目录必须为绝对路径");
      await this.request("skills/extraRoots/set", { extraRoots: roots });
      if (current()) {
        this.update({
          ...this.state,
          message: "已替换当前服务进程的额外技能目录（不写入磁盘）",
        });
        await this.load("skills");
      }
    });
  }
  writeConfig(keyPath: "model" | "approval_policy", value: string) {
    return this.action("config", async (current) => {
      if (
        !value.trim() ||
        (keyPath === "approval_policy" &&
          !["untrusted", "on-request", "never"].includes(value))
      )
        throw Error("配置值无效");
      const result = await this.request<ConfigWriteResponse>(
        "config/value/write",
        {
          keyPath,
          value: value.trim(),
          mergeStrategy: "replace",
          ...(this.state.config.data?.origins[keyPath]?.name.type === "user"
            ? {
                expectedVersion:
                  this.state.config.data.origins[keyPath]!.version,
                filePath:
                  this.state.config.data.origins[keyPath]!.name.type === "user"
                    ? this.state.config.data.origins[keyPath]!.name.file
                    : undefined,
              }
            : {}),
        },
      );
      if (current()) {
        this.update({
          ...this.state,
          message: `配置已写入：${result.status}${result.overriddenMetadata ? "（被其他配置覆盖）" : ""}`,
          // A concurrent read may have started before the write. Supersede it
          // and refresh origins/version before accepting the next edit.
          config: empty(),
        });
        await this.load("config");
      }
    });
  }
}
