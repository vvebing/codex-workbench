import { settingsInputClass } from "../settings/settings-ui";
import {
  Button,
  IconButton,
  ErrorNotice,
  ScrollArea,
} from "../../components/ui";
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
  Upload,
  LocateFixed,
} from "lucide-react";
import { ContextMenu } from "radix-ui";
import { useStore } from "../../components/hooks";
import { useRuntime } from "../../lib/runtime-context";
import type { Thread } from "../../generated/v2/Thread";
import {
  workspaceDirectories,
  type DirectoryEntry as Entry,
  type DirectoryListing as Listing,
} from "./workspace-directories";
import { searchWorkspaceFiles } from "../composer/file-search";
import { referenceProjectFile, workspacePath } from "./project-files";

import { useWorkspaceGitStatus } from "./workspace-git";
import { treeGitDecorations } from "./tree-git";
import { watchWorkspace } from "./workspace-watch";
import "../files/files.css";
import { relativeWorkspaceFile } from "../files/tree-navigation";
import { FileDialog } from "../files/FileDialog";
import {
  uploadProjectFile,
  saveDownload,
  type ConflictChoice,
} from "../files/file-transfer";

export function FilesPanel({ thread }: { thread: Thread }) {
  const { connection } = useRuntime();
  const { epoch, scope, status } = useStore(connection);
  if (status !== "connected")
    return <p className="p-4 text-xs text-muted">连接环境后可浏览项目文件。</p>;
  if (!thread.cwd)
    return <p className="p-4 text-xs text-muted">当前会话没有项目目录。</p>;
  return (
    <ConnectedFiles
      key={JSON.stringify([epoch, scope, thread.cwd, thread.id])}
      thread={thread}
    />
  );
}

