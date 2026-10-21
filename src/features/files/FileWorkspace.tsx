import { settingsInputClass } from "../settings/settings-ui";
import {
  ArrowLeft,
  Columns2,
  Eye,
  FileDiff,
  LoaderCircle,
  MessageSquareQuote,
  Pencil,
  Pin,
  Maximize2,
  PanelsLeftBottom,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import { Button, IconButton, ErrorNotice } from "../../components/ui";
import { useGitBaseline } from "./use-git-baseline";
import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNarrow, useStore } from "../../components/hooks";
import { useRuntime } from "../../lib/runtime-context";
import { referenceProjectFile } from "../shell/project-files";
import "./files.css";
import { FileDialog } from "./FileDialog";
import { FileImagePreview } from "./FileImagePreview";
import { MarkdownPreview } from "./MarkdownPreview";

const MonacoEditor = lazy(() => import("./MonacoEditor"));

class EditorBoundary extends Component<
  { children: ReactNode; text: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <>
          <ErrorNotice className="m-3 shrink-0">
            编辑器加载失败。草稿仍保留在当前工作区；请先复制未保存的内容，再刷新页面重试。
          </ErrorNotice>
          <pre className="file-readonly" tabIndex={0}>
            <code>{this.props.text}</code>
          </pre>
        </>
      );
    return this.props.children;
  }
}

