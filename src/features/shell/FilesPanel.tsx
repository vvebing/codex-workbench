import { Button } from "../../components/ui";
import { readIgnoredPaths } from "./git-ignore";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  RefreshCw,
  FilePlus,
  FolderPlus,
  ListCollapse,
  MoreHorizontal,
} from "lucide-react";
import { ContextMenu } from "radix-ui";
import { useStore } from "../../components/hooks";
import { useRuntime } from "../../lib/runtime-context";
import type { Thread } from "../../generated/v2/Thread";
import type { FsReadDirectoryResponse } from "../../generated/v2/FsReadDirectoryResponse";
import { searchWorkspaceFiles } from "../composer/file-search";
import { referenceProjectFile, workspacePath } from "./project-files";

import { useWorkspaceGitStatus } from "./workspace-git";
import { treeGitDecorations } from "./tree-git";
import { watchWorkspace } from "./workspace-watch";
import "../files/files.css";
import { FileDialog } from "../files/FileDialog";

type Entry = { path: string; directory: boolean; file: boolean };
type Listing = { entries?: Entry[]; error?: string };
const actionClass =
  "rounded px-2 py-1 text-xs hover:bg-hover disabled:opacity-50";

export function FilesPanel({ thread }: { thread: Thread }) {
  const { connection } = useRuntime();
  const { epoch, scope, status } = useStore(connection);
  if (status !== "connected")
    return <p className="p-4 text-xs text-muted">连接环境后可浏览项目文件。</p>;
  if (!thread.cwd)
    return <p className="p-4 text-xs text-muted">当前会话没有项目目录。</p>;
  return (
    <ConnectedFiles
      key={JSON.stringify([epoch, scope, thread.id, thread.cwd])}
      thread={thread}
    />
  );
}

