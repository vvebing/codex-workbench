import { useState, useSyncExternalStore, type ReactNode } from "react";
import type { ProjectTaskConfig, ProjectsStore } from "./store";
import {
  Button,
  ErrorNotice,
  Modal,
  ScrollArea,
  SelectField,
} from "../../components/ui";
import {
  settingsInputClass,
  settingsSelectClass,
} from "../settings/settings-ui";
import {
  emptyProject,
  normalizeProjectDirectory,
  previewAddress,
} from "./store";

export interface ProjectWorkspaceProps {
  store: ProjectsStore;
  connected: boolean;
  currentCwd: string | null;
  sessionTools?: ReactNode;
  onCreateTask?: (config: ProjectTaskConfig) => void;
}
export default function ProjectWorkspace({
  store,
  connected,
  currentCwd,
  sessionTools,
  onCreateTask,
}: ProjectWorkspaceProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [directory, setDirectory] = useState("");
  const [stdin, setStdin] = useState("");
  const cwd = currentCwd ? normalizeProjectDirectory(currentCwd) : "";
  const savedProject = state.projects.find((item) => item.cwd === cwd);
  const project = cwd ? (savedProject ?? emptyProject(cwd)) : null;
  const active = (status: string) =>
    ["running", "stopping", "unknown"].includes(status);
  const busy = state.runs.some((run) => active(run.status));
  const visibleRuns = state.runs.filter(
    (run) => run.cwd === cwd || active(run.status),
  );
  const preview = project && previewAddress(project.previewUrl);
  return (
    <section
      aria-label="工作区"
      className="flex min-w-0 flex-col gap-4 text-sm [overflow-wrap:anywhere] [&_label]:flex [&_label]:min-w-0 [&_label]:flex-col [&_label]:gap-2 [&_label]:font-medium"
    >
      <div className="space-y-2">
        <h2 className="font-semibold">当前项目</h2>
        {cwd ? (
          <p className="text-xs text-muted">
            <code>{cwd}</code>
          </p>
        ) : (
          <p className="text-muted">
            当前会话未设置项目目录。选择目录并新建会话后，即可配置和运行项目命令。
          </p>
        )}
        <Button
          onClick={() => {
            setDirectory(cwd);
            setSwitchOpen(true);
          }}
        >
          切换项目／新建会话
        </Button>
      </div>
      {state.warning && <ErrorNotice>{state.warning}</ErrorNotice>}
      {project && (
        <>
          <h3 className="font-medium">常用命令与预览</h3>
          <p className="text-xs text-muted">
            命令仅在点击运行后于当前会话目录执行，通过服务端 /bin/sh 运行。
          </p>
          {(["test", "build", "dev"] as const).map((kind) => (
            <div
              className="flex items-end gap-2 max-[550px]:flex-col max-[550px]:items-stretch"
              key={kind}
            >
              <label className="flex-1">
                {kind}
                <input
                  className={settingsInputClass}
                  aria-label={`${kind} 命令`}
                  value={project.commands[kind]}
                  onChange={(event) =>
                    store.save({
                      ...project,
                      commands: {
                        ...project.commands,
                        [kind]: event.target.value,
                      },
                    })
                  }
                />
              </label>
              <Button
                disabled={!connected || busy || !project.commands[kind].trim()}
                onClick={() => void store.run(kind, cwd)}
              >
                运行 {kind}
              </Button>
            </div>
          ))}
          <label>
            显式预览地址
            <input
              className={settingsInputClass}
              aria-label="预览地址"
              placeholder="http://localhost:3000"
              value={project.previewUrl}
              onChange={(event) =>
                store.save({ ...project, previewUrl: event.target.value })
              }
            />
          </label>
          {preview && (
            <a
              className="text-accent underline underline-offset-4"
              href={preview}
              target="_blank"
              rel="noreferrer"
            >
              打开预览（浏览器访问地址，未验证服务就绪）
            </a>
          )}
          {project.previewUrl && !preview && (
            <ErrorNotice>请输入不含凭据的 http(s) 地址。</ErrorNotice>
          )}
        </>
      )}
      {visibleRuns.length > 0 && (
        <p className="text-xs text-muted">
          断线或请求超时表示状态未知。开发命令最长运行 24 小时，其他命令最长 10
          分钟；其他项目的活动命令也可在此停止或核实。
        </p>
      )}
      {visibleRuns.map((run) => (
        <article
          key={run.id}
          className="space-y-3 rounded-lg border border-border bg-elevated p-3"
          aria-label="命令运行记录"
        >
          <p>
            {run.cwd !== cwd && <strong className="block">其他项目运行</strong>}
            <code>{run.cwd}</code> · <code>{run.command}</code>
            <span className="block text-xs text-muted">进程：{run.id}</span>
          </p>
          <p>
            状态：
            {
              {
                running: "进行中",
                stopping: "等待停止确认",
                exited: "已退出",
                unknown: "状态未知",
                unsupported: "版本不支持",
              }[run.status]
            }
            {run.exitCode !== undefined && ` · 退出码 ${run.exitCode}`}
          </p>
          {run.error && <ErrorNotice>{run.error}</ErrorNotice>}
          {run.status === "unknown" && (
            <Button onClick={() => store.acknowledgeUnknown(run.id)}>
              已在外部核实进程，解除运行锁
            </Button>
          )}
          {run.truncated && <p>输出已截断，仅保留最近内容。</p>}
          <ScrollArea className="max-h-80 rounded-lg border border-border bg-surface">
            <pre
              className="p-3 font-mono text-code leading-code whitespace-pre-wrap [overflow-wrap:anywhere]"
              aria-label="命令输出"
            >
              {run.output || "暂无输出"}
            </pre>
          </ScrollArea>
          <Button
            disabled={!connected || run.status !== "running"}
            onClick={() => void store.stop(run.id)}
          >
            停止
          </Button>
          {run.status === "running" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void store.write(run.id, `${stdin}\n`);
                setStdin("");
              }}
            >
              <input
                className={settingsInputClass}
                aria-label="命令标准输入"
                value={stdin}
                onChange={(event) => setStdin(event.target.value)}
              />
              <Button type="submit" disabled={!connected}>
                发送输入
              </Button>
            </form>
          )}
        </article>
      ))}
      <section
        aria-label="当前会话"
        className="space-y-3 border-t border-border pt-3"
      >
        <h2 className="font-semibold">当前会话</h2>
        {sessionTools}
      </section>
      {project && (
        <details className="border-t border-border pt-3">
          <summary className="cursor-pointer font-medium">项目默认设置</summary>
          <div className="mt-3 space-y-3">
            <p className="text-xs text-muted">
              项目说明和默认模型仅用于新建会话，不改变当前会话。配置按环境、服务地址和目录保存在浏览器。
            </p>
            <label>
              项目说明
              <textarea
                className={`${settingsInputClass} min-h-24 resize-y`}
                aria-label="项目说明"
                value={project.description}
                onChange={(event) =>
                  store.save({ ...project, description: event.target.value })
                }
              />
            </label>
            <label>
              默认模型
              <input
                className={settingsInputClass}
                aria-label="默认模型"
                placeholder="留空使用新会话默认设置"
                value={project.model}
                onChange={(event) =>
                  store.save({ ...project, model: event.target.value })
                }
              />
            </label>
            <Button
              variant="danger"
              disabled={
                !savedProject ||
                state.runs.some((run) => run.cwd === cwd && active(run.status))
              }
              onClick={() => store.remove(cwd)}
            >
              删除本地项目配置
            </Button>
            <p className="text-xs text-muted">
              仅删除浏览器保存的配置，不删除目录。存在运行中或状态未知的命令时暂不可删除。
            </p>
          </div>
        </details>
      )}
      <Modal
        open={switchOpen}
        onOpenChange={setSwitchOpen}
        title="切换项目／新建会话"
        description="选择已保存项目或填写服务端目录，继续后确认新建会话。"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const target = normalizeProjectDirectory(directory);
            if (!connected || !target || !onCreateTask) return;
            const config =
              state.projects.find((item) => item.cwd === target) ??
              emptyProject(target);
            setSwitchOpen(false);
            onCreateTask({
              cwd: target,
              description: config.description,
              model: config.model,
            });
          }}
        >
          <SelectField
            id="saved-project"
            label="已保存项目"
            className={settingsSelectClass}
            value={
              state.projects.some((item) => item.cwd === directory)
                ? directory
                : "__none__"
            }
            onValueChange={(value) =>
              setDirectory(value === "__none__" ? "" : value)
            }
            options={[
              { value: "__none__", label: "选择项目" },
              ...state.projects.map((item) => ({
                value: item.cwd,
                label: item.cwd,
              })),
            ]}
          />
          <label>
            项目目录
            <input
              className={settingsInputClass}
              aria-label="项目目录"
              placeholder="服务端绝对目录"
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setSwitchOpen(false)}>取消</Button>
            <Button
              variant="primary"
              type="submit"
              disabled={!connected || !directory.trim() || !onCreateTask}
            >
              新建会话
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