export function FileWorkspace({
  canSplit = false,
  focused = false,
  onToggleFocus,
}: {
  canSplit?: boolean;
  focused?: boolean;
  onToggleFocus?: () => void;
}) {
  const { files, drafts, connection } = useRuntime();
  const connected = useStore(connection).status === "connected";
  const state = useStore(files);
  const narrow = useNarrow();
  const document = state.documents.find((item) => item.id === state.activeId);
  const gitBaseline = useGitBaseline(state.visible ? document : undefined);
  const image = document?.kind === "image";
  const [notice, setNotice] = useState("");
  const [compare, setCompare] = useState<"base" | "disk" | "git" | null>(null);
  const [view, setView] = useState<"edit" | "preview" | "split">("edit");
  const markdown = /\.(md|markdown)$/i.test(document?.path ?? "");
  const gitComparison = document?.gitComparison;
  const baseText = document?.baseText;
  const diskText = document?.diskText;
  const comparison = useMemo(() => {
    if (gitComparison)
      return {
        original: gitComparison.original,
        label: gitComparison.originalLabel,
      };
    const original =
      compare === "git"
        ? gitBaseline?.text
        : compare === "disk"
          ? diskText
          : baseText;
    if (!compare || original === undefined) return undefined;
    return {
      original,
      label:
        compare === "git"
          ? "Git 暂存区"
          : compare === "disk"
            ? "磁盘内容"
            : "上次读取或保存的内容",
    };
  }, [compare, baseText, diskText, gitComparison, gitBaseline?.text]);
  const [saveAs, setSaveAs] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState({
    line: 1,
    column: 1,
    language: "plaintext",
  });
  const run = (operation: Promise<unknown>) => {
    setNotice("");
    void operation.catch((error: unknown) => setNotice(String(error)));
  };
  const save = () => {
    if (
      document &&
      connected &&
      !narrow &&
      !document.readonly &&
      !document.loading &&
      !document.saving &&
      document.dirty
    )
      run(files.save(document.id));
  };
  useEffect(() => {
    if (!state.visible) return;
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });
  useEffect(() => {
    setCompare(null);
    setView("edit");
    setNotice("");
    setSaveAs(undefined);
  }, [state.activeId]);
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background text-inherit"
      style={state.visible ? undefined : { display: "none" }}
      aria-label="文件编辑工作区"
    >
      <header className="file-toolbar">
        <IconButton label="返回会话" onClick={() => files.setVisible(false)}>
          <ArrowLeft size={16} aria-hidden="true" />
        </IconButton>
        <div
          className="flex min-w-[120px] flex-1 self-stretch overflow-x-auto"
          role="tablist"
          aria-label="已打开文件"
        >
          {state.documents.map((item) => (
            <div
              className={`file-tab ${item.id === state.activeId ? "is-active" : ""}`}
              key={item.id}
            >
              <button
                role="tab"
                aria-selected={item.id === state.activeId}
                title={`${item.path}${item.preview ? "（预览，双击固定）" : ""}`}
                className={item.preview ? "is-preview" : undefined}
                onDoubleClick={() => files.pin(item.id)}
                onKeyDown={(event) => {
                  const index = state.documents.findIndex(
                    (doc) => doc.id === item.id,
                  );
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % state.documents.length
                      : event.key === "ArrowLeft"
                        ? (index - 1 + state.documents.length) %
                          state.documents.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? state.documents.length - 1
                            : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  files.select(state.documents[next].id);
                  const tabs = event.currentTarget
                    .closest('[role="tablist"]')
                    ?.querySelectorAll<HTMLElement>('[role="tab"]');
                  tabs?.item(next)?.focus();
                }}
                tabIndex={item.id === state.activeId ? 0 : -1}
                onClick={() => files.select(item.id)}
              >
                {item.dirty ? "● " : ""}
                {item.path.split(/[\\/]/).at(-1)}
                {item.gitComparison
                  ? ` · ${{ staged: "已暂存", unstaged: "未暂存", untracked: "未跟踪", conflict: "冲突" }[item.gitComparison.request.group]}`
                  : ""}
                {item.readonly ? " · 只读" : ""}
              </button>
              <IconButton
                size="sm"
                label={`关闭 ${item.path}`}
                disabled={item.saving}
                onClick={() => {
                  if (
                    !item.dirty ||
                    window.confirm(
                      `关闭 ${item.path} 将丢弃未保存的修改，是否继续？`,
                    )
                  ) {
                    files.close(item.id);
                    if (state.documents.length === 1) files.setVisible(false);
                  }
                }}
              >
                <X size={14} aria-hidden="true" />
              </IconButton>
            </div>
          ))}
        </div>
        {canSplit && onToggleFocus && (
          <IconButton
            label={focused ? "并排查看会话" : "专注编辑"}
            aria-pressed={focused}
            onClick={onToggleFocus}
          >
            {focused ? (
              <PanelsLeftBottom size={16} aria-hidden="true" />
            ) : (
              <Maximize2 size={16} aria-hidden="true" />
            )}
          </IconButton>
        )}
        {document?.preview && (
          <IconButton
            label="固定当前标签"
            onClick={() => files.pin(document.id)}
          >
            <Pin size={16} aria-hidden="true" />
          </IconButton>
        )}
        {document && (
          <>
            <div
              hidden={image}
              style={image ? { display: "none" } : undefined}
              className="flex items-center gap-1"
              role="group"
              aria-label="文件操作"
            >
              <IconButton
                label={document.saving ? "保存中…" : "保存"}
                aria-busy={document.saving}
                disabled={
                  !connected ||
                  narrow ||
                  document.readonly ||
                  !document.dirty ||
                  document.saving ||
                  document.loading
                }
                onClick={save}
              >
                {document.saving ? (
                  <LoaderCircle
                    size={16}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Save size={16} aria-hidden="true" />
                )}
              </IconButton>
              {!narrow && !gitComparison && (
                <IconButton
                  label="比较未保存更改"
                  disabled={!document.dirty || document.loading}
                  onClick={() => {
                    setCompare("base");
                    setView("edit");
                  }}
                >
                  <FileDiff size={16} aria-hidden="true" />
                </IconButton>
              )}
            </div>
            {markdown && !gitComparison && (
              <div
                className="file-view-modes"
                role="group"
                aria-label="Markdown 显示方式"
              >
                {(
                  [
                    ["edit", "编辑", Pencil],
                    ["preview", "预览", Eye],
                    ["split", "分屏", Columns2],
                  ] as const
                ).map(([mode, label, Icon]) => (
                  <IconButton
                    key={mode}
                    label={label}
                    aria-pressed={view === mode}
                    className="aria-pressed:bg-selected aria-pressed:text-accent"
                    onClick={() => {
                      setView(mode);
                      setCompare(null);
                    }}
                  >
                    <Icon size={16} aria-hidden="true" />
                  </IconButton>
                ))}
              </div>
            )}
            <IconButton
              label="重新加载"
              disabled={!connected || document.loading || document.saving}
              onClick={() => {
                if (
                  !document.dirty ||
                  window.confirm(
                    "重新加载将丢弃这个文件尚未保存的修改，是否继续？",
                  )
                )
                  run(files.reload(document.id));
              }}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </IconButton>
          </>
        )}
      </header>
      {document ? (
        <>
          <div className="file-breadcrumb" title={document.path}>
            <span>{document.path.split(/[\\/]/).join(" / ")}</span>
            {document.threadId && (
              <IconButton
                label="引用到来源会话"
                onClick={() => {
                  referenceProjectFile(
                    drafts,
                    document.threadId!,
                    document.path,
                    document.path,
                  );
                  setNotice("已引用到来源会话的输入框");
                }}
              >
                <MessageSquareQuote size={16} aria-hidden="true" />
              </IconButton>
            )}
          </div>
          {state.recoveryError && (
            <ErrorNotice className="m-3 shrink-0">
              {state.recoveryError}
            </ErrorNotice>
          )}
          {document.recovered && (
            <p className="file-notice" role="status">
              已从浏览器恢复未保存的编辑内容，尚未写入文件。保存前会重新核对磁盘内容。
            </p>
          )}
          {document.conflict && (
            <div className="file-notice" role="alert">
              磁盘文件已改变。请比较内容，重新加载或另存为新文件。
              {!narrow && (
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={document.diskText === undefined}
                  onClick={() => {
                    setCompare("disk");
                    setView("edit");
                  }}
                >
                  比较磁盘内容
                </Button>
              )}
              {document.diskText === undefined &&
                " 磁盘内容不可用，请重新加载或另存为。"}
              {!narrow && (
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={!connected}
                  onClick={() => setSaveAs(`${document.path}.copy`)}
                >
                  另存为
                </Button>
              )}
            </div>
          )}
          {document.error ? (
            <ErrorNotice className="m-3 shrink-0">{document.error}</ErrorNotice>
          ) : (
            notice && (
              <p className="file-notice" role="status">
                {notice}
              </p>
            )
          )}
          {comparison && (
            <div className="file-comparison-labels">
              <strong>{comparison.label}（只读）</strong>
              <strong>
                {gitComparison
                  ? `${gitComparison.modifiedLabel}（只读）`
                  : "当前编辑内容"}
              </strong>
              {gitComparison ? (
                gitComparison.canOpen && (
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() =>
                      run(
                        files.open({
                          path: document.path,
                          cwd: document.cwd,
                          threadId: document.threadId,
                        }),
                      )
                    }
                  >
                    编辑当前文件
                  </Button>
                )
              ) : (
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => setCompare(null)}
                >
                  返回编辑
                </Button>
              )}
            </div>
          )}
          {!connected && (
            <p className="file-notice" role="status">
              {image
                ? "连接已断开。当前图片仍可查看，重新连接后可刷新。"
                : "连接已断开。可继续编辑草稿，重新连接后再保存。"}
            </p>
          )}
          {document.loading && <p className="file-notice">正在读取文件…</p>}
          <div
            className={`relative flex min-h-0 min-w-0 flex-1 ${markdown && !comparison ? `file-view-${view}` : "file-view-edit"}`}
          >
            <div
              style={image ? { display: "none" } : undefined}
              className={`file-editor-pane${comparison ? " file-comparison" : ""}`}
              aria-hidden={
                markdown && view === "preview" && !comparison ? true : undefined
              }
            >
              {narrow ? (
                <pre className="file-readonly" tabIndex={0}>
                  {gitComparison && (
                    <>
                      原版本：{gitComparison.originalLabel}
                      {"\n"}
                      {gitComparison.original}
                      {"\n\n"}新版本：{gitComparison.modifiedLabel}
                      {"\n"}
                    </>
                  )}
                  <code>
                    {document.text || (document.error ? "" : "（空文件）")}
                  </code>
                </pre>
              ) : (
                <EditorBoundary text={document.text}>
                  <Suspense
                    fallback={<p className="file-notice">正在加载编辑器…</p>}
                  >
                    <MonacoEditor
                      comparison={comparison}
                      gitBaseline={gitBaseline?.text}
                      onGitCompare={() => {
                        setCompare("git");
                        setView("edit");
                      }}
                      document={document}
                      documents={state.documents}
                      onChange={(id, text) => files.setText(id, text)}
                      onSave={save}
                      onPosition={(line, column, language) =>
                        setPosition((previous) =>
                          previous.line === line &&
                          previous.column === column &&
                          previous.language === language
                            ? previous
                            : { line, column, language },
                        )
                      }
                    />
                  </Suspense>
                </EditorBoundary>
              )}
            </div>
            {image && (
              <FileImagePreview
                key={document.id}
                url={document.imageUrl}
                path={document.path}
              />
            )}
            {markdown && view !== "edit" && !comparison && (
              <MarkdownPreview
                text={document.text}
                path={document.path}
                threadId={document.threadId}
              />
            )}
          </div>
          <footer className="file-status">
            <div className="file-status-group">
              <span
                title={
                  gitComparison
                    ? "Git 只读快照，不含未保存草稿；重新加载可更新差异。"
                    : document.readonly || narrow
                      ? undefined
                      : "⌘ / Ctrl S 保存"
                }
              >
                {image
                  ? "图片预览"
                  : gitComparison
                    ? "Git 快照"
                    : document.dirty
                      ? "未保存"
                      : "已保存"}
              </span>
              {!gitComparison && gitBaseline?.text !== undefined && (
                <span
                  tabIndex={0}
                  title="对比 Git 暂存区。绿色：新增；蓝色：修改；红色：删除。包含未保存草稿，点击左侧标记查看差异。"
                >
                  Git 行标记
                </span>
              )}
              {gitBaseline?.error && (
                <span tabIndex={0} title={gitBaseline.error}>
                  Git 行标记不可用
                </span>
              )}
              {(document.readonly || narrow) && <span>只读</span>}
            </div>
            <div className="file-status-group ml-auto">
              {!image && <span>UTF-8</span>}
              {!narrow && !image && (
                <>
                  <span>{position.language}</span>
                  <span>
                    第 {position.line} 行，第 {position.column} 列
                  </span>
                </>
              )}
            </div>
          </footer>
        </>
      ) : (
        <p className="file-notice">
          从项目文件树打开文件，或返回会话继续工作。
        </p>
      )}
      {saveAs !== undefined && document && (
        <FileDialog
          titleId="save-as-title"
          busy={busy}
          onClose={() => setSaveAs(undefined)}
        >
          <form
            className="file-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              if (!connected || busy) return;
              setBusy(true);
              setNotice("");
              void files
                .createFile(saveAs, document.text)
                .then(() =>
                  files.open({
                    path: saveAs,
                    cwd: document.cwd,
                    threadId: document.threadId,
                  }),
                )
                .then(() => setSaveAs(undefined))
                .catch((error: unknown) => setNotice(String(error)))
                .finally(() => setBusy(false));
            }}
          >
            <h2 id="save-as-title">另存为新文件</h2>
            <label>
              新文件绝对路径
              <input
                className={`${settingsInputClass} mt-1.5`}
                autoFocus
                required
                value={saveAs}
                onChange={(event) => setSaveAs(event.target.value)}
              />
            </label>
            {notice && <ErrorNotice>{notice}</ErrorNotice>}
            <div className="file-dialog-actions">
              <Button
                type="button"
                disabled={busy}
                onClick={() => setSaveAs(undefined)}
              >
                取消
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={busy || !connected}
              >
                {busy ? "正在保存…" : "创建副本"}
              </Button>
            </div>
          </form>
        </FileDialog>
      )}
    </section>
  );
}
