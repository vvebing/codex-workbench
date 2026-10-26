import { t, useLocale } from "../../lib/i18n";
import { useState } from "react";
import { useStore, titleOf } from "../../components/hooks";
import { Modal, ScrollArea, ErrorNotice, Button } from "../../components/ui";
import { environments, type Environment } from "../connection/environments";
import { isSubagentThread } from "../sessions/state";
import {
  environmentTasks,
  environmentTaskSummary,
  taskCategoryDescriptions,
  type TaskCategory,
} from "./model";

function EnvironmentTasks({
  environment,
  onLocated,
  onInspectAgent,
}: {
  environment: Environment;
  onLocated: () => void;
  onInspectAgent: (environmentId: string, threadId: string) => void;
}) {
  const i18nLocale = useLocale();
  void i18nLocale;

  const { runtime } = environment;
  useStore(runtime.sessions);
  useStore(runtime.requests);
  useStore(runtime.queue);
  useStore(runtime.questionDismissals);
  useStore(runtime.submissions.messages);
  const connection = useStore(runtime.connection);
  const [error, setError] = useState("");
  const entries = environmentTasks(runtime);
  const summary = environmentTaskSummary(runtime, entries);
  const [connecting, setConnecting] = useState(false);
  const categories: TaskCategory[] = [
    "待审批",
    "待回答",
    "失败或待核实",
    "暂停队列",
    "待查看结果",
  ];
  return (
    <section
      className="mb-5"
      aria-label={t("{{value0}}待办", { value0: environment.name })}
    >
      <div className="mb-2 flex items-center gap-3">
        <h3 className="min-w-0 flex-1 text-sm font-medium">
          {environment.name} · {summary.label}
        </h3>
        {summary.state === "offline" && (
          <Button
            variant="secondary"
            size="sm"
            disabled={connecting || connection.status === "connecting"}
            onClick={() => {
              setConnecting(true);
              setError("");
              void runtime
                .reconnect()
                .catch((error) =>
                  setError(
                    error instanceof Error ? error.message : String(error),
                  ),
                )
                .finally(() => setConnecting(false));
            }}
          >
            {connecting || connection.status === "connecting"
              ? t("连接中…")
              : t("连接环境")}
          </Button>
        )}
      </div>
      <p className="mb-3 text-xs text-muted">{summary.description}</p>
      {error && (
        <ErrorNotice onDismiss={() => setError("")}>{error}</ErrorNotice>
      )}
      {categories.map((category) => {
        const tasks = entries.filter((entry) => entry.category === category);
        return tasks.length ? (
          <div key={category} className="mb-3">
            <h4 className="mb-1 text-xs text-muted">
              {t(category)} · {tasks.length}
            </h4>
            <p className="mb-2 text-fine text-muted">
              {taskCategoryDescriptions[category]}
            </p>
            {tasks.map((entry) => (
              <button
                key={entry.id}
                type="button"
                disabled={!entry.threadId}
                className="mb-1 block w-full rounded-lg border border-border px-3 py-2 text-left hover:bg-hover disabled:opacity-60"
                onClick={() => {
                  environments.select(environment.id);
                  setError("");
                  void (async () => {
                    const id = entry.threadId!;
                    if (
                      !runtime.sessions.getSnapshot().threads[id] &&
                      connection.status === "connected"
                    )
                      await runtime.sessions.ensureNotificationMetadata(id);
                    const sessions = runtime.sessions.getSnapshot();
                    if (
                      sessions.subagentThreadIds[id] ||
                      isSubagentThread(sessions.threads[id])
                    )
                      onInspectAgent(environment.id, id);
                    else await runtime.sessions.open(id);
                    onLocated();
                  })().catch((error) =>
                    setError(
                      error instanceof Error ? error.message : String(error),
                    ),
                  );
                }}
              >
                <strong className="block text-xs">{entry.title}</strong>
                <span className="mt-1 block text-xs text-muted">
                  {entry.threadId
                    ? titleOf(
                        runtime.sessions.getSnapshot().threads[entry.threadId],
                      )
                    : t("请求未提供会话，无法定位")}
                </span>
                {entry.detail && (
                  <span className="mt-1 block whitespace-pre-wrap text-xs text-muted">
                    {entry.detail}
                  </span>
                )}
                <span className="mt-1 block text-meta text-muted">
                  {entry.threadId
                    ? t("前往会话处理")
                    : t("请在来源服务检查此请求")}
                </span>
              </button>
            ))}
          </div>
        ) : null;
      })}
    </section>
  );
}
export function TaskCenter({
  open,
  onOpenChange,
  onInspectAgent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInspectAgent: (environmentId: string, threadId: string) => void;
}) {
  const i18nLocale = useLocale();
  void i18nLocale;

  const state = useStore(environments);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("待办中心")}
      description={t(
        "查看各环境中需要你处理的事项，并前往来源会话继续。未连接环境会明确标记为待同步。",
      )}
    >
      <ScrollArea className="max-h-[65vh]">
        <p className="mb-4 text-xs text-muted">
          {t(
            "排队由当前浏览器调度；关闭页面后不会发送。发送结果不确定时，请先核对记录。",
          )}
        </p>
        {state.entries.map((environment) => (
          <EnvironmentTasks
            key={environment.id}
            environment={environment}
            onLocated={() => onOpenChange(false)}
            onInspectAgent={onInspectAgent}
          />
        ))}
      </ScrollArea>
    </Modal>
  );
}
