import { Tabs } from "radix-ui";
import { ThreadTools } from "./ThreadTools";
import { useStore, useStoreSelector } from "../../components/hooks";
import { useRuntime } from "../../lib/runtime-context";
import { ResourceScrollArea } from "./ResourceScrollArea";
import { ScrollArea } from "../../components/ui";
import { useWorkspaceGitStatus } from "../shell/workspace-git";
import type { ProjectTab } from "./project-panel-state";
export type { ProjectTab } from "./project-panel-state";
import type { Thread } from "../../generated/v2/Thread";
import { FilesPanel } from "../shell/FilesPanel";
import { ContentSearch } from "../search/ContentSearch";
import { GitPanel } from "../shell/GitPanel";
import { useMemo } from "react";
import ProjectWorkspace from "../projects/ProjectWorkspace";
import { projectsFor, type ProjectTaskConfig } from "../projects/store";

export interface DetailsProps {
  cacheScope: string;
  thread?: Thread;
  tab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
  environmentId: string;
  onCreateProjectTask: (config: ProjectTaskConfig) => void;
  onSelectWorktree: (path: string) => void;
}

export function Details({
  cacheScope,
  thread,
  tab,
  onTabChange,
  environmentId,
  onCreateProjectTask,
  onSelectWorktree,
}: DetailsProps) {
  const { connection, sessions } = useRuntime();
  const { epoch, status } = useStore(connection);
  const projects = useMemo(
    () => projectsFor(connection, environmentId),
    [connection, environmentId],
  );
  const localDraft = useStoreSelector(
    sessions,
    (state) => !!(thread && state.localDrafts[thread.id]),
  );
  return (
    <aside
      className="flex min-h-0 flex-1 flex-col text-control text-foreground"
      aria-label="项目面板"
    >
      <Tabs.Root
        value={tab}
        onValueChange={(value) => onTabChange(value as ProjectTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <Tabs.List
          aria-label="项目工具"
          className="flex shrink-0 gap-1 border-b border-border p-2"
        >
          {(
            [
              ["files", "文件"],
              ["search", "搜索"],
              ["git", "Git"],
              ["workspace", "工作区"],
            ] as const
          ).map(([value, label]) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className="flex-1 rounded-md px-3 py-2 text-xs text-muted hover:bg-hover data-[state=active]:bg-selected data-[state=active]:font-medium data-[state=active]:text-accent"
            >
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content
          value="files"
          className="min-h-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col"
        >
          {thread ? (
            <FilesPanel thread={thread} />
          ) : (
            <p className="p-4 text-muted">选择会话查看项目文件。</p>
          )}
        </Tabs.Content>
        <Tabs.Content
          value="search"
          forceMount
          className="min-h-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col data-[state=inactive]:hidden"
        >
          {thread ? (
            <ContentSearch
              key={JSON.stringify([cacheScope, epoch, thread.cwd])}
              thread={thread}
              active={tab === "search"}
            />
          ) : (
            <p className="p-4 text-muted">选择会话后搜索项目内容。</p>
          )}
        </Tabs.Content>
        <Tabs.Content
          value="git"
          className="min-h-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col"
        >
          {thread ? (
            <GitResource
              scope={cacheScope}
              cwd={thread.cwd}
              onSelectWorktree={onSelectWorktree}
            />
          ) : (
            <p className="p-4 text-muted">选择会话查看 Git 工作区。</p>
          )}
        </Tabs.Content>
        <Tabs.Content
          value="workspace"
          className="min-h-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col"
        >
          <ResourceScrollArea
            key={JSON.stringify([
              cacheScope,
              "workspace",
              thread?.id,
              thread?.cwd,
            ])}
            scope={cacheScope}
            resource={JSON.stringify(["workspace", thread?.id, thread?.cwd])}
          >
            <ProjectWorkspace
              key={JSON.stringify([cacheScope, epoch, thread?.id, thread?.cwd])}
              store={projects}
              connected={status === "connected"}
              currentCwd={thread?.cwd ?? null}
              onCreateTask={onCreateProjectTask}
              sessionTools={
                thread && !localDraft ? (
                  <ThreadTools key={`${thread.id}:${epoch}`} thread={thread} />
                ) : (
                  <p className="text-xs text-muted">
                    {thread
                      ? "发送第一条消息后可使用会话工具。"
                      : "选择会话后查看目标、参考资料和代码审查。"}
                  </p>
                )
              }
            />
          </ResourceScrollArea>
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  );
}

function GitResource({
  scope,
  cwd,
  onSelectWorktree,
}: {
  scope: string;
  cwd: string;
  onSelectWorktree: (path: string) => void;
}) {
  const git = useWorkspaceGitStatus(cwd);
  const root = git.value?.repoRoot;
  // Wait for canonical identity before touching the shared scroll entry.
  if (!root)
    return (
      <ScrollArea className="flex-1" viewportProps={{ className: "p-4" }}>
        <GitPanel cwd={cwd} onSelectWorktree={onSelectWorktree} />
      </ScrollArea>
    );
  return (
    <ResourceScrollArea
      key={JSON.stringify([scope, root])}
      scope={scope}
      resource={JSON.stringify(["git", root])}
    >
      <GitPanel cwd={cwd} onSelectWorktree={onSelectWorktree} />
    </ResourceScrollArea>
  );
}