function ConnectedFiles({ thread }: { thread: Thread }) {
  const { connection, drafts, files } = useRuntime();
  const fileRevision = useSyncExternalStore(
    files.subscribe,
    () => files.getSnapshot().revision,
  );
  const git = useWorkspaceGitStatus(thread.cwd);
  const refreshGit = git.refresh;
  const decorations = useMemo(
    () => treeGitDecorations(git.value, thread.cwd),
    [git.value, thread.cwd],
  );
  const [directories, setDirectories] = useState<Record<string, Listing>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Listing>({});
  const [revision, setRevision] = useState(0);
  const ignoreStatus = JSON.stringify(git.value?.files);
  const ignoreRoot = git.value?.repoRoot;
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const ignorePaths = JSON.stringify(
    [
      ...new Set(
        (query.trim()
          ? (search.entries ?? [])
          : [...expanded].flatMap((path) => directories[path]?.entries ?? [])
        ).map((entry) => entry.path),
      ),
    ].sort(),
  );
  useEffect(() => {
    let stopped = false;
    if (!ignoreRoot || git.failed) {
      setIgnored(new Set());
      return;
    }
    void readIgnoredPaths(
      connection.client,
      thread.cwd,
      JSON.parse(ignorePaths) as string[],
      () => !stopped,
    )
      .then((paths) => {
        if (!stopped) setIgnored(paths);
      })
      .catch(() => {
        if (!stopped) setIgnored(new Set());
      });
    return () => {
      stopped = true;
    };
  }, [
    connection,
    thread.cwd,
    ignorePaths,
    ignoreRoot,
    ignoreStatus,
    git.failed,
    revision,
  ]);
  const [menuEntry, setMenuEntry] = useState<Entry>();
  const menuFocus = useRef<HTMLElement | null>(null);
  const [selected, setSelected] = useState<string>();
  const [selectedDirectory, setSelectedDirectory] = useState(false);
  const [operation, setOperation] = useState<
    "file" | "directory" | "copy" | "delete"
  >();
  const [destination, setDestination] = useState("");
  const [operationError, setOperationError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const active = useRef(true);
  const directoryGeneration = useRef(0);
  const requestedDirectories = useRef(new Map<string, number>());
  const searchQuery = useRef("");
  const identity = useRef(connection.getSnapshot());
  const current = () => {
    const next = connection.getSnapshot();
    return (
      active.current &&
      next.epoch === identity.current.epoch &&
      next.scope === identity.current.scope &&
      next.status === "connected"
    );
  };
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    const generation = directoryGeneration.current;
    const snapshot = connection.getSnapshot();
    const valid = () =>
      active.current &&
      generation === directoryGeneration.current &&
      connection.getSnapshot().epoch === snapshot.epoch &&
      connection.getSnapshot().scope === snapshot.scope;
    for (const relative of expanded) {
      if (requestedDirectories.current.get(relative) === generation) continue;
      requestedDirectories.current.set(relative, generation);
      // Keep cached rows mounted while a remote refresh is in flight.
      setDirectories((old) =>
        old[relative] ? old : { ...old, [relative]: {} },
      );
      void Promise.resolve()
        .then(() =>
          connection.client.request<FsReadDirectoryResponse>(
            "fs/readDirectory",
            {
              path: relative ? workspacePath(thread.cwd, relative) : thread.cwd,
            },
          ),
        )
        .then((result) => {
          if (!valid()) return;
          const entries = result.entries
            .filter(
              (entry) =>
                entry.fileName !== ".git" &&
                !/[\\/]/.test(entry.fileName) &&
                entry.fileName !== "." &&
                entry.fileName !== "..",
            )
            .map((entry) => ({
              path: relative ? `${relative}/${entry.fileName}` : entry.fileName,
              directory: entry.isDirectory,
              file: entry.isFile,
            }))
            .sort(
              (a, b) =>
                Number(b.directory) - Number(a.directory) ||
                a.path.localeCompare(b.path),
            );
          setDirectories((old) => ({ ...old, [relative]: { entries } }));
        })
        .catch((error: unknown) => {
          if (valid())
            setDirectories((old) => ({
              ...old,
              [relative]: { ...old[relative], error: String(error) },
            }));
        });
    }
  }, [connection, thread.cwd, expanded, revision]);

  useEffect(() => {
    if (!query.trim()) return;
    let stopped = false;
    if (searchQuery.current !== query.trim()) setSearch({});
    searchQuery.current = query.trim();
    const timer = setTimeout(() => {
      void searchWorkspaceFiles(connection.client, thread.cwd, query.trim())
        .then((files) => {
          if (stopped) return;
          const entries: Entry[] = [];
          for (const file of files) {
            if (
              file.root.replace(/[\\/]$/, "") !==
              thread.cwd.replace(/[\\/]$/, "")
            )
              continue;
            try {
              workspacePath(thread.cwd, file.path);
            } catch {
              continue;
            }
            if (file.path.replace(/\\/g, "/").split("/").includes(".git"))
              continue;
            entries.push({
              path: file.path,
              directory: file.match_type === "directory",
              file: file.match_type !== "directory",
            });
          }
          setSearch({ entries: entries.slice(0, 50) });
        })
        .catch((error: unknown) => {
          if (!stopped) setSearch((old) => ({ ...old, error: String(error) }));
        });
    }, 250);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [connection, thread.cwd, query, revision]);

  useEffect(
    () =>
      watchWorkspace(connection, thread.cwd, () => {
        ++directoryGeneration.current;
        setRevision((value) => value + 1);
      }),
    [connection, thread.cwd],
  );

  useEffect(() => {
    ++directoryGeneration.current;
    setRevision((value) => value + 1);
  }, [fileRevision]);

  const open = async (path: string) => {
    setSelected(path);
    setSelectedDirectory(false);
    setNotice("");
    try {
      await files.open({
        path: workspacePath(thread.cwd, path),
        cwd: thread.cwd,
        threadId: thread.id,
      });
    } catch (error) {
      if (current()) setNotice(String(error));
    }
  };
  const beginOperation = (kind: "file" | "directory" | "copy" | "delete") => {
    setOperation(kind);
    setOperationError("");
    setDestination(kind === "copy" ? `${selected ?? ""}.copy` : "");
  };
  const prepareMenu = (target: HTMLElement) => {
    const row = target.closest<HTMLElement>("[data-file-entry]");
    if (
      !row ||
      (row.dataset.directory !== "true" && row.dataset.file !== "true")
    ) {
      return false;
    }
    const entry = {
      path: row.dataset.fileEntry!,
      directory: row.dataset.directory === "true",
      file: row.dataset.file === "true",
    };
    menuFocus.current = target.closest("button");
    setMenuEntry(entry);
    setSelected(entry.path);
    setSelectedDirectory(entry.directory);

    return true;
  };
  const renderEntries = (
    listing: Listing | undefined,
    depth: number,
  ): React.ReactNode => {
    if (listing?.error && !listing.entries)
      return (
        <p role="alert" className="px-3 py-2 text-xs text-muted break-words">
          读取失败：{listing.error}。请刷新重试。
        </p>
      );
    if (!listing?.entries)
      return <p className="px-3 py-2 text-xs text-muted">正在读取…</p>;
    if (!listing.entries.length)
      return <p className="px-3 py-2 text-xs text-muted">没有文件</p>;
    return listing.entries.map((entry) => {
      const decoration = decorations.get(entry.path.replace(/\\/g, "/"));
      const isIgnored = ignored.has(entry.path) && !decoration;
      return (
        <div key={entry.path}>
          <div
            className="group flex items-center rounded hover:bg-hover"
            data-file-entry={entry.path}
            data-directory={entry.directory}
            data-file={entry.file}
            data-git-ignored={isIgnored || undefined}
          >
            <button
              type="button"
              className={`flex min-w-0 flex-1 items-center gap-1.5 rounded py-1.5 pr-2 text-left text-xs hover:bg-hover disabled:opacity-50 ${decoration?.className ?? (isIgnored ? "text-muted" : "")}`}
              style={{ paddingLeft: 12 + depth * 12 }}
              title={`${entry.path}${decoration ? `：${decoration.label}` : isIgnored ? "：已被 Git 忽略" : ""}`}
              aria-label={`${entry.path}${decoration ? `，${decoration.label}` : isIgnored ? "，已被 Git 忽略" : ""}`}
              disabled={!entry.directory && !entry.file}
              aria-expanded={
                entry.directory ? expanded.has(entry.path) : undefined
              }
              onClick={() => {
                if (entry.directory) {
                  setSelected(entry.path);
                  setSelectedDirectory(true);
                  setExpanded((old) => {
                    const next = new Set(old);
                    if (next.has(entry.path)) next.delete(entry.path);
                    else next.add(entry.path);
                    return next;
                  });
                } else void open(entry.path);
              }}
            >
              {entry.directory ? (
                <>
                  {expanded.has(entry.path) ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  <Folder size={14} />
                </>
              ) : (
                <File size={14} className="ml-3" />
              )}
              <span className="truncate">
                {query.trim() && depth === 0
                  ? entry.path
                  : entry.path.split(/[\\/]/).at(-1)}
              </span>
              {decoration && (
                <span
                  aria-hidden="true"
                  className="ml-auto shrink-0 font-mono text-[10px]"
                >
                  {decoration.badge}
                </span>
              )}
            </button>
            <button
              type="button"
              className="shrink-0 rounded p-1.5 text-muted opacity-0 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 max-[900px]:opacity-100"
              aria-label={`更多操作：${entry.path}`}
              title="更多操作"
              aria-haspopup="menu"
              disabled={!entry.directory && !entry.file}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                event.currentTarget.dispatchEvent(
                  new MouseEvent("contextmenu", {
                    bubbles: true,
                    cancelable: true,
                    clientX: rect.left,
                    clientY: rect.bottom,
                  }),
                );
              }}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
          {entry.directory &&
            expanded.has(entry.path) &&
            renderEntries(directories[entry.path], depth + 1)}
        </div>
      );
    });
  };
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="项目文件">
      <div className="flex items-center gap-2 p-3">
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium"
          title={`${thread.cwd}${decorations.get("") ? `：${decorations.get("")!.label}` : ""}`}
        >
          {thread.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? thread.cwd}
        </span>
        {decorations.get("") && (
          <span
            className={`text-xs font-mono ${decorations.get("")!.className}`}
            title={decorations.get("")!.label}
            aria-label={decorations.get("")!.label}
          >
            {decorations.get("")!.badge}
          </span>
        )}
        <button
          type="button"
          className={actionClass}
          aria-label="新建文件"
          title="新建文件"
          onClick={() => beginOperation("file")}
        >
          <FilePlus size={14} />
        </button>
        <button
          type="button"
          className={actionClass}
          aria-label="新建目录"
          title="新建目录"
          onClick={() => beginOperation("directory")}
        >
          <FolderPlus size={14} />
        </button>
        <button
          type="button"
          className={actionClass}
          aria-label="折叠所有文件夹"
          title="折叠所有文件夹"
          disabled={expanded.size <= 1}
          onClick={() => setExpanded(new Set([""]))}
        >
          <ListCollapse size={14} />
        </button>
        <button
          type="button"
          className={actionClass}
          aria-label="刷新项目文件"
          onClick={() => {
            void refreshGit();
            ++directoryGeneration.current;
            setRevision((value) => value + 1);
          }}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="px-3 pb-2">
        <input
          className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-xs"
          aria-label="搜索项目文件"
          placeholder="搜索文件…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {(query.trim()
        ? search.error && search.entries
        : [...expanded].some(
            (path) => directories[path]?.error && directories[path]?.entries,
          )) && (
        <p role="status" className="px-3 pb-2 text-xs text-muted">
          文件列表刷新失败，正在显示上次读取的内容。请刷新重试。
        </p>
      )}
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div
            className="min-h-24 flex-1 overflow-auto pb-3"
            onContextMenu={(event) => {
              if (!prepareMenu(event.target as HTMLElement))
                event.preventDefault();
            }}
            onPointerDown={(event) => {
              if (
                event.pointerType !== "mouse" &&
                !prepareMenu(event.target as HTMLElement)
              )
                event.preventDefault();
            }}
            onKeyDown={(event) => {
              if (
                event.key !== "ContextMenu" &&
                !(event.shiftKey && event.key === "F10")
              )
                return;
              const target = event.target as HTMLElement;
              if (!target.closest("[data-file-entry]")) return;
              event.preventDefault();
              const rect = target.getBoundingClientRect();
              target.dispatchEvent(
                new MouseEvent("contextmenu", {
                  bubbles: true,
                  cancelable: true,
                  clientX: rect.left + 16,
                  clientY: rect.bottom,
                }),
              );
            }}
          >
            {renderEntries(query.trim() ? search : directories[""], 0)}
            {query.trim() && search.entries?.length === 50 && (
              <p className="px-3 py-2 text-xs text-muted">
                显示前 50 个结果，请细化搜索。
              </p>
            )}
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            aria-label="文件操作"
            className="menu-content z-[60] min-w-[180px] rounded-[11px] border border-border bg-elevated p-[5px] text-foreground shadow-xl"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (!operation) menuFocus.current?.focus();
            }}
          >
            {menuEntry && (
              <>
                <ContextMenu.Label className="max-w-64 truncate px-2.5 py-1.5 text-xs text-muted">
                  {menuEntry.path}
                </ContextMenu.Label>
                {menuEntry.file && (
                  <ContextMenu.Item onSelect={() => void open(menuEntry.path)}>
                    打开文件
                  </ContextMenu.Item>
                )}
                <ContextMenu.Item
                  onSelect={() => {
                    if (!navigator.clipboard) {
                      setNotice("当前环境不支持复制路径。");
                      return;
                    }
                    void navigator.clipboard
                      .writeText(menuEntry.path)
                      .then(() => {
                        if (current()) setNotice("已复制相对路径");
                      })
                      .catch(() => {
                        if (current()) setNotice("复制失败，请重试");
                      });
                  }}
                >
                  复制相对路径
                </ContextMenu.Item>
                <ContextMenu.Item
                  onSelect={() => {
                    referenceProjectFile(
                      drafts,
                      thread.id,
                      menuEntry.path,
                      workspacePath(thread.cwd, menuEntry.path),
                    );
                    setNotice("已引用到输入框");
                  }}
                >
                  引用到输入框
                </ContextMenu.Item>
                <ContextMenu.Separator className="my-1 h-px bg-border" />
                <ContextMenu.Item onSelect={() => beginOperation("copy")}>
                  复制{menuEntry.directory ? "目录" : "文件"}
                </ContextMenu.Item>
                <ContextMenu.Item
                  className="text-danger"
                  onSelect={() => beginOperation("delete")}
                >
                  删除{menuEntry.directory ? "目录" : "文件"}
                </ContextMenu.Item>
              </>
            )}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {notice && (
        <p role="status" className="px-3 pb-2 text-xs text-muted">
          {notice}
        </p>
      )}
      {operation && (
        <FileDialog
          titleId="file-operation-title"
          busy={busy}
          onClose={() => setOperation(undefined)}
        >
          <form
            className="file-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setOperationError("");
              void (async () => {
                const target =
                  operation === "delete"
                    ? ""
                    : workspacePath(thread.cwd, destination.trim());
                if (operation === "file") {
                  await files.createFile(target);
                  await files.open({
                    path: target,
                    cwd: thread.cwd,
                    threadId: thread.id,
                  });
                }
                if (operation === "directory")
                  await files.createDirectory(target);
                if (operation === "copy" && selected)
                  await files.copy(
                    workspacePath(thread.cwd, selected),
                    target,
                    selectedDirectory,
                  );
                if (operation === "delete" && selected) {
                  await files.remove(
                    workspacePath(thread.cwd, selected),
                    selectedDirectory,
                  );
                  setSelected(undefined);
                }
                if (current()) setOperation(undefined);
              })()
                .catch((error: unknown) => {
                  if (current()) setOperationError(String(error));
                })
                .finally(() => setBusy(false));
            }}
          >
            <h2 id="file-operation-title">
              {operation === "file"
                ? "新建文件"
                : operation === "directory"
                  ? "新建目录"
                  : operation === "copy"
                    ? "复制到新路径"
                    : "永久删除"}
            </h2>
            {operation === "copy" && (
              <p>复制磁盘上的内容；编辑器内尚未保存的修改不会包含在副本中。</p>
            )}
            {operation === "delete" ? (
              <p>
                将永久删除「{selected}」
                {selectedDirectory ? "及其全部内容" : ""}
                ，无法撤销。如存在未保存修改，请先保存或关闭对应文件。
              </p>
            ) : (
              <label>
                相对于项目根目录的路径
                <input
                  autoFocus
                  required
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                  placeholder="例如 src/example.ts"
                />
              </label>
            )}
            {operationError && <p role="alert">{operationError}</p>}
            <div>
              <Button
                type="button"
                autoFocus={operation === "delete"}
                disabled={busy}
                onClick={() => setOperation(undefined)}
              >
                取消
              </Button>
              <Button
                type="submit"
                variant={operation === "delete" ? "danger" : "primary"}
                disabled={busy}
              >
                {busy
                  ? "处理中…"
                  : operation === "delete"
                    ? "确认永久删除"
                    : "确认"}
              </Button>
            </div>
          </form>
        </FileDialog>
      )}
    </section>
  );
}
