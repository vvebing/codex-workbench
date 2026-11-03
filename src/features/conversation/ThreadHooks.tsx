import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Thread } from "../../generated/v2/Thread";
import type { HookRunStatus } from "../../generated/v2/HookRunStatus";
import { Button, ErrorNotice } from "../../components/ui";
import { useStore } from "../../components/hooks";
import { t } from "../../lib/i18n";
import { useRuntime } from "../../lib/runtime-context";
import { hookEventLabel, ThreadHooksStore } from "./thread-hooks-store";

const runLabel = (status: HookRunStatus): string =>
  ({
    running: t("执行中"),
    completed: t("已完成"),
    failed: t("失败"),
    blocked: t("受阻"),
    stopped: t("已停止"),
  })[status] ?? status;

export function ThreadHooks({ thread }: { thread: Thread }) {
  useTranslation();
  const { connection, sessions } = useRuntime();
  const { epoch, status } = useStore(connection);
  const sessionState = useStore(sessions);
  const [open, setOpen] = useState(false);
  const loaded =
    thread.status.type !== "notLoaded" &&
    !sessionState.localDrafts[thread.id] &&
    !sessionState.archivedIds[thread.id];
  const store = useMemo(
    () => new ThreadHooksStore(thread.id, epoch, connection),
    [thread.id, epoch, connection],
  );
  const state = useStore(store);
  useEffect(() => {
    if (!open || !loaded || status !== "connected") return;
    const stop = store.start();
    void store.load();
    return stop;
  }, [open, loaded, status, store]);
  const hooks = state.data?.data.flatMap((entry) => entry.hooks) ?? [];
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer font-semibold">
        {t("当前会话 Hooks")}
      </summary>
      <div className="mt-3 min-w-0 space-y-3 text-caption [overflow-wrap:anywhere]">
        <p className="text-muted">
          {t("查看当前会话及其所选执行环境的 Hooks；此处只读。")}
        </p>
        {!loaded ? (
          <p role="status" className="text-muted">
            {t("请先发送消息或恢复会话，再查看当前会话的 Hooks。")}
          </p>
        ) : status !== "connected" ? (
          <p role="status" className="text-muted">
            {t("连接环境后查看会话 Hooks。")}
          </p>
        ) : (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={state.loading}
              onClick={() => void store.load()}
            >
              {state.loading ? t("正在读取 Hooks…") : t("刷新 Hooks")}
            </Button>
            {state.error && <ErrorNotice>{state.error}</ErrorNotice>}
            {state.data && !hooks.length && (
              <p className="text-muted">{t("当前会话没有可用的 Hooks。")}</p>
            )}
            {state.data?.data.map((entry) => (
              <div key={entry.cwd} className="min-w-0 space-y-2">
                <p className="text-muted">{entry.cwd}</p>
                {entry.warnings.map((warning, index) => (
                  <p key={index} className="text-warning">
                    {warning}
                  </p>
                ))}
                {entry.errors.map((error) => (
                  <p key={error.path} className="text-danger">
                    {error.path}: {error.message}
                  </p>
                ))}
                <ul className="divide-y divide-border">
                  {entry.hooks.map((hook) => (
                    <li key={hook.key} className="min-w-0 space-y-1 py-2">
                      <p>
                        {hookEventLabel(hook.eventName)} · {hook.handlerType} ·{" "}
                        {hook.enabled ? t("已启用") : t("已停用")}
                      </p>
                      {hook.environmentId && (
                        <p className="text-muted">
                          {t("执行环境：{{value0}}", {
                            value0: hook.environmentId,
                          })}
                        </p>
                      )}
                      <p className="text-muted">{hook.sourcePath}</p>
                      {hook.statusMessage && <p>{hook.statusMessage}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {state.runs.length > 0 && (
              <section className="space-y-2 border-t border-border pt-3">
                <h4 className="font-medium">{t("近期 Hooks 执行")}</h4>
                <p className="text-muted">
                  {t("仅记录此面板打开期间收到的执行事件。")}
                </p>
                <ul className="divide-y divide-border">
                  {state.runs.map((run) => (
                    <li key={run.id} className="space-y-1 py-2">
                      <p
                        className={
                          ["failed", "blocked"].includes(run.status)
                            ? "text-danger"
                            : ""
                        }
                      >
                        {hookEventLabel(run.eventName)} · {runLabel(run.status)}
                        {run.durationMs != null && (
                          <span className="tabular-nums">
                            {" "}
                            ·{" "}
                            {t("{{value0}} 秒", {
                              value0: (Number(run.durationMs) / 1000).toFixed(
                                1,
                              ),
                            })}
                          </span>
                        )}
                      </p>
                      {run.statusMessage && <p>{run.statusMessage}</p>}
                      <p className="text-muted">{run.sourcePath}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </details>
  );
}