function ConnectedFiles({ thread }: { thread: Thread }) {
  const { connection, drafts, files } = useRuntime();
  const fileState = useStore(files);
  const fileRevision = useSyncExternalStore(
    files.subscribe,
    () => files.getSnapshot().revision,
  );
  const git = useWorkspaceGitStatus(thread.cwd);
  const refreshGit = git.refresh;
  const gitDirectory =
    git.value?.repoRoot && git.workspacePrefix !== undefined
      ? `${git.value.repoRoot.replace(/\/$/, "")}/${git.workspacePrefix}`
      : thread.cwd;
  const decorations = useMemo(
    () => treeGitDecorations(git.value, gitDirectory),
    [git.value, gitDirectory],
  );
  const cache = useMemo(
    () => workspaceDirectories(connection, thread.cwd),
    [connection, thread.cwd],
  );
  const directories = useSyncExternalStore(cache.subscribe, cache.getSnapshot);
  const [expanded, setExpanded] = useState<Set<string>>(cache.expanded);
  const [query, setQuery] = useState(cache.query);
  const [search, setSearch] = useState<Listing>({});
  const [revision, setRevision] = useState(cache.revision);
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
  const [followEditor, setFollowEditor] = useState(() => {
    try {
      return (
        localStorage.getItem("codex-workbench-files-follow-editor") !== "false"
      );
    } catch {
      return true;
    }
  });
  const revealHandled = useRef(cache.handledReveal);
  const pendingScroll = useRef<string | undefined>(undefined);
  const followedPath = useRef(cache.followedEditorPath);
  const [menuEntry, setMenuEntry] = useState<Entry>();
  const menuFocus = useRef<HTMLElement | null>(null);
  const [selected, setSelected] = useState<string | undefined>(cache.selected);
  const [selectedDirectory, setSelectedDirectory] = useState(
    cache.selectedDirectory,
  );
  const [operation, setOperation] = useState<
    "file" | "directory" | "copy" | "delete"
  >();
  const [destination, setDestination] = useState("");
  const [operationError, setOperationError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const uploadInput = useRef<HTMLInputElement>(null);
  const uploadDirectory = useRef("");
  const transferPending = useRef(false);
  const [transferring, setTransferring] = useState(false);
  const [dropDirectory, setDropDirectory] = useState<string>();
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [conflict, setConflict] = useState<{
    path: string;
    directory: boolean;
    resolve: (choice: ConflictChoice) => void;
  }>();
  const conflictResolver = useRef<
    ((choice: ConflictChoice) => void) | undefined
  >(undefined);
  const [downloadPath, setDownloadPath] = useState<string>();
  const active = useRef(true);
  const directoryGeneration = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    cache.expanded = expanded;
    cache.query = query;
    cache.selected = selected;
    cache.selectedDirectory = selectedDirectory;
  }, [cache, expanded, query, selected, selectedDirectory]);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = cache.scrollTop;
  }, [cache]);
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
      conflictResolver.current?.("cancel");
    };
  }, []);

  useEffect(() => {
    cache.revision = revision;
    for (const relative of expanded) void cache.read(relative, revision);
  }, [cache, expanded, revision]);

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

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      cache.invalidate();
      ++directoryGeneration.current;
      setRevision((value) => value + 1);
    };
    const off = watchWorkspace(connection, thread.cwd, refresh);
    const timer = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      off();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [cache, connection, thread.cwd]);

  useEffect(() => {
    if (
      cache.consumeFileRevision(fileRevision, files.getSnapshot().changedPaths)
    ) {
      ++directoryGeneration.current;
      setRevision(cache.revision);
    }
  }, [cache, files, fileRevision]);

  const reveal = fileState.revealRequest;
  const activeDocument = fileState.documents.find(
    (doc) => doc.id === fileState.activeId,
  );
  const followPath =
    followEditor && fileState.visible && !query.trim() && activeDocument
      ? relativeWorkspaceFile(thread.cwd, activeDocument.path)
      : undefined;
  useEffect(() => {
    const explicit =
      reveal &&
      revealHandled.current !== reveal &&
      reveal.cwd.replace(/\\/g, "/").replace(/\/$/, "") ===
        thread.cwd.replace(/\\/g, "/").replace(/\/$/, "");
    const path = explicit
      ? relativeWorkspaceFile(thread.cwd, reveal.path)
      : followPath;
    if (explicit) {
      revealHandled.current = reveal;
      cache.handledReveal = reveal;
    }
    if (!explicit && path === followedPath.current) return;
    followedPath.current = path;
    cache.followedEditorPath = path;
    if (!path) return;
    if (explicit) {
      setQuery("");
      setNotice("");
    }
    setSelected(path);
    setSelectedDirectory(false);
    const ancestors = new Set([""]);
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index++)
      ancestors.add(parts.slice(0, index).join("/"));
    setExpanded((previous) => new Set([...previous, ...ancestors]));
    pendingScroll.current = path;
    let stopped = false;
    void Promise.all(
      [...ancestors].map((directory) => cache.read(directory, revision)),
    ).then(() => {
      if (stopped || !explicit) return;
      const parent = parts.slice(0, -1).join("/");
      const listing = cache.getSnapshot()[parent];
      if (
        listing?.entries &&
        !listing.entries.some((entry) => entry.path === path)
      )
        setNotice("文件已不存在，无法在文件列表中显示。");
      else if (listing?.error) setNotice(`无法定位文件：${listing.error}`);
    });
    return () => {
      stopped = true;
    };
  }, [cache, followPath, reveal, revision, thread.cwd]);
  useEffect(() => {
    const path = pendingScroll.current;
    if (!path) return;
    const row = Array.from(
      scroll.current?.querySelectorAll<HTMLElement>("[data-file-entry]") ?? [],
    ).find((element) => element.dataset.fileEntry === path);
    if (row) {
      row.scrollIntoView?.({ block: "nearest" });
      pendingScroll.current = undefined;
    }
  }, [directories, expanded, query]);

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
  const creationDirectory = selected
    ? selectedDirectory
      ? selected
      : selected.replace(/\\/g, "/").split("/").slice(0, -1).join("/")
    : "";
  const transferCheck = () => {
    if (!current()) throw new Error("连接环境已改变，请重新操作。");
  };
  const receiveFiles = async (incoming: File[], directory: string) => {
    if (transferPending.current || !incoming.length) return;
    transferPending.current = true;
    setTransferring(true);
    setUploaded([]);
    const completed: string[] = [];
    const errors: string[] = [];
    try {
      for (let index = 0; index < incoming.length; index++) {
        transferCheck();
        setNotice(
          `正在上传 ${index + 1}/${incoming.length}：${incoming[index].name} → ${directory || "项目根目录"}`,
        );
        try {
          const relative = await uploadProjectFile(
            connection.client,
            thread.cwd,
            directory,
            incoming[index],
            (path, isDirectory) =>
              new Promise((resolve) => {
                conflictResolver.current = resolve;
                setConflict({
                  path,
                  directory:
                    isDirectory ||
                    files
                      .getSnapshot()
                      .documents.some(
                        (doc) =>
                          doc.path === workspacePath(thread.cwd, path) &&
                          (doc.dirty || doc.saving),
                      ),
                  resolve,
                });
              }),
            transferCheck,
          );
          if (relative) completed.push(relative);
        } catch (error) {
          transferCheck();
          errors.push(String(error));
        }
      }
    } catch (error) {
      if (current()) errors.push(String(error));
    } finally {
      transferPending.current = false;
      if (current()) {
        setTransferring(false);
        setUploaded(completed);
        setNotice(
          `已上传 ${completed.length} 个文件${errors.length ? `；${errors.join("；")}` : ""}`,
        );
        cache.invalidate();
        setRevision((value) => value + 1);
        void refreshGit();
        if (completed.length) {
          setSelected(completed.at(-1));
          setSelectedDirectory(false);
          setQuery("");
          setExpanded((old) => {
            const next = new Set(old);
            const parts = directory.split("/");
            for (let i = 1; i <= parts.length; i++)
              next.add(parts.slice(0, i).join("/"));
            return next;
          });
          for (const doc of files.getSnapshot().documents)
            if (
              !doc.dirty &&
              completed.some(
                (path) => workspacePath(thread.cwd, path) === doc.path,
              )
            )
              void files.reload(doc.id);
        }
      }
    }
  };
  const chooseUpload = (directory: string) => {
    uploadDirectory.current = directory;
    uploadInput.current?.click();
  };
  const download = async (relative: string, save = false) => {
    if (transferPending.current) return;
    transferPending.current = true;
    setTransferring(true);
    try {
      const path = workspacePath(thread.cwd, relative);
      const doc = files
        .getSnapshot()
        .documents.find((item) => item.path === path && !item.gitComparison);
      if (save && doc?.dirty) {
        await files.save(doc.id);
        transferCheck();
        const updated = files
          .getSnapshot()
          .documents.find((item) => item.id === doc.id);
        if (updated?.dirty || updated?.error)
          throw new Error(updated.error || "保存未完成，请检查编辑器。");
      }
      const response = await connection.client.request<{ dataBase64: string }>(
        "fs/readFile",
        { path },
      );
      transferCheck();
      saveDownload(response.dataBase64, relative.split("/").at(-1)!);
      setDownloadPath(undefined);
      setNotice(`已下载：${relative}`);
    } catch (error) {
      if (current()) setNotice(`下载失败：${String(error)}`);
    } finally {
      transferPending.current = false;
      if (current()) setTransferring(false);
    }
  };
  const beginDownload = (relative: string) => {
    if (
      files
        .getSnapshot()
        .documents.some(
          (doc) =>
            doc.path === workspacePath(thread.cwd, relative) && doc.dirty,
        )
    )
      setDownloadPath(relative);
    else void download(relative);
  };
  const beginOperation = (kind: "file" | "directory" | "copy" | "delete") => {
    setOperation(kind);
    setOperationError("");
    setDestination(
      kind === "copy"
        ? `${selected ?? ""}.copy`
        : kind !== "delete" && creationDirectory
          ? `${creationDirectory}/`
          : "",
    );
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
        <ErrorNotice className="mx-3 my-2">
          读取失败：{listing.error}。请刷新重试。
        </ErrorNotice>
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
            className={`group flex items-center rounded hover:bg-hover ${dropDirectory === entry.path ? "ring-1 ring-accent bg-selected" : selected === entry.path ? "bg-selected" : ""}`}
            draggable={entry.file}
            onDragStart={(event) => {
              if (!entry.file) return;
              event.dataTransfer.setData(
                "application/x-codex-workbench-file",
                JSON.stringify({
                  path: workspacePath(thread.cwd, entry.path),
                  relative: entry.path,
                  cwd: thread.cwd,
                }),
              );
              event.dataTransfer.effectAllowed = "copy";
            }}
            data-selected={selected === entry.path || undefined}
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
              aria-pressed={selected === entry.path}
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
                  className="ml-auto shrink-0 font-mono text-fine"
                >
                  {decoration.badge}
                </span>
              )}
            </button>
            <IconButton
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-[900px]:opacity-100"
              label={`更多操作：${entry.path}`}
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
            </IconButton>
          </div>
          {entry.directory &&
            expanded.has(entry.path) &&
            renderEntries(directories[entry.path], depth + 1)}
        </div>
      );
    });
  };
  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-label="项目文件"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = transferring ? "none" : "copy";
        const row = (event.target as HTMLElement).closest<HTMLElement>(
          '[data-directory="true"]',
        );
        setDropDirectory(row?.dataset.fileEntry ?? "");
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDropDirectory(undefined);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        const row = (event.target as HTMLElement).closest<HTMLElement>(
          '[data-directory="true"]',
        );
        const directory = row?.dataset.fileEntry ?? "";
        setDropDirectory(undefined);
        void receiveFiles(Array.from(event.dataTransfer.files), directory);
      }}
    >
      <input
        ref={uploadInput}
        type="file"
        multiple
        hidden
        aria-label="选择上传文件"
        onChange={(event) => {
          const incoming = Array.from(event.target.files ?? []);
          event.target.value = "";
          void receiveFiles(incoming, uploadDirectory.current);
        }}
      />
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          aria-label="选择项目根目录"
          aria-pressed={selected === undefined}
          onClick={() => {
            setSelected(undefined);
            setSelectedDirectory(false);
          }}
          className={`min-w-0 flex-1 truncate rounded px-1 text-left text-xs font-medium hover:bg-hover ${selected === undefined ? "bg-selected" : ""}`}
          title={`${thread.cwd}${decorations.get("") ? `：${decorations.get("")!.label}` : ""}`}
        >
          {thread.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? thread.cwd}
        </button>
        {decorations.get("") && (
          <span
            className={`text-xs font-mono ${decorations.get("")!.className}`}
            title={decorations.get("")!.label}
            aria-label={decorations.get("")!.label}
          >
            {decorations.get("")!.badge}
          </span>
        )}
        <IconButton
          label="上传文件"
          title={`上传到：${creationDirectory || "项目根目录"}（每个文件最多 8 MB）`}
          disabled={transferring}
          onClick={() => chooseUpload(creationDirectory)}
        >
          <Upload size={14} />
        </IconButton>
        <IconButton
          label="新建文件"
          title={`新建文件于：${creationDirectory || "项目根目录"}`}
          onClick={() => beginOperation("file")}
        >
          <FilePlus size={14} />
        </IconButton>
        <IconButton
          label="新建目录"
          title={`新建目录于：${creationDirectory || "项目根目录"}`}
          onClick={() => beginOperation("directory")}
        >
          <FolderPlus size={14} />
        </IconButton>
        <IconButton
          label="跟随当前编辑器"
          title="跟随当前编辑器"
          aria-pressed={followEditor}
          onClick={() => {
            setFollowEditor((value) => {
              try {
                localStorage.setItem(
                  "codex-workbench-files-follow-editor",
                  String(!value),
                );
              } catch {
                /* optional */
              }
              return !value;
            });
          }}
        >
          <LocateFixed size={14} />
        </IconButton>
        <IconButton
          label="折叠所有文件夹"
          title="折叠所有文件夹"
          disabled={expanded.size <= 1}
          onClick={() => setExpanded(new Set([""]))}
        >
          <ListCollapse size={14} />
        </IconButton>
        <IconButton
          label="刷新项目文件"
          onClick={() => {
            void refreshGit();
            ++directoryGeneration.current;
            setRevision((value) => value + 1);
          }}
        >
          <RefreshCw size={14} />
        </IconButton>
      </div>
      {dropDirectory !== undefined && (
        <p role="status" className="px-3 pb-2 text-xs text-accent">
          释放以上传到：{dropDirectory || "项目根目录"}
        </p>
      )}
      <div className="px-3 pb-2">
        <input
          className={settingsInputClass}
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
          <ScrollArea
            viewportRef={scroll}
            viewportProps={{
              className: "pb-3",
              onScroll: (event) => {
                cache.scrollTop = event.currentTarget.scrollTop;
              },
            }}
            className="min-h-24 flex-1"
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
          </ScrollArea>
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
                {menuEntry.directory && (
                  <ContextMenu.Item
                    disabled={transferring}
                    onSelect={() => chooseUpload(menuEntry.path)}
                  >
                    上传到此目录
                  </ContextMenu.Item>
                )}
                {menuEntry.file && (
                  <ContextMenu.Item
                    disabled={transferring}
                    onSelect={() => beginDownload(menuEntry.path)}
                  >
                    下载文件
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
      {uploaded.length > 0 && (
        <div className="px-3 pb-2">
          <Button
            onClick={() => {
              for (const path of uploaded)
                referenceProjectFile(
                  drafts,
                  thread.id,
                  path,
                  workspacePath(thread.cwd, path),
                );
              setNotice(`已将 ${uploaded.length} 个文件添加到会话`);
              setUploaded([]);
            }}
          >
            添加上传文件到会话
          </Button>
        </div>
      )}
      {conflict && (
        <FileDialog
          title="文件已存在"
          busy={false}
          onClose={() => {
            conflict.resolve("cancel");
            conflictResolver.current = undefined;
            setConflict(undefined);
          }}
        >
          <div className="file-dialog">
            <p>目标路径「{conflict.path}」已存在。请选择如何处理当前文件。</p>
            {conflict.directory && (
              <p>
                目标是目录、特殊文件，或编辑器中有未保存修改，不能直接替换。
              </p>
            )}
            <div className="file-dialog-actions">
              {(["cancel", "keep", "replace"] as const).map((choice) => (
                <Button
                  key={choice}
                  disabled={choice === "replace" && conflict.directory}
                  onClick={() => {
                    conflict.resolve(choice);
                    conflictResolver.current = undefined;
                    setConflict(undefined);
                  }}
                >
                  {choice === "cancel"
                    ? "跳过此文件"
                    : choice === "keep"
                      ? "保留两者"
                      : "替换"}
                </Button>
              ))}
            </div>
          </div>
        </FileDialog>
      )}
      {downloadPath && (
        <FileDialog
          title="文件有未保存修改"
          busy={transferring}
          onClose={() => setDownloadPath(undefined)}
        >
          <div className="file-dialog">
            <p>「{downloadPath}」有未保存修改。请选择要下载的版本。</p>
            <div className="file-dialog-actions">
              <Button
                disabled={transferring}
                onClick={() => setDownloadPath(undefined)}
              >
                取消
              </Button>
              <Button
                disabled={transferring}
                onClick={() => void download(downloadPath)}
              >
                下载已保存版本
              </Button>
              <Button
                disabled={transferring}
                onClick={() => void download(downloadPath, true)}
              >
                保存并下载
              </Button>
            </div>
          </div>
        </FileDialog>
      )}
      {operation && (
        <FileDialog
          title={
            operation === "file"
              ? "新建文件"
              : operation === "directory"
                ? "新建目录"
                : operation === "copy"
                  ? "复制到新路径"
                  : "永久删除"
          }
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
                if (current()) {
                  if (operation === "file" || operation === "directory") {
                    const relative = destination.trim().replace(/\\/g, "/");
                    setSelected(relative);
                    setSelectedDirectory(operation === "directory");
                    setExpanded((old) => {
                      const next = new Set(old);
                      const parts = relative.split("/");
                      for (let i = 1; i < parts.length; i++)
                        next.add(parts.slice(0, i).join("/"));
                      if (operation === "directory") next.add(relative);
                      return next;
                    });
                    setQuery("");
                    setNotice(
                      `已创建${operation === "file" ? "文件" : "目录"}：${relative}`,
                    );
                  }
                  setOperation(undefined);
                }
              })()
                .catch((error: unknown) => {
                  if (current()) setOperationError(String(error));
                })
                .finally(() => setBusy(false));
            }}
          >
            {(operation === "file" || operation === "directory") && (
              <p>
                创建位置：{creationDirectory || "项目根目录"}
                。可修改下方完整路径。
              </p>
            )}
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
                  className={`${settingsInputClass} mt-1.5`}
                  autoFocus
                  required
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                  placeholder="例如 src/example.ts"
                />
              </label>
            )}
            {operationError && <ErrorNotice>{operationError}</ErrorNotice>}
            <div className="file-dialog-actions">
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
