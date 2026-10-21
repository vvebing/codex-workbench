import { useMemo, useRef, useState } from "react";
import { Download, FolderGit2, MoreHorizontal } from "lucide-react";
import {
  Button,
  ErrorNotice,
  IconButton,
  Menu,
  MenuItem,
} from "../../components/ui";
import { useRuntime } from "../../lib/runtime-context";
import { exportText } from "../conversation/export";
import { GitTools as ReadOnlyGitTools } from "./git-tools";

export function GitTools({
  root,
  onSelectWorktree,
}: {
  root: string;
  onSelectWorktree?: (path: string) => void;
}) {
  const { connection } = useRuntime();
  const { epoch, scope } = connection.getSnapshot();
  const tools = useMemo(
    () =>
      new ReadOnlyGitTools(
        root,
        (params) => connection.client.request("command/exec", params),
        () => {
          const now = connection.getSnapshot();
          return (
            now.status === "connected" &&
            now.epoch === epoch &&
            now.scope === scope
          );
        },
      ),
    [connection, root, epoch, scope],
  );
  const [trees, setTrees] = useState<string[]>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const act = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Git 只读工具"
      className="space-y-2 border-b border-border px-3 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-meta text-muted">查看差异与导出补丁</span>
        <Menu
          label="Git 工具"
          trigger={
            <IconButton label="Git 工具" disabled={busy}>
              <MoreHorizontal size={16} />
            </IconButton>
          }
        >
          {[false, true].map((cached) => (
            <MenuItem
              className="menu-item"
              key={String(cached)}
              disabled={busy}
              onSelect={() =>
                void act(async () =>
                  exportText(
                    await tools.patch(cached),
                    cached ? "staged.patch" : "working-tree.patch",
                  ),
                )
              }
            >
              <Download size={15} />
              {cached ? "导出已暂存补丁" : "导出未暂存补丁"}
            </MenuItem>
          ))}
          {onSelectWorktree && (
            <MenuItem
              className="menu-item"
              disabled={busy}
              onSelect={() =>
                void act(async () => setTrees(await tools.worktrees()))
              }
            >
              <FolderGit2 size={15} />
              选择已有工作树
            </MenuItem>
          )}
        </Menu>
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {trees && (
        <div className="space-y-1">
          <p className="text-meta text-muted">选择工作树目录新建会话</p>
          {trees.map((tree) => (
            <Button
              key={tree}
              size="sm"
              variant="quiet"
              className="w-full justify-start whitespace-normal break-all text-left"
              disabled={busy}
              onClick={() => onSelectWorktree?.(tree)}
            >
              {tree}
            </Button>
          ))}
          {!trees.length && (
            <p className="text-meta text-muted">没有已记录的工作树。</p>
          )}
        </div>
      )}
    </section>
  );
}
