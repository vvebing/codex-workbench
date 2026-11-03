import { useEffect, useMemo, useState } from "react";
import { t, useLocale, getLocale } from "../../lib/i18n";
import { useStore } from "../../components/hooks";
import { Button, ErrorNotice } from "../../components/ui";
import { useRuntime } from "../../lib/runtime-context";
import type { Thread } from "../../generated/v2/Thread";
import { useCapabilities } from "../settings/CapabilityPanel";
import { settingsInputClass } from "../settings/settings-ui";
import { saveDownload } from "../files/file-transfer";
import { threadInsightsFor } from "./thread-insights-store";
import { formatUsageCount, formatUsageMicros } from "./usage-format";

function suggestedPath(cwd: string) {
  const separator = cwd.includes("\\") ? "\\" : "/";
  return `${cwd.replace(/[\\/]$/, "")}${separator}codex-diagnostics-${crypto.randomUUID()}.zip`;
}

export function ThreadInsights({ thread }: { thread: Thread }) {
  useLocale();
  const { connection, sessions } = useRuntime();
  const state = useStore(connection);
  const session = useStore(sessions);
  const capabilities = useCapabilities(connection);
  const store = useMemo(
    () => threadInsightsFor(connection, thread.id, state.scope),
    [connection, state.scope, thread.id],
  );
  const insights = useStore(store);
  useEffect(() => store.start(), [store]);
  const [path, setPath] = useState(
    () => store.getSnapshot().attemptedPath ?? suggestedPath(thread.cwd),
  );
  const [logs, setLogs] = useState(false);
  const [reason, setReason] = useState("");
  const disabled =
    state.status !== "connected" ||
    !!session.localDrafts[thread.id] ||
    thread.ephemeral;
  const usageUnsupported =
    capabilities["account/usage/read"]?.state === "unsupported";
  const saveUnsupported =
    capabilities["feedback/save"]?.state === "unsupported";
  const downloadUnsupported =
    capabilities["fs/readFile"]?.state === "unsupported";
  const usage = insights.usage;
  return (
    <>
      <details>
        <summary className="cursor-pointer font-semibold">
          {t("会话用量与费用")}
        </summary>
        <div className="mt-3 space-y-3 [overflow-wrap:anywhere]">
          <p className="text-xs text-muted">
            {t(
              "按会话读取用量；原生美元用量、估算金额和积分分别展示，不相加，也不代表最终账单。",
            )}
          </p>
          {usageUnsupported && (
            <p role="status" className="text-xs text-muted">
              {t("当前服务端不支持会话用量查询。")}
            </p>
          )}
          {insights.usageError && (
            <ErrorNotice>{insights.usageError}</ErrorNotice>
          )}
          {insights.usageLoaded && !usage && (
            <p role="status" className="text-xs text-muted">
              {t("当前会话暂无可用的费用数据。")}
            </p>
          )}
          {usage && (
            <>
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-xs tabular-nums">
                <dt>{t("原生美元用量")}</dt>
                <dd>{formatUsageMicros(usage.nativeUsageUsdMicros, true)}</dd>
                <dt>{t("估算美元用量")}</dt>
                <dd>
                  {formatUsageMicros(usage.estimatedUsageUsdMicros, true)}
                </dd>
                <dt>{t("估算积分")}</dt>
                <dd>{formatUsageMicros(usage.estimatedUsageCreditsMicros)}</dd>
              </dl>
              {!!usage.groups.length && (
                <div className="divide-y divide-border">
                  {usage.groups.map((group, index) => (
                    <div className="space-y-1 py-2 text-xs" key={index}>
                      <p>
                        {[
                          group.model ?? t("未知模型"),
                          group.reasoningEffort,
                          group.speed,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <p className="text-muted tabular-nums">
                        {t(
                          "输入 {{input}} · 缓存 {{cached}} · 输出 {{output}} Token",
                          {
                            input: formatUsageCount(group.inputTokens),
                            cached: formatUsageCount(group.cachedInputTokens),
                            output: formatUsageCount(group.outputTokens),
                          },
                        )}
                      </p>
                      <p className="text-muted tabular-nums">
                        {t("估算积分：{{value}}", {
                          value: formatUsageMicros(
                            group.estimatedUsageCreditsMicros,
                          ),
                        })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {insights.usageUpdatedAt != null && (
            <p className="text-xs text-muted">
              {t("更新于")}{" "}
              {new Date(insights.usageUpdatedAt).toLocaleString(getLocale())}
            </p>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || insights.usageBusy || usageUnsupported}
            onClick={() => void store.loadUsage()}
          >
            {insights.usageBusy ? t("加载中…") : t("刷新会话用量")}
          </Button>
        </div>
      </details>
      <details>
        <summary className="cursor-pointer font-semibold">
          {t("本地诊断包")}
        </summary>
        <form
          className="mt-3 space-y-3 [overflow-wrap:anywhere]"
          onSubmit={(event) => {
            event.preventDefault();
            void store.save(path, logs, reason);
          }}
        >
          <p className="text-xs text-muted">
            {t(
              "将当前会话的诊断 ZIP 保存到所连接环境的主机，不会上传反馈。诊断内容可能含会话与项目资料，请检查后再分享。",
            )}
          </p>
          <label className="block text-control font-medium">
            {t("环境主机上的 ZIP 路径")}
            <input
              className={`${settingsInputClass} mt-1`}
              value={path}
              disabled={insights.saveBusy}
              required
              onChange={(event) => setPath(event.target.value)}
            />
          </label>
          <label className="block text-control font-medium">
            {t("问题说明（可选）")}
            <textarea
              className={`${settingsInputClass} mt-1`}
              value={reason}
              disabled={insights.saveBusy}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label className="flex items-start gap-2 text-xs leading-copy">
            <input
              type="checkbox"
              className="mt-1 accent-action"
              checked={logs}
              disabled={insights.saveBusy}
              onChange={(event) => setLogs(event.target.checked)}
            />
            {t("包含运行日志（可能含敏感信息）")}
          </label>
          {saveUnsupported && (
            <p role="status" className="text-xs text-muted">
              {t("当前服务端不支持保存本地诊断包。")}
            </p>
          )}
          {insights.saveError && (
            <ErrorNotice>{insights.saveError}</ErrorNotice>
          )}
          {insights.uncertain && (
            <p role="status" className="text-xs text-warning">
              {t(
                "导出结果待核实，文件可能已经生成。请先尝试取回原路径文件；再次导出请使用新路径。",
              )}
            </p>
          )}
          {(insights.savedPath || insights.attemptedPath) && (
            <p className="text-xs text-muted">
              {t("诊断文件路径：{{path}}", {
                path: insights.savedPath ?? insights.attemptedPath,
              })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={
                disabled ||
                insights.saveBusy ||
                insights.downloadBusy ||
                saveUnsupported ||
                !path.trim()
              }
            >
              {insights.saveBusy ? t("正在导出…") : t("导出到环境主机")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={insights.saveBusy}
              onClick={() => setPath(suggestedPath(thread.cwd))}
            >
              {t("使用新路径")}
            </Button>
            {(insights.savedPath || insights.uncertain) && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={
                  disabled ||
                  insights.saveBusy ||
                  insights.downloadBusy ||
                  downloadUnsupported
                }
                onClick={() =>
                  void store.download().then((file) => {
                    if (file) saveDownload(file.dataBase64, file.name);
                  })
                }
              >
                {insights.downloadBusy ? t("正在下载…") : t("取回诊断包")}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted">
            {t(
              "网页下载最多支持 8 MB；更大的文件请从环境主机取回。导出后文件会保留在主机上。",
            )}
          </p>
          {insights.downloadError && (
            <ErrorNotice>{insights.downloadError}</ErrorNotice>
          )}
        </form>
      </details>
    </>
  );
}
