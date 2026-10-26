import { t, useLocale } from "../../lib/i18n";
import { CapabilityPanel, useCapabilities } from "./CapabilityPanel";
import type { RpcMethod } from "../../lib/rpc";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useStore } from "../../components/hooks";
import { Button, ErrorNotice, SelectField } from "../../components/ui";
import type { ConnectionStore } from "../connection/store";
import {
  EnvironmentToolsStore,
  safeAuthorizationUrl,
  type ToolSection,
} from "./environment-tools-store";
import {
  SettingsField,
  SettingsSection,
  settingsInputClass,
  settingsSelectClass,
} from "./settings-ui";

export function EnvironmentTools({
  connection,
  group,
  cwd,
  onInsertApp,
}: {
  connection: ConnectionStore;
  group: "configuration" | "integrations";
  cwd?: string;
  onInsertApp?: (app: { id: string; name: string }) => void;
}) {
  useLocale();
  const session = useStore(connection);
  const capabilities = useCapabilities(connection);
  const unsupported = (method: RpcMethod) =>
    capabilities[method]?.state === "unsupported";
  const methods: Record<ToolSection, RpcMethod> = {
    mcp: "mcpServerStatus/list",
    config: "config/read",
    requirements: "configRequirements/read",
    skills: "skills/list",
    hooks: "hooks/list",
    apps: "app/list",
    installed: "app/installed",
    app: "app/read",
  };
  const store = useMemo(
    () => new EnvironmentToolsStore(connection, cwd, session.epoch),
    [connection, cwd, session.epoch],
  );
  const state = useStore(store);
  const [model, setModel] = useState("");
  const [policy, setPolicy] = useState("unset");
  const [roots, setRoots] = useState("");
  useEffect(() => store.start(), [store]);
  const disabled = session.status !== "connected" || !!state.action;
  const panel = (key: ToolSection, title: string, children: ReactNode) => {
    const configuration = key === "config" || key === "requirements";
    if (configuration !== (group === "configuration")) return null;
    return (
      <SettingsSection
        title={title}
        trailing={
          <Button
            size="sm"
            variant="secondary"
            disabled={
              session.status !== "connected" ||
              state[key].busy ||
              unsupported(methods[key])
            }
            onClick={() => void store.load(key)}
          >
            {state[key].busy ? t("加载中…") : t("刷新")}
          </Button>
        }
      >
        {unsupported(methods[key]) && (
          <p role="status" className="text-xs text-muted">
            {t("服务端未提供")}
            {methods[key]}
            {t("；可在「服务端功能支持」清除该接口记录后重新验证。")}
          </p>
        )}
        {state[key].error && <ErrorNotice>{state[key].error}</ErrorNotice>}
        {!state[key].data && !state[key].busy && !state[key].error && (
          <p className="text-xs text-muted">{t("尚未加载")}</p>
        )}
        {children}
      </SettingsSection>
    );
  };
  return (
    <div className="space-y-6 text-xs">
      {group === "integrations" && <CapabilityPanel connection={connection} />}
      {session.status !== "connected" && <p>{t("连接环境后可管理服务。")}</p>}
      {Object.entries(capabilities)
        .filter(([, value]) => value?.state === "unsupported")
        .map(([method]) => (
          <p key={method} role="status" className="text-muted">
            {t("服务端未提供")}
            {method}
            {t(
              "；对应操作已禁用。可在「工具与集成 → 服务端功能支持」清除具体接口记录后重新验证。",
            )}
          </p>
        ))}
      {state.actionError && <ErrorNotice>{state.actionError}</ErrorNotice>}
      {state.message && (
        <p role="status">{state.messageText?.() ?? state.message}</p>
      )}
      {panel(
        "mcp",
        t("MCP 服务"),
        <div className="space-y-2">
          {state.mcp.data?.data.map((server) => (
            <div
              key={server.name}
              className="space-y-1 rounded-lg border border-border p-3"
            >
              <p>
                {server.name} · {server.runtimeStatus ?? t("状态未知")} ·{" "}
                {server.authStatus}
              </p>
              <p className="text-muted">
                {Object.keys(server.tools).length} {t("个工具 ·")}{" "}
                {server.httpOrigin ?? t("本地传输")}
              </p>
              {server.toolsError && (
                <p className="text-danger">{server.toolsError}</p>
              )}
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled || unsupported("mcpServer/oauth/login")}
                onClick={() => void store.login(server.name)}
              >
                {t("OAuth 登录")}
              </Button>
            </div>
          ))}
          {state.mcp.data?.nextCursor && (
            <Button
              size="sm"
              disabled={state.mcp.busy || unsupported("mcpServerStatus/list")}
              onClick={() => void store.load("mcp", true)}
            >
              {t("更多服务")}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || unsupported("config/mcpServer/reload")}
            onClick={() => void store.reloadMcp()}
          >
            {t("重新加载 MCP 配置")}
          </Button>
          {state.oauth && (
            <p>
              {t("在浏览器完成")}
              {state.oauth.name} {t("登录：")}
              <a
                className="text-accent"
                href={
                  safeAuthorizationUrl(state.oauth.authorizationUrl) ??
                  undefined
                }
                target="_blank"
                rel="noreferrer"
              >
                {t("打开授权页")}
              </a>
            </p>
          )}
          {state.startup.map((message, index) => (
            <p key={index} className="text-muted">
              {message}
            </p>
          ))}
        </div>,
      )}
      {group === "configuration" && (
        <SettingsSection
          title={t("设备默认设置")}
          description={t(
            "保存到所选设备的用户配置，项目配置可覆盖这些默认值。此处用于设置新的默认值，不展示项目配置或当前会话参数。",
          )}
        >
          <div className="space-y-4">
            <SettingsField id="device-default-model" label={t("设备默认模型")}>
              <input
                id="device-default-model"
                className={settingsInputClass}
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={t("输入要保存的模型 ID")}
              />
            </SettingsField>
            <Button
              size="sm"
              variant="secondary"
              disabled={
                disabled || !model.trim() || unsupported("config/value/write")
              }
              onClick={() => void store.writeConfig("model", model)}
            >
              {t("保存设备默认模型")}
            </Button>
            <SettingsField
              id="device-approval-policy"
              label={t("设备默认审批策略")}
            >
              <SelectField
                id="device-approval-policy"
                label={t("设备默认审批策略")}
                className={settingsSelectClass}
                value={policy}
                disabled={disabled}
                onValueChange={setPolicy}
                options={[
                  { value: "unset", label: t("选择要保存的策略") },
                  ...["untrusted", "on-request", "never"].map((value) => ({
                    value,
                    label: value,
                  })),
                ]}
              />
            </SettingsField>
            <Button
              size="sm"
              variant="secondary"
              disabled={
                disabled ||
                policy === "unset" ||
                unsupported("config/value/write")
              }
              onClick={() => void store.writeConfig("approval_policy", policy)}
            >
              {t("保存设备默认审批策略")}
            </Button>
          </div>
        </SettingsSection>
      )}
      {panel(
        "requirements",
        t("受管策略"),
        state.requirements.data && (
          <div className="space-y-1">
            <p>
              {state.requirements.data.requirements
                ? t("已配置受管约束")
                : t("没有受管约束")}
            </p>
            {state.requirements.data.requirements && (
              <>
                <p>
                  {t("审批策略：")}
                  {state.requirements.data.requirements.allowedApprovalPolicies
                    ?.map((value) =>
                      typeof value === "string" ? value : t("自定义"),
                    )
                    .join(", ") ?? t("未限定")}
                </p>
                <p>
                  {t("沙箱模式：")}
                  {state.requirements.data.requirements.allowedSandboxModes?.join(
                    ", ",
                  ) ?? t("未限定")}
                </p>
                <p>
                  {t("提供方：")}
                  {state.requirements.data.requirements.modelProvider ??
                    t("未限定")}
                </p>
              </>
            )}
          </div>
        ),
      )}
      {panel(
        "skills",
        t("技能"),
        <div className="space-y-3">
          {state.skills.data?.data.map((entry) => (
            <div key={entry.cwd} className="space-y-2">
              <p className="text-muted break-all">{entry.cwd}</p>
              {entry.errors.map((error) => (
                <p key={error.path} className="text-danger">
                  {error.path}: {error.message}
                </p>
              ))}
              {entry.skills.map((skill) => (
                <div
                  key={skill.path}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p>
                      {skill.name} · {skill.enabled ? t("已启用") : t("已停用")}
                    </p>
                    <p className="text-muted">
                      {skill.shortDescription ?? skill.description}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={disabled || unsupported("skills/config/write")}
                    onClick={() =>
                      void store.setSkill(skill.path, !skill.enabled)
                    }
                  >
                    {skill.enabled ? t("停用") : t("启用")}
                  </Button>
                </div>
              ))}
            </div>
          ))}
          <SettingsField
            id="extra-skill-roots"
            label={t("额外技能目录（每行一个绝对路径）")}
            description={t(
              "替换当前服务进程的全部额外技能目录，留空会清除；不写入磁盘。",
            )}
          >
            <textarea
              id="extra-skill-roots"
              aria-describedby="extra-skill-roots-description"
              className={settingsInputClass}
              value={roots}
              onChange={(event) => setRoots(event.target.value)}
            />
          </SettingsField>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || unsupported("skills/extraRoots/set")}
            onClick={() =>
              void store.setRoots(
                roots
                  .split("\n")
                  .map((root) => root.trim())
                  .filter(Boolean),
              )
            }
          >
            {t("应用额外目录")}
          </Button>
        </div>,
      )}
      {panel(
        "hooks",
        t("Hooks（只读）"),
        <div className="space-y-2">
          {state.hooks.data?.data.map((entry) => (
            <div key={entry.cwd}>
              <p>{entry.cwd}</p>
              {entry.warnings.map((warning, index) => (
                <p key={index} className="text-muted">
                  {warning}
                </p>
              ))}
              {entry.errors.map((error) => (
                <p key={error.path} className="text-danger">
                  {error.path}: {error.message}
                </p>
              ))}
              {entry.hooks.map((hook) => (
                <p key={hook.key}>
                  {hook.eventName} · {hook.handlerType} ·{" "}
                  {hook.enabled ? t("已启用") : t("已停用")} ·{" "}
                  {hook.trustStatus} · {hook.sourcePath}
                </p>
              ))}
            </div>
          ))}
        </div>,
      )}
      {panel(
        "installed",
        t("已安装应用"),
        <div className="space-y-1">
          {state.installed.data?.apps.map((app) => (
            <p key={app.id}>
              {app.runtimeName ?? app.id} ·{" "}
              {app.enabled ? t("已启用") : t("已停用")} ·{" "}
              {app.callable ? t("可调用") : t("当前不可调用")}
            </p>
          ))}
        </div>,
      )}
      {panel(
        "apps",
        t("可用应用"),
        <div className="space-y-2">
          {state.apps.data?.data.map((app) => (
            <div key={app.id} className="space-y-1">
              <p>
                {app.name} · {app.isEnabled ? t("已启用") : t("已停用")}
              </p>
              <p className="text-muted">{app.description}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={state.app.busy || unsupported("app/read")}
                  onClick={() => void store.load("app", false, app.id)}
                >
                  {t("查看工具")}
                </Button>
                {onInsertApp && (
                  <Button
                    size="sm"
                    disabled={!app.isAccessible || !app.isEnabled}
                    onClick={() => onInsertApp({ id: app.id, name: app.name })}
                  >
                    {t("插入应用提及")}
                  </Button>
                )}
              </div>
            </div>
          ))}
          {state.apps.data?.nextCursor && (
            <Button
              size="sm"
              disabled={state.apps.busy || unsupported("app/list")}
              onClick={() => void store.load("apps", true)}
            >
              {t("更多应用")}
            </Button>
          )}
          {state.app.error && <ErrorNotice>{state.app.error}</ErrorNotice>}
          {state.app.data?.missingAppIds.map((id) => (
            <p key={id}>
              {t("应用不可用：")}
              {id}
            </p>
          ))}
          {state.app.data?.apps.map((app) => (
            <div key={app.id}>
              <p>{app.name}</p>
              <p>{app.description}</p>
              {app.toolSummaries?.map((tool, index) => (
                <p key={index}>{tool.name}</p>
              ))}
            </div>
          ))}
        </div>,
      )}
    </div>
  );
}
