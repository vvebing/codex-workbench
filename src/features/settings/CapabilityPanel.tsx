import { t, useLocale, getLocale } from "../../lib/i18n";
import { useStore } from "../../components/hooks";
import { Button } from "../../components/ui";
import { CapabilityStore, capabilityLabels } from "../../lib/capabilities";
import type { RpcMethod } from "../../lib/rpc";
import type { ConnectionStore } from "../connection/store";
import { SettingsSection } from "./settings-ui";

const unknownCapabilities = new CapabilityStore();
export function useCapabilities(connection: ConnectionStore) {
  const store = connection.client.capabilities ?? unknownCapabilities;
  return useStore(store);
}
export const capabilityGroups: { title: string; methods: RpcMethod[] }[] = [
  {
    get title() {
      return t("项目命令与 Git 执行");
    },
    methods: ["command/exec", "command/exec/write", "command/exec/terminate"],
  },
  {
    get title() {
      return t("环境配置");
    },
    methods: ["config/read", "config/value/write", "configRequirements/read"],
  },
  {
    get title() {
      return t("MCP 服务");
    },
    methods: [
      "mcpServerStatus/list",
      "mcpServer/oauth/login",
      "config/mcpServer/reload",
    ],
  },
  {
    get title() {
      return t("技能与 Hooks");
    },
    methods: [
      "skills/list",
      "skills/config/write",
      "skills/extraRoots/set",
      "hooks/list",
    ],
  },
  {
    get title() {
      return t("应用");
    },
    methods: ["app/list", "app/installed", "app/read"],
  },
  {
    get title() {
      return t("会话目标");
    },
    methods: ["thread/goal/get", "thread/goal/set", "thread/goal/clear"],
  },
  {
    get title() {
      return t("参考资料与审查");
    },
    methods: [
      "thread/attachment/list",
      "thread/attachment/add",
      "thread/attachment/remove",
      "thread/attachmentOwner/list",
      "review/start",
    ],
  },
];
export function CapabilityPanel({
  connection,
}: {
  connection: ConnectionStore;
}) {
  useLocale();
  const session = useStore(connection);
  const evidence = useCapabilities(connection);
  const known = new Set(capabilityGroups.flatMap((group) => group.methods));
  const observed = (Object.keys(evidence) as RpcMethod[]).filter(
    (method) => !known.has(method),
  );
  const groups = observed.length
    ? [...capabilityGroups, { title: t("其他已调用接口"), methods: observed }]
    : capabilityGroups;
  return (
    <SettingsSection
      title={t("服务端功能支持")}
      description={t(
        "依据当前连接的真实接口调用记录；尚未调用表示未知，不按版本猜测支持情况。清除记录后可回到对应功能重新操作，不会自动执行写入。",
      )}
    >
      <p className="text-xs text-muted">
        {t("服务器版本：")}
        {session.serverVersion ?? t("未知")}
      </p>
      <div className="space-y-3">
        {groups.map((group) => (
          <details
            key={group.title}
            className="rounded-lg border border-border bg-elevated p-3"
          >
            <summary className="cursor-pointer text-sm font-medium">
              {group.title}
            </summary>
            <div className="mt-2 space-y-2">
              {group.methods.map((method) => {
                const entry = evidence[method];
                return (
                  <div
                    key={method}
                    className="space-y-2 rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed [overflow-wrap:anywhere]"
                  >
                    <p>
                      <code>{method}</code> ·{" "}
                      {entry
                        ? capabilityLabels[entry.state]
                        : t("未知（尚无调用记录）")}
                    </p>
                    {entry && (
                      <>
                        <p className="text-muted">
                          {t("更新于")}{" "}
                          <time
                            dateTime={new Date(entry.checkedAt).toISOString()}
                          >
                            {new Date(entry.checkedAt).toLocaleString(
                              getLocale(),
                            )}
                          </time>
                          {entry.code !== undefined
                            ? t(" · 错误码 {{v0}}", { v0: entry.code })
                            : ""}
                        </p>
                        <Button
                          aria-label={t("清除记录以重新验证 {{v0}}", {
                            v0: method,
                          })}
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            connection.client.capabilities?.forget(method)
                          }
                        >
                          {t("清除记录以重新验证")}
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        ))}
      </div>
    </SettingsSection>
  );
}
