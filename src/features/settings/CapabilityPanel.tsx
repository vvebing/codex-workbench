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
    title: "项目命令与 Git 执行",
    methods: ["command/exec", "command/exec/write", "command/exec/terminate"],
  },
  {
    title: "环境配置",
    methods: ["config/read", "config/value/write", "configRequirements/read"],
  },
  {
    title: "MCP 服务",
    methods: [
      "mcpServerStatus/list",
      "mcpServer/oauth/login",
      "config/mcpServer/reload",
    ],
  },
  {
    title: "技能与 Hooks",
    methods: [
      "skills/list",
      "skills/config/write",
      "skills/extraRoots/set",
      "hooks/list",
    ],
  },
  { title: "应用", methods: ["app/list", "app/installed", "app/read"] },
  {
    title: "会话目标",
    methods: ["thread/goal/get", "thread/goal/set", "thread/goal/clear"],
  },
  {
    title: "参考资料与审查",
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
  const session = useStore(connection);
  const evidence = useCapabilities(connection);
  const known = new Set(capabilityGroups.flatMap((group) => group.methods));
  const observed = (Object.keys(evidence) as RpcMethod[]).filter(
    (method) => !known.has(method),
  );
  const groups = observed.length
    ? [...capabilityGroups, { title: "其他已调用接口", methods: observed }]
    : capabilityGroups;
  return (
    <SettingsSection
      title="服务端功能支持"
      description="依据当前连接的真实接口调用记录；尚未调用表示未知，不按版本猜测支持情况。清除记录后可回到对应功能重新操作，不会自动执行写入。"
    >
      <p className="text-xs text-muted">
        服务器版本：{session.serverVersion ?? "未知"}
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
                        : "未知（尚无调用记录）"}
                    </p>
                    {entry && (
                      <>
                        <p className="text-muted">
                          更新于{" "}
                          <time
                            dateTime={new Date(entry.checkedAt).toISOString()}
                          >
                            {new Date(entry.checkedAt).toLocaleString()}
                          </time>
                          {entry.code !== undefined
                            ? ` · 错误码 ${entry.code}`
                            : ""}
                        </p>
                        <Button
                          aria-label={`清除记录以重新验证 ${method}`}
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            connection.client.capabilities?.forget(method)
                          }
                        >
                          清除记录以重新验证
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
