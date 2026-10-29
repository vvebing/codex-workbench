import { t, useLocale } from "../../lib/i18n";
import { ContextMenu } from "radix-ui";
import { settingsInputClass } from "../settings/settings-ui";
import {
  ArrowLeft,
  Columns2,
  Eye,
  FileDiff,
  FolderSearch,
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
import {
  Button,
  IconButton,
  ErrorNotice,
  ScrollArea,
} from "../../components/ui";
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
import { textDocument } from "../composer/editor-document";
import { referenceProjectFile } from "../shell/project-files";
import "./files.css";
import {
  isLargeFile,
  DEFAULT_FILE_LIMITS,
  formatFileSize,
} from "./file-limits";
import { relativeWorkspaceFile } from "./tree-navigation";
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
            {t(
              "编辑器加载失败。草稿仍保留在当前工作区；请先复制未保存的内容，再刷新页面重试。",
            )}
          </ErrorNotice>
          <ScrollArea orientation="both" className="flex-1">
            <pre className="file-readonly" tabIndex={0}>
              <code>
                {this.props.text.slice(0, 64 * 1024)}
                {this.props.text.length > 64 * 1024
                  ? t("\n（仅显示前 64 KB，请重新打开编辑器或下载文件查看）")
                  : ""}
              </code>
            </pre>
          </ScrollArea>
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
  const i18nLocale = useLocale();
  void i18nLocale;

  const { files, drafts, connection, sessions } = useRuntime();
  const sessionState = useStore(sessions);
  const currentCwd = sessionState.selectedId
    ? sessionState.threads[sessionState.selectedId]?.cwd
    : undefined;
  const connected = useStore(connection).status === "connected";
  const state = useStore(files);
  const limits = state.limits ?? DEFAULT_FILE_LIMITS;
  const narrow = useNarrow();
  const document = state.documents.find((item) => item.id === state.activeId);
  const largeFile =
    !!document &&
    (document.largeFile ??
      isLargeFile(document.text, document.byteLength, limits.normalBytes));
  const byteLength = useMemo(
    () => (
      void i18nLocale,
      document?.byteLength ??
        new TextEncoder().encode(document?.text ?? "").length
    ),
    [document?.byteLength, document?.text, i18nLocale],
  );
  const sizeLabel = formatFileSize(byteLength);
  const largeReadonly =
    largeFile && !!document?.readonly && byteLength > limits.editableBytes;
  const gitBaseline = useGitBaseline(
    state.visible ? document : undefined,
    limits,
  );
  const image = document?.kind === "image";
  const [selection, setSelection] = useState<{
    text: string;
    startLine: number;
    endLine: number;
    tooLarge?: boolean;
  }>();
  const [notice, setNotice] = useState("");
  const [compare, setCompare] = useState<"base" | "disk" | "git" | null>(null);
  const [view, setView] = useState<"edit" | "preview" | "split">("edit");
  const markdown = !largeFile && /\.(md|markdown)$/i.test(document?.path ?? "");
  const gitComparison = document?.gitComparison;
  const baseText = document?.baseText;
  const diskText = document?.diskText;
  const requestedComparison = useMemo(() => {
    void i18nLocale;

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
          ? t("Git 暂存区")
          : compare === "disk"
            ? t("磁盘内容")
            : t("上次读取或保存的内容"),
    };
  }, [
    compare,
    baseText,
    diskText,
    gitComparison,
    gitBaseline?.text,
    i18nLocale,
  ]);
  const comparisonTooLarge = useMemo(
    () =>
      !!requestedComparison &&
      (byteLength > limits.diffBytes ||
        new TextEncoder().encode(requestedComparison.original).length >
          limits.diffBytes),
    [requestedComparison, byteLength, limits.diffBytes],
  );
  const comparison = comparisonTooLarge ? undefined : requestedComparison;
  const [saveAs, setSaveAs] = useState<string>();
  const [discard, setDiscard] = useState<{
    type: "close" | "reload";
    id: string;
    path: string;
    ids?: string[];
  }>();
  const discardTarget = state.documents.find((item) => item.id === discard?.id);
  const discardTargets = state.documents.filter((item) =>
    discard?.ids ? discard.ids.includes(item.id) : item.id === discard?.id,
  );
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
  const closeFile = (id: string) => {
    files.close(id);
    if (!files.getSnapshot().documents.length) files.setVisible(false);
  };
  const requestClose = (ids: string[]) => {
    const targets = files
      .getSnapshot()
      .documents.filter((item) => ids.includes(item.id));
    if (!targets.length || targets.some((item) => item.saving)) return;
    const dirty = targets.find((item) => item.dirty);
    if (dirty) {
      setDiscard({
        type: "close",
        id: dirty.id,
        path: dirty.path,
        ids: targets.map((item) => item.id),
      });
      return;
    }
    targets.forEach((item) => closeFile(item.id));
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
    setSelection(undefined);
    setNotice("");
    setSaveAs(undefined);
  }, [state.activeId]);
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background text-inherit"
      style={state.visible ? undefined : { display: "none" }}
      aria-label={t("文件编辑工作区")}
    >
      <header className="file-toolbar">
        <div className="file-tabs-row">
          <IconButton
            label={t("返回会话")}
            onClick={() => files.setVisible(false)}
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </IconButton>
          <ScrollArea
            orientation="horizontal"
            className="min-w-[120px] flex-1 self-stretch"
          >
            <div
              className="flex w-max min-w-full"
              role="tablist"
              aria-label={t("已打开文件")}
            >
              {state.documents.map((item, index) => (
                <ContextMenu.Root key={item.id}>
                  <ContextMenu.Trigger asChild>
                    <div
                      className={`file-tab ${item.id === state.activeId ? "is-active" : ""}`}
                    >
                      <button
                        role="tab"
                        aria-selected={item.id === state.activeId}
                        title={t("{{value0}}{{value1}}", {
                          value0: item.path,
                          value1: item.preview ? t("（预览，双击固定）") : "",
                        })}
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
                          ? t(" · {{value0}}", {
                              value0: {
                                staged: t("已暂存"),
                                unstaged: t("未暂存"),
                                untracked: t("未跟踪"),
                                conflict: t("冲突"),
                              }[item.gitComparison.request.group],
                            })
                          : ""}
                        {item.readonly ? t(" · 只读") : ""}
                      </button>
                      <IconButton
                        size="sm"
                        label={t("关闭 {{value0}}", { value0: item.path })}
                        disabled={item.saving}
                        onClick={() => requestClose([item.id])}
                      >
                        <X size={14} aria-hidden="true" />
                      </IconButton>
                    </div>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content className="z-50 min-w-40 rounded-lg border border-border bg-surface p-1 shadow-xl">
                      {[
                        { label: t("关闭标签页"), documents: [item] },
                        {
                          label: t("关闭其他标签页"),
                          documents: state.documents.filter(
                            (entry) => entry.id !== item.id,
                          ),
                        },
                        {
                          label: t("关闭右侧标签页"),
                          documents: state.documents.slice(index + 1),
                        },
                        {
                          label: t("关闭所有标签页"),
                          documents: state.documents,
                        },
                      ].map((command) => (
                        <ContextMenu.Item
                          key={command.label}
                          className="cursor-default rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-hover data-[disabled]:opacity-50"
                          disabled={
                            !command.documents.length ||
                            command.documents.some((entry) => entry.saving)
                          }
                          onSelect={() =>
                            requestClose(
                              command.documents.map((entry) => entry.id),
                            )
                          }
                        >
                          {command.label}
                        </ContextMenu.Item>
                      ))}
                      <ContextMenu.Separator className="my-1 h-px bg-border" />
                      <ContextMenu.Item
                        className="cursor-default rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-hover data-[disabled]:opacity-50"
                        disabled={
                          !connected ||
                          !currentCwd ||
                          !relativeWorkspaceFile(currentCwd, item.path)
                        }
                        onSelect={() => files.revealInTree(item.id)}
                      >
                        {t("在文件列表中显示")}
                      </ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
              ))}
            </div>
          </ScrollArea>
          {canSplit && onToggleFocus && (
            <IconButton
              label={focused ? t("并排查看会话") : t("专注编辑")}
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
              label={t("固定当前标签")}
              onClick={() => files.pin(document.id)}
            >
              <Pin size={16} aria-hidden="true" />
            </IconButton>
          )}
        </div>
        {document && (
          <div className="file-document-actions">
            <div
              hidden={image}
              style={image ? { display: "none" } : undefined}
              className="flex items-center gap-1"
              role="group"
              aria-label={t("文件操作")}
            >
              <IconButton
                label={document.saving ? t("保存中…") : t("保存")}
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
              {!gitComparison && (
                <IconButton
                  label={t("比较未保存更改")}
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
                aria-label={t("Markdown 显示方式")}
              >
                {(
                  [
                    ["edit", t("编辑"), Pencil],
                    ["preview", t("预览"), Eye],
                    ["split", t("分屏"), Columns2],
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
              label={t("重新加载")}
              disabled={!connected || document.loading || document.saving}
              onClick={() => {
                if (document.dirty)
                  setDiscard({
                    type: "reload",
                    id: document.id,
                    path: document.path,
                  });
                else run(files.reload(document.id));
              }}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </IconButton>
          </div>
        )}
      </header>
      {document ? (
        <>
          <div className="file-breadcrumb" title={document.path}>
            <span>{document.path.split(/[\\/]/).join(" / ")}</span>
            <IconButton
              label={t("在文件列表中显示")}
              title={
                currentCwd && relativeWorkspaceFile(currentCwd, document.path)
                  ? t("在文件列表中显示")
                  : t("不在当前项目目录")
              }
              disabled={
                !connected ||
                !currentCwd ||
                !relativeWorkspaceFile(currentCwd, document.path)
              }
              onClick={() => files.revealInTree(document.id)}
            >
              <FolderSearch size={16} aria-hidden="true" />
            </IconButton>
            {/* Keep the toolbar size stable: Monaco stops mouse selection when
                its height changes during a drag. */}
            {document.threadId && !image && view !== "preview" && (
              <Button
                size="sm"
                variant="quiet"
                disabled={!selection || selection.tooLarge}
                title={
                  selection?.tooLarge
                    ? t("选中代码超过 64 KB，请缩小选择范围")
                    : undefined
                }
                onClick={() => {
                  if (!selection || selection.tooLarge) return;
                  referenceProjectFile(
                    drafts,
                    document.threadId!,
                    document.path,
                    document.path,
                  );
                  const draft = drafts.get(document.threadId!);
                  const snippet = t(
                    "选中代码（第 {{value0}}–{{value1}} 行，当前编辑内容）：\n{{value2}}",
                    {
                      value0: selection.startLine,
                      value1: selection.endLine,
                      value2: selection.text,
                    },
                  );
                  const content = structuredClone(draft.document!);
                  content.content = [
                    ...(content.content ?? []),
                    ...textDocument(snippet).content!,
                  ];
                  drafts.setDocument(
                    document.threadId!,
                    content,
                    `${draft.text}\n${snippet}`,
                    draft.skills ?? [],
                  );
                  setNotice(t("已将选中代码添加到来源会话的输入框"));
                }}
              >
                {t("添加选中代码到会话")}
              </Button>
            )}
            {document.threadId && (
              <IconButton
                label={t("引用到来源会话")}
                onClick={() => {
                  referenceProjectFile(
                    drafts,
                    document.threadId!,
                    document.path,
                    document.path,
                  );
                  setNotice(t("已引用到来源会话的输入框"));
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
          {largeFile && !image && !document.loading && (
            <p className="file-notice" role="status">
              {largeReadonly
                ? t(
                    "大文件只读模式（{{value0}}）：文件超过 {{value1}}，仅支持查看和下载。",
                    {
                      value0: sizeLabel,
                      value1: formatFileSize(limits.editableBytes),
                    },
                  )
                : narrow
                  ? t(
                      "大文件简化模式（{{value0}}）：当前屏幕仅支持查看；请在宽屏下编辑和保存。",
                      {
                        value0: sizeLabel,
                        value1: formatFileSize(limits.editableBytes),
                      },
                    )
                  : byteLength > limits.editableBytes
                    ? t(
                        "大文件简化模式（{{value0}}）：编辑内容超过 {{value1}} 保存上限，请缩减内容后保存；撤销历史保留。",
                        {
                          value0: sizeLabel,
                          value1: formatFileSize(limits.editableBytes),
                        },
                      )
                    : t(
                        "大文件简化模式（{{value0}}）：已关闭语法高亮和 Markdown 预览，可继续编辑和保存。",
                        {
                          value0: sizeLabel,
                          value1: formatFileSize(limits.editableBytes),
                        },
                      )}
            </p>
          )}
          {largeFile && document.dirty && !state.recoveryError && (
            <p className="file-notice" role="status">
              {state.recoveryPending
                ? t("正在保存大文件草稿到浏览器…")
                : t("大文件草稿已保存到浏览器")}
            </p>
          )}
          {document.recovered && (
            <p className="file-notice" role="status">
              {t(
                "已从浏览器恢复未保存的编辑内容，尚未写入文件。保存前会重新核对磁盘内容。",
              )}
            </p>
          )}
          {document.conflict && (
            <div className="file-notice" role="alert">
              {t("磁盘文件已改变。请比较内容，重新加载或另存为新文件。")}
              {!image && (
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={document.diskText === undefined}
                  onClick={() => {
                    setCompare("disk");
                    setView("edit");
                  }}
                >
                  {t("比较磁盘内容")}
                </Button>
              )}
              {document.diskText === undefined &&
                t(" 磁盘内容不可用，请重新加载或另存为。")}
              {!narrow && (
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={!connected}
                  onClick={() => setSaveAs(`${document.path}.copy`)}
                >
                  {t("另存为")}
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
          {comparisonTooLarge && (
            <ErrorNotice className="m-3 shrink-0">
              {t("差异内容超过 {{value0}}，请提高文件限制后重新打开比较。", {
                value0: formatFileSize(limits.diffBytes),
              })}
            </ErrorNotice>
          )}
          {comparison && (
            <div className="file-comparison-labels">
              <strong>
                {comparison.label}
                {t("（只读）")}
              </strong>
              <strong>
                {gitComparison
                  ? t("{{value0}}（只读）", {
                      value0: gitComparison.modifiedLabel,
                    })
                  : t("当前编辑内容")}
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
                    {t("编辑当前文件")}
                  </Button>
                )
              ) : (
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => setCompare(null)}
                >
                  {t("返回编辑")}
                </Button>
              )}
            </div>
          )}
          {!connected && (
            <p className="file-notice" role="status">
              {image
                ? t("连接已断开。当前图片仍可查看，重新连接后可刷新。")
                : t("连接已断开。可继续编辑草稿，重新连接后再保存。")}
            </p>
          )}
          {document.loading && (
            <p className="file-notice">{t("正在读取文件…")}</p>
          )}
          <div
            className={`relative flex min-h-0 min-w-0 flex-1 ${markdown && !comparison ? `file-view-${view}` : "file-view-edit"}`}
          >
            <div
              style={
                image || (document.error && !document.text)
                  ? { display: "none" }
                  : undefined
              }
              className={`file-editor-pane${comparison ? " file-comparison" : ""}`}
              aria-hidden={
                markdown && view === "preview" && !comparison ? true : undefined
              }
            >
              {document.error && !document.text ? null : narrow &&
                !largeFile &&
                !comparison ? (
                <ScrollArea orientation="both" className="flex-1">
                  <pre className="file-readonly" tabIndex={0}>
                    {gitComparison && (
                      <>
                        {t("原版本：")}
                        {gitComparison.originalLabel}
                        {"\n"}
                        {gitComparison.original}
                        {"\n\n"}
                        {t("新版本：")}
                        {gitComparison.modifiedLabel}
                        {"\n"}
                      </>
                    )}
                    <code>
                      {document.text || (document.error ? "" : t("（空文件）"))}
                    </code>
                  </pre>
                </ScrollArea>
              ) : (
                <EditorBoundary text={document.text}>
                  <Suspense
                    fallback={
                      <p className="file-notice">{t("正在加载编辑器…")}</p>
                    }
                  >
                    <MonacoEditor
                      comparison={comparison}
                      limits={limits}
                      gitBaseline={gitBaseline?.text}
                      onGitCompare={() => {
                        setCompare("git");
                        setView("edit");
                      }}
                      document={
                        narrow ? { ...document, readonly: true } : document
                      }
                      documents={state.documents}
                      onChange={(id, text) => files.setText(id, text)}
                      onSave={save}
                      onSelection={setSelection}
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
                    ? t("Git 只读快照，不含未保存草稿；重新加载可更新差异。")
                    : document.readonly || narrow
                      ? undefined
                      : t("⌘ / Ctrl S 保存")
                }
              >
                {image
                  ? t("图片预览")
                  : gitComparison
                    ? t("Git 快照")
                    : document.dirty
                      ? t("未保存")
                      : t("已保存")}
              </span>
              {!gitComparison && gitBaseline?.text !== undefined && (
                <span
                  tabIndex={0}
                  title={t(
                    "对比 Git 暂存区。绿色：新增；蓝色：修改；红色：删除。包含未保存草稿，点击左侧标记查看差异。",
                  )}
                >
                  {t("Git 行标记")}
                </span>
              )}
              {gitBaseline?.error && (
                <span tabIndex={0} title={gitBaseline.error}>
                  {t("Git 行标记不可用")}
                </span>
              )}
              {(document.readonly || narrow) && <span>{t("只读")}</span>}
            </div>
            <div className="file-status-group ml-auto">
              {!image && (
                <>
                  <span>{sizeLabel}</span>
                  <span>UTF-8</span>
                </>
              )}
              {!narrow && !image && (
                <>
                  <span>{position.language}</span>
                  <span>
                    {t("第 {{line}} 行，第 {{column}} 列", {
                      line: position.line,
                      column: position.column,
                    })}
                  </span>
                </>
              )}
            </div>
          </footer>
        </>
      ) : (
        <p className="file-notice">
          {t("从项目文件树打开文件，或返回会话继续工作。")}
        </p>
      )}
      {saveAs !== undefined && document && (
        <FileDialog
          title={t("另存为新文件")}
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
            <label>
              {t("新文件绝对路径")}
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
                {t("取消")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={busy || !connected}
              >
                {busy ? t("正在保存…") : t("创建副本")}
              </Button>
            </div>
          </form>
        </FileDialog>
      )}
      {discard && (
        <FileDialog
          title={discard.type === "close" ? t("关闭文件") : t("重新加载文件")}
          busy={discardTargets.some((item) => item.saving || item.loading)}
          onClose={() => setDiscard(undefined)}
        >
          <div className="file-dialog">
            {discard.type === "close" &&
            discard.ids &&
            discard.ids.length > 1 ? (
              <p>
                {t("将关闭所选标签页并丢弃以下文件尚未保存的修改，是否继续？")}
              </p>
            ) : (
              <p>
                {discard.type === "close" ? t("关闭") : t("重新加载")}
                {t("将丢弃此文件尚未保存的修改，是否继续？")}
              </p>
            )}
            <p className="text-muted [overflow-wrap:anywhere]">
              {discard.type === "close" && discard.ids && discard.ids.length > 1
                ? discardTargets
                    .filter((item) => item.dirty)
                    .map((item) => (
                      <span className="block" key={item.id}>
                        {item.path}
                      </span>
                    ))
                : discard.path}
            </p>
            <div className="file-dialog-actions">
              <Button autoFocus onClick={() => setDiscard(undefined)}>
                {t("取消")}
              </Button>
              <Button
                variant="danger"
                disabled={
                  !discardTarget ||
                  discardTargets.some((item) => item.saving || item.loading) ||
                  (discard.type === "reload" && !connected)
                }
                onClick={() => {
                  const action = discard;
                  setDiscard(undefined);
                  if (action.type === "close")
                    (action.ids ?? [action.id]).forEach(closeFile);
                  else run(files.reload(action.id));
                }}
              >
                {discard.type === "close"
                  ? t("放弃修改并关闭")
                  : t("放弃修改并重新加载")}
              </Button>
            </div>
          </div>
        </FileDialog>
      )}
    </section>
  );
}
