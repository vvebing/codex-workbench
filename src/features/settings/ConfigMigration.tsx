import { useEffect, useMemo, useState } from "react";
import { useStore } from "../../components/hooks";
import { Button } from "../../components/ui";
import type { ConnectionStore } from "../connection/store";
import { ConfigMigrationStore } from "./config-migration-store";
import { SettingsSection } from "./settings-ui";

export function ConfigMigration({
  connection,
  cwd,
}: {
  connection: ConnectionStore;
  cwd?: string;
}) {
  const session = useStore(connection);
  const store = useMemo(
    () => new ConfigMigrationStore(connection, cwd, session.epoch),
    [connection, cwd, session.epoch],
  );
  const state = useStore(store);
  const [includeHome, setIncludeHome] = useState(false);
  useEffect(() => store.start(), [store]);
  const disconnected = session.status !== "connected";
  return (
    <div className="space-y-6 text-xs">
      <SettingsSection
        title="外部配置迁移"
        description="先探测可迁移内容，再明确选择导入项。导入会修改当前环境的配置或文件。"
      >
        <p className="break-all text-muted">
          项目目录：{cwd ?? "未选择（仅在开启下方选项后探测用户目录）"}
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeHome}
            disabled={state.detecting || state.importing}
            onChange={(event) => setIncludeHome(event.target.checked)}
          />
          包含用户主目录
        </label>
        <Button
          size="sm"
          variant="secondary"
          disabled={
            disconnected ||
            state.detecting ||
            state.importing ||
            (!cwd && !includeHome)
          }
          onClick={() => void store.detect(includeHome)}
        >
          {state.detecting ? "正在探测…" : "探测可迁移内容"}
        </Button>
        {state.detectError && (
          <p role="alert" className="text-danger">
            {state.detectError}
          </p>
        )}
        {state.detected && (
          <div className="space-y-3">
            {!state.detected.items.length && <p>未发现可迁移内容。</p>}
            {state.detected.items.map((item, index) => (
              <label
                key={index}
                className="flex items-start gap-2 rounded-lg border border-border p-3"
              >
                <input
                  type="checkbox"
                  disabled={state.importing}
                  checked={state.selected.includes(index)}
                  onChange={(event) =>
                    store.select(index, event.target.checked)
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block">
                    {item.itemType} · {item.cwd || "用户主目录"}
                  </span>
                  <span className="block text-muted">{item.description}</span>
                </span>
              </label>
            ))}
            {state.detected.connectors.map((connector, index) => (
              <p key={index} className="text-muted">
                发现连接器：{connector.name} · {connector.sessionCount}{" "}
                个会话（仅显示探测结果）
              </p>
            ))}
            <Button
              size="sm"
              disabled={
                disconnected || state.importing || !state.selected.length
              }
              onClick={() => void store.importSelected()}
            >
              导入所选 {state.selected.length} 项
            </Button>
          </div>
        )}
        {state.importError && (
          <p role="alert" className="text-danger">
            {state.importError}
          </p>
        )}
        {(state.importing || state.completed) && (
          <div role="status" className="space-y-2">
            <p>
              {state.completed ? "导入已完成" : "正在导入…"}
              {state.importId && ` · ${state.importId}`}
            </p>
            {state.results.map((result) => (
              <div key={result.itemType}>
                <p>
                  {result.itemType}：成功 {result.successes.length}，失败{" "}
                  {result.failures.length}
                </p>
                {result.failures.map((failure, index) => (
                  <p key={index} className="text-danger">
                    {failure.cwd ?? "用户目录"} · {failure.failureStage}:{" "}
                    {failure.message}
                  </p>
                ))}
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
      <SettingsSection
        title="迁移历史"
        trailing={
          <Button
            size="sm"
            variant="secondary"
            disabled={disconnected || state.historyLoading}
            onClick={() => void store.readHistories()}
          >
            {state.historyLoading ? "加载中…" : "刷新历史"}
          </Button>
        }
      >
        {state.historyError && (
          <p role="alert" className="text-danger">
            {state.historyError}
          </p>
        )}
        {state.histories && !state.histories.data.length && (
          <p>暂无迁移历史。</p>
        )}
        {state.histories?.data.map((history) => (
          <div
            key={history.importId}
            className="space-y-1 rounded-lg border border-border p-3"
          >
            <p>
              {history.providerId ?? "外部配置"} ·{" "}
              {new Date(Number(history.completedAtMs)).toLocaleString()}
            </p>
            <p>
              {history.importId} · 成功 {history.successes.length}，失败{" "}
              {history.failures.length}
            </p>
            {history.failures.map((failure, index) => (
              <p key={index} className="text-danger">
                {failure.itemType}: {failure.message}
              </p>
            ))}
          </div>
        ))}
      </SettingsSection>
    </div>
  );
}
