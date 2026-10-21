import { GitTools } from "./GitTools";
import { gitUiState, type GitUiState } from "./git-ui-state";
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
export function GitPanel({
  cwd,
  onSelectWorktree,
}: {
  cwd: string;
  onSelectWorktree?: (path: string) => void;
}) {
  const { connection } = useRuntime();
  const { scope, epoch } = useStore(connection);
  const state = useWorkspaceGitStatus(cwd);
  const root = state.value?.repoRoot;
  return (
    <GitPanelContents
      key={JSON.stringify([
        scope,
        epoch,
        root ? ["root", root] : ["pending", cwd],
      ])}
      cwd={cwd}
      state={state}
      root={root}
      onSelectWorktree={onSelectWorktree}
    />
  );
}
function GitPanelContents({
  cwd,
  root,
  state,
  onSelectWorktree,
}: {
  cwd: string;
  onSelectWorktree?: (path: string) => void;
  root?: string;
  state: ReturnType<typeof useWorkspaceGitStatus>;
}) {
  const { connection, files: fileWorkspace, sessions } = useRuntime();
  const { scope } = useStore(connection);
  const [cache] = useState(() =>
    root ? gitUiState(connection, scope, root) : undefined,
  );
  const [ui, setUi] = useState<GitUiState>(
    () => cache ?? { treeView: true, groups: {}, directories: {} },
  );
  const update = (next: Partial<GitUiState>) => {
    if (next.directories && Object.keys(next.directories).length > 1000)
      next.directories = Object.fromEntries(
        Object.entries(next.directories).slice(-1000),
      );
    const value = { ...ui, ...next };
    if (cache) Object.assign(cache, value);
    setUi(value);
  };
  const { treeView, selected } = ui;
  const select = (file: GitFile, group: GitGroup) =>
    update({ selected: { path: file.path, group } });
  const selection =
    selected &&
    state.connected &&
    state.value?.files.some(
      (file) =>
        file.path === selected.path && file.groups.includes(selected.group),
    )
      ? selected
      : undefined;
  const openCurrentFile = (file: GitFile, group: GitGroup) => {
    select(file, group);
    void fileWorkspace.open({
      path: joinDirectory(root ?? cwd, file.path),
      cwd: root ?? cwd,
      threadId: sessions.getSnapshot().selectedId ?? undefined,
    });
  };
  return (
    <div className="min-w-0 pb-3 text-caption" aria-label="源代码管理">
      <div className="flex items-center gap-2 border-b border-border p-3">
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
        <IconButton
          label={treeView ? "切换为列表视图" : "切换为树状视图"}
          onClick={() => update({ treeView: !treeView })}
        >
          {treeView ? <List size={15} /> : <ListTree size={15} />}
        </IconButton>
        <IconButton
          label="刷新 Git 工作区"
          disabled={!state.connected || state.loading}
          onClick={() => void state.refresh()}
        >
          <RefreshCw
            size={14}
            className={state.loading && state.connected ? "animate-spin" : ""}
          />
        </IconButton>
      </div>
      <p
        className="flex justify-between gap-2 px-3 pt-3 pb-2 text-meta text-muted max-[900px]:flex-wrap max-[900px]:[overflow-wrap:anywhere]"
        title="点击文件查看差异，点击行尾图标打开当前文件。"
      >
        源代码管理{" "}
        <span>
          {state.connected && state.value
            ? `${state.value.changedFiles} 个更改`
            : "工作区"}
        </span>
      </p>
      {state.connected && root && state.value && (
        <GitTools root={root} onSelectWorktree={onSelectWorktree} />
      )}
      {state.failed && state.value && (
        <p role="status" className="px-3 text-muted">
          刷新失败，正在显示上次读取的内容。
        </p>
      )}
      {!state.connected ? (
        <div className="git-empty">
          <Unplug size={24} />
          <strong>环境未连接</strong>
          <p>连接环境后查看仓库更改。</p>
        </div>
      ) : state.failed && !state.value ? (
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
              <details className="git-group" open={ui.groups[group] ?? true}>
                <summary
                  onClick={(event) => {
                    event.preventDefault();
                    update({
                      groups: {
                        ...ui.groups,
                        [group]: !(ui.groups[group] ?? true),
                      },
                    });
                  }}
                >
                  <ChevronRight size={13} />
                  <h3>
                    {label} · {files.length}
                  </h3>
                </summary>
                <GitFileList
                  files={files}
                  treeView={treeView}
                  directoryOpen={ui.directories}
                  directoryKey={group}
                  onDirectoryChange={(key, open) =>
                    update({ directories: { ...ui.directories, [key]: open } })
                  }
                  renderFile={(file) => {
                    const deleted =
                      group === "conflict"
                        ? file.indexStatus === "D" &&
                          file.worktreeStatus === "D"
                        : file.indexStatus === "D" ||
                          file.worktreeStatus === "D";
                    return (
                      <li
                        key={file.path}
                        className="flex items-center pr-2 hover:bg-surface focus-within:bg-surface"
                      >
                        <button
                          type="button"
                          title={`${group === "conflict" ? "打开当前文件" : "查看差异"}：${file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}`}
                          aria-label={file.path}
                          aria-pressed={
                            selection?.path === file.path &&
                            selection.group === group
                          }
                          className={`git-file ${selection?.path === file.path && selection.group === group ? "is-selected" : ""}`}
                          onClick={() => {
                            select(file, group);
                            if (group === "conflict") {
                              openCurrentFile(file, group);
                            } else {
                              void fileWorkspace.openGitDiff({
                                cwd: root ?? cwd,
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
                          <span className="min-w-0 truncate">
                            {file.path.split("/").at(-1)}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-meta text-subtle">
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
