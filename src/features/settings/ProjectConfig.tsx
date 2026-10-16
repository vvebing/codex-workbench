import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui";
import { useStore } from "../../components/hooks";
import type { ConnectionStore } from "../connection/store";
import { absolutePath } from "../shell/workspace-path";
import { EnvironmentToolsStore } from "./environment-tools-store";
import {
  SettingsField,
  SettingsSection,
  settingsInputClass,
} from "./settings-ui";

export function ProjectConfig({
  connection,
  sessionCwd,
}: {
  connection: ConnectionStore;
  sessionCwd?: string;
}) {
  const session = useStore(connection);
  const [directory, setDirectory] = useState("");
  const cwd = directory.trim();
  const valid = absolutePath(cwd);
  const store = useMemo(
    () => new EnvironmentToolsStore(connection, cwd, session.epoch),
    [connection, cwd, session.epoch],
  );
  useEffect(() => store.start(), [store]);
  const { config } = useStore(store);
  return (
    <SettingsSection
      title="查看项目生效配置"
      description="只读查看指定目录下合并后的配置，不代表当前会话的全部运行参数。修改查询目录不会切换会话或更改其工作目录。"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && session.status === "connected")
            void store.load("config");
        }}
      >
        <SettingsField
          id="project-config-directory"
          label="查询目录"
          description="填写所选设备上的绝对路径。读取前不会查询，修改目录后需重新读取。"
        >
          <input
            id="project-config-directory"
            className={settingsInputClass}
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
            placeholder="项目目录的绝对路径"
            aria-describedby="project-config-directory-description"
            aria-invalid={!!cwd && !valid}
          />
        </SettingsField>
        <div className="flex flex-wrap gap-2">
          {sessionCwd && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setDirectory(sessionCwd)}
            >
              使用所选会话目录
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={!valid || config.busy || session.status !== "connected"}
          >
            {config.busy ? "读取中…" : config.data ? "刷新" : "读取配置"}
          </Button>
        </div>
        {cwd && !valid && (
          <p className="text-xs text-danger">请输入绝对路径。</p>
        )}
      </form>
      {!config.data && !config.busy && !config.error && (
        <p className="text-xs text-muted">尚未读取配置。</p>
      )}
      {config.error && (
        <p role="alert" className="text-xs text-danger">
          {config.error}
        </p>
      )}
      {config.data && (
        <div className="space-y-2 rounded-lg border border-border p-3 text-xs">
          <p className="break-words">查询目录：{cwd}</p>
          <p>
            模型：{config.data.config.model ?? "未指定"} · 提供方：
            {config.data.config.model_provider ?? "未指定"}
          </p>
          <p>
            审批：
            {typeof config.data.config.approval_policy === "string"
              ? config.data.config.approval_policy
              : "自定义 / 未指定"}{" "}
            · 沙箱：{config.data.config.sandbox_mode ?? "未指定"}
          </p>
          <p className="text-muted">
            这是上次读取的结果。保存设备默认设置后，请刷新以查看该目录下的生效结果。
          </p>
        </div>
      )}
    </SettingsSection>
  );
}
