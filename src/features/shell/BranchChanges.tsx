import { GitBranch } from "lucide-react";
import { Tooltip } from "radix-ui";
import type { Thread } from "../../generated/v2/Thread";
import { useWorkspaceGitStatus } from "./workspace-git";

export function BranchChanges({
  thread,
  onOpenGit,
}: {
  thread?: Pick<Thread, "id" | "cwd" | "gitInfo">;
  onOpenGit?: () => void;
}) {
  const state = useWorkspaceGitStatus(thread?.cwd ?? "");
  if (!thread?.cwd) return null;
  const branch = state.connected ? state.value?.branch : undefined;
  const count = state.connected ? (state.value?.changedFiles ?? null) : null;
  const statusLabel = !state.connected
    ? "环境未连接"
    : state.failed
      ? "读取失败"
      : count === null
        ? "读取中…"
        : count === 0
          ? "工作区干净"
          : `改动 ${count} 个文件`;
  const label = `Git 分支：${branch ?? "未获取"}；工作区改动文件数：${count ?? "未获取"}`;
  const explanation =
    count !== null
      ? `当前工作区有 ${count} 个改动文件，包含已暂存、未暂存、未跟踪和冲突文件；重命名只计一个文件。`
      : !state.connected
        ? "环境未连接，未获取工作区改动文件数。"
        : state.failed
          ? "未获取工作区改动文件数，请检查 Git 仓库和环境的命令执行支持。"
          : "正在读取当前工作区的改动文件数。";
  const tooltip = `Git 分支：${branch ?? "未获取"}。${explanation}`;
  return (
    <Tooltip.Provider delayDuration={250}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            onClick={onOpenGit}
            data-slot="header-branch"
            className="flex min-w-0 max-w-[220px] shrink items-center gap-[7px] whitespace-nowrap rounded text-[11px] text-muted focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent max-[900px]:min-h-11 max-[900px]:max-w-[160px] max-[550px]:size-11 max-[550px]:shrink-0 max-[550px]:justify-center max-[550px]:[&>span]:hidden"
            aria-label={label}
          >
            <GitBranch size={14} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{branch ?? "Git"}</span>
            <span data-slot="branch-changes" className="min-w-0 truncate">
              {statusLabel}
            </span>
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="z-[100] max-w-[min(360px,90vw)] rounded-md bg-elevated px-3 py-2 text-xs text-foreground shadow-lg [overflow-wrap:anywhere]"
            side="bottom"
            sideOffset={8}
            collisionPadding={8}
          >
            {tooltip}
            <Tooltip.Arrow className="fill-elevated" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
