import { useState } from "react";
import { GitFileList } from "./GitFileList";
import {
  CheckCheck,
  ChevronRight,
  File,
  FileCode2,
  GitBranch,
  List,
  ListTree,
  RefreshCw,
  Unplug,
} from "lucide-react";
import "./git.css";
import { IconButton } from "../../components/ui";
import { joinDirectory } from "./workspace-path";
import { useStore } from "../../components/hooks";
import { useRuntime } from "../../lib/runtime-context";
import { type GitFile, type GitGroup } from "./git-status";
import { useWorkspaceGitStatus } from "./workspace-git";

const groups: [GitGroup, string][] = [
  ["conflict", "冲突"],
  ["staged", "已暂存"],
  ["unstaged", "未暂存"],
  ["untracked", "未跟踪"],
];
export function GitPanel({ cwd }: { cwd: string }) {
  const { connection } = useRuntime();
  const { epoch, scope } = useStore(connection);
  return (
    <GitPanelContents key={JSON.stringify([cwd, epoch, scope])} cwd={cwd} />
  );
}
function GitPanelContents({ cwd }: { cwd: string }) {
  const state = useWorkspaceGitStatus(cwd);
  const [treeView, setTreeView] = useState(true);
  const { connection, files: fileWorkspace, sessions } = useRuntime();
  const { epoch, scope } = useStore(connection);
  const [selected, select] = useState<{
    file: GitFile;
    group: GitGroup;
    cwd: string;
    epoch: number;
    scope: number;
  }>();
  const selection =
    selected?.cwd === cwd &&
    selected.epoch === epoch &&
    selected.scope === scope &&
    state.connected &&
    state.value?.files.some(
      (file) =>
        file.path === selected.file.path &&
        file.groups.includes(selected.group),
    )
      ? selected
      : undefined;
  const openCurrentFile = (file: GitFile, group: GitGroup) => {
    select({ file, group, cwd, epoch, scope });
    void fileWorkspace.open({
      path: joinDirectory(state.value?.repoRoot ?? cwd, file.path),
      cwd,
      threadId: sessions.getSnapshot().selectedId ?? undefined,
    });
  };
  return (
    <div className="git-panel" aria-label="源代码管理">
      <div className="git-repository">
        <div
          className="git-branch-label"
          title={state.connected ? state.value?.branch : undefined}
        >
          <GitBranch size={15} className="text-accent" aria-hidden="true" />
          <span className="truncate">
            {state.connected
              ? (state.value?.branch ?? "Git 工作区")
              : "Git 工作区"}
          </span>
        </div>
        <button
          type="button"
          className="git-file-action"
          title={treeView ? "切换为列表视图" : "切换为树状视图"}
          aria-label={treeView ? "切换为列表视图" : "切换为树状视图"}
          onClick={() => setTreeView((value) => !value)}
        >
          {treeView ? <List size={15} /> : <ListTree size={15} />}
        </button>
        <button
          type="button"
          className="rounded p-1 text-muted hover:bg-surface"
          aria-label="刷新 Git 工作区"
          disabled={!state.connected || state.loading}
          onClick={() => void state.refresh()}
        >
          <RefreshCw
            size={14}
            className={state.loading && state.connected ? "animate-spin" : ""}
          />
        </button>
      </div>
      <p
        className="git-caption"
        title="点击文件查看差异，点击行尾图标打开当前文件。"
      >
        源代码管理 · 只读{" "}
        <span>
          {state.connected && state.value
            ? `${state.value.changedFiles} 个更改`
            : "工作区"}
        </span>
      </p>
      {!state.connected ? (
        <div className="git-empty">
          <Unplug size={24} />
          <strong>环境未连接</strong>
          <p>连接环境后查看仓库更改。</p>
        </div>
      ) : state.failed ? (
        <div className="git-empty" role="status">
          <strong>无法读取仓库</strong>
          <p>请确认当前目录是 Git 仓库，然后点击刷新重试。</p>
        </div>
      ) : !state.value ? (
        <p className="git-empty" role="status">
          正在读取工作区…
        </p>
      ) : state.value.changedFiles === 0 ? (
        <div className="git-empty" role="status">
          <CheckCheck size={28} className="text-success" />
          <strong>工作区干净</strong>
          <p>所有更改均已提交。</p>
        </div>
      ) : (
        groups.map(([group, label]) => {
          const files = state.value!.files.filter((file) =>
            file.groups.includes(group),
          );
          if (!files.length) return null;
          return (
            <div key={group} className="git-group-container">
              <details className="git-group" open>
                <summary>
                  <ChevronRight size={13} />
                  <h3>
                    {label} · {files.length}
                  </h3>
                </summary>
                <GitFileList
                  files={files}
                  treeView={treeView}
                  renderFile={(file) => {
                    const deleted =
                      group === "conflict"
                        ? file.indexStatus === "D" &&
                          file.worktreeStatus === "D"
                        : file.indexStatus === "D" ||
                          file.worktreeStatus === "D";
                    return (
                      <li key={file.path} className="git-file-row">
                        <button
                          type="button"
                          title={`${group === "conflict" ? "打开当前文件" : "查看差异"}：${file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}`}
                          aria-label={file.path}
                          aria-pressed={
                            selection?.file.path === file.path &&
                            selection.group === group
                          }
                          className={`git-file ${selection?.file.path === file.path && selection.group === group ? "is-selected" : ""}`}
                          onClick={() => {
                            select({ file, group, cwd, epoch, scope });
                            if (group === "conflict") {
                              openCurrentFile(file, group);
                            } else {
                              void fileWorkspace.openGitDiff({
                                cwd,
                                path: file.path,
                                group,
                                threadId:
                                  sessions.getSnapshot().selectedId ??
                                  undefined,
                              });
                            }
                          }}
                        >
                          <File size={14} className="text-muted" />
                          <span className="git-filename">
                            {file.path.split("/").at(-1)}
                          </span>
                          <span className="git-directory">
                            {!treeView && file.path.includes("/")
                              ? file.path.slice(0, file.path.lastIndexOf("/"))
                              : ""}
                          </span>
                          <span
                            className={`git-status git-status-${group}`}
                            title={
                              group === "conflict"
                                ? "存在冲突"
                                : group === "staged"
                                  ? "已暂存"
                                  : group === "untracked"
                                    ? "未跟踪"
                                    : "未暂存"
                            }
                          >
                            {group === "conflict"
                              ? "U"
                              : group === "untracked"
                                ? "?"
                                : ((group === "staged"
                                    ? file.indexStatus
                                    : file.worktreeStatus) ?? "M")}
                          </span>
                        </button>
                        <IconButton
                          label={`打开当前文件：${file.path}`}
                          title={
                            deleted
                              ? "文件已删除，可点击文件名查看差异"
                              : `打开当前文件：${file.path}`
                          }
                          disabled={!state.connected || deleted}
                          onClick={() => openCurrentFile(file, group)}
                        >
                          <FileCode2 size={16} aria-hidden="true" />
                        </IconButton>
                      </li>
                    );
                  }}
                />
              </details>
            </div>
          );
        })
      )}
    </div>
  );
}
