import { Tabs } from "radix-ui";
import { ThreadTools } from "./ThreadTools";
import { useStore } from "../../components/hooks";
import { useRuntime } from "../../lib/runtime-context";
import { ScrollArea } from "../../components/ui";
import type { Thread } from "../../generated/v2/Thread";
import { FilesPanel } from "../shell/FilesPanel";
import { GitPanel } from "../shell/GitPanel";

export type ProjectTab = "files" | "git" | "session";
export interface DetailsProps {
  thread?: Thread;
  tab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
}

export function Details({ thread, tab, onTabChange }: DetailsProps) {
  const { connection, sessions } = useRuntime();
  const { epoch } = useStore(connection);
  const sessionState = useStore(sessions);
  return (
    <aside
      className="flex min-h-0 flex-1 flex-col text-[13px] text-foreground"
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
              ["git", "Git"],
              ["session", "会话"],
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
        <ScrollArea className="min-h-0 min-w-0 flex-1">
          <div className="min-w-0 p-4">
            <Tabs.Content value="files">
              {thread ? (
                <FilesPanel thread={thread} />
              ) : (
                <p className="text-muted">选择会话查看项目文件。</p>
              )}
            </Tabs.Content>
            <Tabs.Content value="git">
              {thread ? (
                <GitPanel cwd={thread.cwd} />
              ) : (
                <p className="text-muted">选择会话查看 Git 工作区。</p>
              )}
            </Tabs.Content>
            <Tabs.Content value="session">
              {thread && !sessionState.localDrafts[thread.id] ? (
                <ThreadTools key={`${thread.id}:${epoch}`} thread={thread} />
              ) : (
                <p className="text-muted">发送第一条消息后可使用会话工具。</p>
              )}
            </Tabs.Content>
          </div>
        </ScrollArea>
      </Tabs.Root>
    </aside>
  );
}
