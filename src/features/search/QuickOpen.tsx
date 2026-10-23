import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { File, Search } from "lucide-react";
import { Modal, ScrollArea } from "../../components/ui";
import { useStore } from "../../components/hooks";
import { useRuntime } from "../../lib/runtime-context";
import type { Thread } from "../../generated/v2/Thread";
import { searchWorkspaceFiles } from "../composer/file-search";
import { workspacePath } from "../shell/project-files";

export function QuickOpen({
  thread,
  onClose,
}: {
  thread: Thread;
  onClose: () => void;
}) {
  const { connection, files } = useRuntime();
  const state = useStore(connection);
  const workspace = useStore(files);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const location = /:(\d+)(?::(\d+))?$/.exec(query);
  const term = (location ? query.slice(0, location.index) : query).trim();
  const root = thread.cwd.replace(/[\\/]$/, "");
  const recent = [...workspace.documents]
    .reverse()
    .filter((doc) => doc.path.startsWith(`${root}/`))
    .map((doc) => doc.path.slice(root.length + 1));
  useEffect(() => {
    let stopped = false;
    setResults([]);
    setError("");
    setLoading(!!term && state.status === "connected");
    if (!term || state.status !== "connected") return;
    const timer = setTimeout(() => {
      void searchWorkspaceFiles(connection.client, thread.cwd, term)
        .then((entries) => {
          if (stopped) return;
          setResults(
            entries
              .filter((entry) => {
                if (
                  entry.match_type !== "file" ||
                  entry.root.replace(/[\\/]$/, "") !== root
                )
                  return false;
                try {
                  workspacePath(root, entry.path);
                  return true;
                } catch {
                  return false;
                }
              })
              .map((entry) => entry.path),
          );
        })
        .catch((cause: unknown) => {
          if (!stopped) setError(String(cause));
        })
        .finally(() => {
          if (!stopped) setLoading(false);
        });
    }, 150);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [
    connection,
    state.epoch,
    state.scope,
    state.status,
    thread.cwd,
    root,
    term,
  ]);
  const paths = term ? results : recent;
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="快速打开文件"
      variant="search"
    >
      <Command label="快速打开文件" shouldFilter={false} loop>
        <div className="mx-5 flex items-center gap-2 border-b border-border pb-2">
          <Search size={18} className="text-muted" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            aria-label="按名称搜索文件"
            placeholder="按名称搜索文件，可追加 :行号:列号"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
          />
        </div>
        <p className="px-5 py-2 text-xs text-muted" title={thread.cwd}>
          {thread.cwd} · {term ? "项目文件" : "已打开的文件"}
        </p>
        <ScrollArea className="max-h-[50dvh]">
          <Command.List aria-label="文件搜索结果" className="p-2">
            {paths.map((path) => (
              <Command.Item
                key={path}
                value={path}
                className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm data-[selected=true]:bg-selected"
                onSelect={() => {
                  setError("");
                  void files
                    .open({
                      path: workspacePath(root, path),
                      cwd: thread.cwd,
                      threadId: thread.id,
                      line: location
                        ? Math.max(1, Number(location[1]))
                        : undefined,
                      column: location?.[2]
                        ? Math.max(1, Number(location[2]))
                        : undefined,
                    })
                    .then(onClose)
                    .catch((cause: unknown) => setError(String(cause)));
                }}
              >
                <File size={15} className="shrink-0 text-muted" />
                <span className="truncate" title={path}>
                  {path}
                </span>
              </Command.Item>
            ))}
            {!paths.length && !loading && !error && (
              <p className="p-3 text-sm text-muted">
                {state.status !== "connected"
                  ? "连接环境后可搜索项目文件。"
                  : term
                    ? "没有匹配的文件"
                    : "输入文件名或路径开始查找。"}
              </p>
            )}
          </Command.List>
        </ScrollArea>
        {loading && (
          <p role="status" className="px-5 py-2 text-xs text-muted">
            正在查找文件…
          </p>
        )}
        {error && (
          <p role="alert" className="px-5 py-2 text-xs text-danger">
            {error}
          </p>
        )}
        {results.length === 50 && (
          <p className="px-5 text-xs text-muted">
            显示前 50 个结果，请细化搜索。
          </p>
        )}
        <footer className="mt-2 border-t border-border px-5 py-3 text-xs text-muted">
          ↑ ↓ 选择 Enter 打开 Esc 关闭
        </footer>
      </Command>
    </Modal>
  );
}
