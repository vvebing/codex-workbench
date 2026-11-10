import { t, useLocale } from "../../lib/i18n";
import { useState, useSyncExternalStore } from "react";
import { Popover } from "radix-ui";
import {
  CircleCheck,
  CircleHelp,
  CirclePause,
  CircleX,
  Info,
  LoaderCircle,
  SendHorizontal,
  Square,
} from "lucide-react";
import { Button, IconButton, ScrollArea } from "../../components/ui";
import type { ProjectRun, ProjectsStore } from "./store";
import "./project-task-output.css";

function runStatus(run: ProjectRun) {
  const label = {
    running: t("进行中"),
    stopping: t("等待停止确认"),
    exited: t("已退出"),
    unknown: t("状态未知"),
    unsupported: t("版本不支持"),
  }[run.status];
  const Icon =
    run.status === "running"
      ? LoaderCircle
      : run.status === "stopping"
        ? CirclePause
        : run.status === "unknown"
          ? CircleHelp
          : run.status === "unsupported" || (run.exitCode ?? 0) !== 0
            ? CircleX
            : CircleCheck;
  return { label, Icon };
}

/** Explicit project commands share the terminal dock without impersonating a shell. */
export function ProjectTaskOutput({
  store,
  connected,
  cwd,
  readOnly = false,
}: {
  store: ProjectsStore;
  connected: boolean;
  cwd: string;
  readOnly?: boolean;
}) {
  useLocale();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [stdin, setStdin] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<{ newest: string; id: string }>();
  const visibleRuns = state.runs.filter((run) => run.cwd === cwd);
  const newest = visibleRuns.at(-1);
  const run =
    (selection?.newest === newest?.id
      ? visibleRuns.find((entry) => entry.id === selection?.id)
      : undefined) ?? newest;
  if (!run)
    return (
      <div className="project-task-empty">
        {t(
          "尚无项目命令。在工作区运行测试、构建或开发命令后，可在此查看输出。",
        )}
      </div>
    );
  const { label, Icon: StatusIcon } = runStatus(run);
  const statusText =
    run.exitCode === undefined
      ? label
      : t("退出码 {{value0}}", { value0: run.exitCode });
  const running = run.status === "running";
  return (
    <article
      className="project-task-output"
      data-slot="project-task-output"
      aria-label={t("命令运行记录")}
    >
      <div className="project-task-toolbar">
        {visibleRuns.length > 1 ? (
          <select
            className="project-task-command project-task-history"
            aria-label={t("选择运行记录")}
            title={run.command}
            value={run.id}
            onChange={(event) =>
              setSelection({ newest: newest!.id, id: event.target.value })
            }
          >
            {visibleRuns.map((entry, index) => (
              <option key={entry.id} value={entry.id}>
                {index + 1} · {entry.command}
              </option>
            ))}
          </select>
        ) : (
          <code className="project-task-command" title={run.command}>
            {run.command}
          </code>
        )}
        <span
          className="project-task-status"
          data-status={run.status}
          data-failed={
            (run.exitCode !== undefined && run.exitCode !== 0) || undefined
          }
          title={`${label}${run.exitCode === undefined ? "" : ` · ${statusText}`}`}
          role="status"
        >
          <StatusIcon size={13} aria-hidden="true" />
          <span>{statusText}</span>
        </span>
        {running && !readOnly && (
          <IconButton
            size="sm"
            label={t("停止")}
            disabled={!connected}
            onClick={() => void store.stop(run.id)}
          >
            <Square size={13} aria-hidden="true" />
          </IconButton>
        )}
        <Popover.Root key={run.id}>
          <Popover.Trigger asChild>
            <IconButton size="sm" label={t("命令详情")}>
              <Info size={14} aria-hidden="true" />
            </IconButton>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="top"
              align="end"
              sideOffset={6}
              className="project-task-details"
              aria-label={t("命令详情")}
            >
              <strong>{t("命令详情")}</strong>
              <code className="project-task-full-command">{run.command}</code>
              <dl>
                <dt>{t("项目目录")}</dt>
                <dd>
                  <code>{run.cwd}</code>
                </dd>
                <dt>{t("进程：")}</dt>
                <dd>
                  <code>{run.id}</code>
                </dd>
              </dl>
              <p>
                {t(
                  "断线或请求超时表示状态未知。开发命令最长运行 24 小时，其他命令最长 10 分钟。",
                )}
              </p>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      {(run.error || run.status === "unknown" || run.truncated) && (
        <div className="project-task-notices">
          {run.error && (
            <p role="alert" className="project-task-error">
              {run.error}
            </p>
          )}
          {run.status === "unknown" && !readOnly && (
            <Button
              size="sm"
              variant="quiet"
              onClick={() => store.acknowledgeUnknown(run.id)}
            >
              {t("已在外部核实进程，解除运行锁")}
            </Button>
          )}
          {run.truncated && <p>{t("输出已截断，仅保留最近内容。")}</p>}
        </div>
      )}
      <ScrollArea
        className="project-task-scroll"
        data-slot="project-task-log"
        key={run.id}
      >
        <pre className="project-task-log" aria-label={t("命令输出")}>
          {run.output || t("暂无输出")}
        </pre>
      </ScrollArea>
      {!readOnly && running && (
        <form
          className="project-task-stdin"
          onSubmit={(event) => {
            event.preventDefault();
            if (!connected) return;
            void store.write(run.id, `${stdin[run.id] ?? ""}\n`);
            setStdin((drafts) => ({ ...drafts, [run.id]: "" }));
          }}
        >
          <input
            aria-label={t("命令标准输入")}
            placeholder={t("命令标准输入")}
            value={stdin[run.id] ?? ""}
            disabled={!connected}
            onChange={(event) => {
              const input = event.target.value;
              setStdin((drafts) => ({ ...drafts, [run.id]: input }));
            }}
          />
          <button
            type="submit"
            className="project-task-send"
            disabled={!connected}
            aria-label={t("发送输入")}
            title={t("发送输入")}
          >
            <SendHorizontal size={14} aria-hidden="true" />
          </button>
        </form>
      )}
    </article>
  );
}
