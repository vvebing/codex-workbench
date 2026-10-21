import { settingsInputClass } from "../settings/settings-ui";
import { ContextMenu } from "radix-ui";
import { useEffect, useState, type ReactNode } from "react";
import {
  Archive,
  MoreHorizontal,
  Pencil,
  GitBranch,
  Copy,
  FileText,
  Download,
  X,
  FolderInput,
  Trash2,
  Pin,
  PinOff,
  RotateCcw,
} from "lucide-react";
import {
  Button,
  SelectField,
  IconButton,
  Menu,
  MenuItem,
  ErrorNotice,
  MenuSeparator,
  Modal,
} from "../../components/ui";
import { titleOf, useStore, useStoreSelector } from "../../components/hooks";
import { useRuntime } from "../../lib/runtime-context";
import type { Thread } from "../../generated/v2/Thread";
import {
  conversationMarkdown,
  copyFinalSummary,
  exportFilename,
  exportText,
} from "../conversation/export";
import { environments } from "../connection/environments";
import { navigationEnvironmentKey } from "./navigation-state";
import { navigationPersonalization } from "./navigation-personalization";
import { draftHasContent, sessionActions } from "./session-actions";
export function ThreadMenu({
  thread,
  children,
  trigger,
  environmentKey,
}: {
  thread: Thread;
  children?: ReactNode;
  trigger?: ReactNode;
  environmentKey?: string;
}) {
  const contextMenu = !!children && !trigger;
  const Entry = contextMenu ? ContextMenu.Item : MenuItem;
  const Separator = contextMenu ? ContextMenu.Separator : MenuSeparator;
  const runtime = useRuntime();
  const connection = useStore(runtime.connection);
  useStore(navigationPersonalization);
  const environment = environments
    .getSnapshot()
    .entries.find((entry) => entry.runtime === runtime);
  const preferenceScope =
    environmentKey ??
    navigationEnvironmentKey(
      environment ?? {
        id: "local",
        url: connection.url,
      },
    );
  const pinned = navigationPersonalization.isThreadPinned(
    preferenceScope,
    thread.id,
  );
  const sessions = useStoreSelector(
    runtime.sessions,
    (state) => ({
      loading: state.loading,
      archived: !!state.archivedIds[thread.id],
      localDraft: !!state.localDrafts[thread.id],
      sections: state.sections,
      sectionsError: state.sectionsError,
    }),
    (a, b) =>
      a.loading === b.loading &&
      a.archived === b.archived &&
      a.localDraft === b.localDraft &&
      a.sections === b.sections &&
      a.sectionsError === b.sectionsError,
  );
  const localDraft = sessions.localDraft;
  const [dialog, setDialog] = useState<
    "rename" | "archive" | "delete" | "section" | null
  >(null);
  const [section, setSection] = useState("");
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [name, setName] = useState(titleOf(thread));
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(""), 4000);
    return () => clearTimeout(timer);
  }, [feedback]);
  const disabled =
    (!localDraft && connection.status !== "connected") ||
    sessions.loading ||
    busy;
  async function act(action: () => Promise<unknown>) {
    try {
      setError("");
      setFeedback("");
      setBusy(true);
      await action();
      setDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function copyText(text: string, message: string) {
    await navigator.clipboard.writeText(text);
    setFeedback(message);
  }
  async function copyConversation(summary = false) {
    const history = await runtime.sessions.readForExport(thread.id);
    if (summary) {
      await copyFinalSummary(history);
      setFeedback("已复制最终总结");
    } else await copyText(conversationMarkdown(history), "已复制全部对话");
  }
  async function downloadConversation() {
    const history = await runtime.sessions.readForExport(thread.id);
    exportText(
      conversationMarkdown(history),
      exportFilename(history),
      "text/markdown;charset=utf-8",
    );
    setFeedback("已导出会话");
  }
  return (
    <>
      <ThreadMenuSurface
        childrenTrigger={contextMenu ? children : undefined}
        trigger={trigger}
        thread={thread}
      >
        <Entry
          disabled={busy}
          onSelect={() =>
            navigationPersonalization.toggleThread(preferenceScope, thread.id)
          }
        >
          {pinned ? <PinOff size={15} /> : <Pin size={15} />}
          {pinned ? "取消收藏" : "收藏会话"}
        </Entry>
        <Entry
          disabled={disabled}
          onSelect={() => {
            setName(titleOf(thread));
            setDialog("rename");
          }}
        >
          <Pencil size={15} />
          重命名
        </Entry>
        <Entry
          disabled={disabled || localDraft}
          onSelect={() => void act(() => runtime.sessions.fork(thread.id))}
        >
          <GitBranch size={15} />
          分叉会话
        </Entry>
        <Entry
          disabled={disabled || localDraft}
          onSelect={() => {
            setSection(thread.section?.id ?? "");
            setDialog("section");
            void runtime.sessions.loadSections();
          }}
        >
          <FolderInput size={15} />
          移动到分区
        </Entry>
        <Separator className="m-[5px] h-px bg-border" />
        <Entry
          disabled={disabled || localDraft}
          onSelect={() => void act(() => copyConversation())}
        >
          <Copy size={15} />
          复制全部对话为 Markdown
        </Entry>
        <Entry
          disabled={disabled || localDraft}
          onSelect={() => void act(() => copyConversation(true))}
        >
          <FileText size={15} />
          仅复制最终总结
        </Entry>
        <Entry
          disabled={busy || localDraft}
          onSelect={() =>
            void act(() =>
              copyText(thread.sessionId || thread.id, "已复制 Session ID"),
            )
          }
        >
          <Copy size={15} />
          复制 Session ID
        </Entry>
        <Entry
          disabled={disabled || localDraft}
          onSelect={() => void act(downloadConversation)}
        >
          <Download size={15} />
          导出会话
        </Entry>
        <Separator className="m-[5px] h-px bg-border" />
        <Entry
          disabled={disabled}
          onSelect={() => {
            if (sessions.archived) {
              void act(async () => {
                await runtime.sessions.unarchive(thread.id);
                setFeedback("已恢复会话");
              });
            } else if (localDraft) {
              if (draftHasContent(runtime.drafts.get(thread.id)))
                setDialog("archive");
              else
                void act(() =>
                  Promise.resolve(runtime.discardDraft(thread.id)),
                );
            } else
              void act(() =>
                sessionActions.archive(runtime, thread.id, titleOf(thread)),
              );
          }}
        >
          {sessions.archived ? <RotateCcw size={15} /> : <Archive size={15} />}
          {sessions.archived ? "恢复会话" : localDraft ? "删除草稿" : "归档"}
        </Entry>
        {!localDraft && (
          <Entry
            disabled={disabled}
            onSelect={() => {
              setDeleteConfirmed(false);
              setDialog("delete");
            }}
          >
            <Trash2 size={15} />
            永久删除
          </Entry>
        )}
      </ThreadMenuSurface>
      {(feedback || (error && !dialog)) && (
        <div
          className="fixed bottom-6 left-1/2 z-80 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-[10px] border border-border bg-elevated px-3.5 py-2.5 text-xs shadow-lg [&[role=alert]]:text-danger"
          role={error ? "alert" : "status"}
        >
          <span>{error || feedback}</span>
          <IconButton
            label="关闭操作提示"
            onClick={() => {
              setFeedback("");
              setError("");
            }}
          >
            <X size={14} />
          </IconButton>
        </div>
      )}
      <Modal
        open={dialog !== null}
        onOpenChange={(v) => {
          if (!v) setDialog(null);
        }}
        title={
          dialog === "delete"
            ? "永久删除会话"
            : dialog === "section"
              ? "移动到分区"
              : dialog === "rename"
                ? "重命名会话"
                : localDraft
                  ? "删除草稿"
                  : "归档会话"
        }
        description={
          dialog === "delete"
            ? "此操作不可恢复，将永久删除本会话及其所有子代理后代会话和历史。"
            : dialog === "section"
              ? "选择保存在当前环境服务端的分区。"
              : dialog === "archive"
                ? localDraft
                  ? "草稿中有尚未发送的文字、附件或技能。删除后无法恢复。"
                  : "归档后会话将从当前列表移除，可从该环境的历史会话入口恢复。"
                : "使用一个容易找到的标题。"
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(() =>
              dialog === "delete"
                ? runtime.sessions.delete(thread.id)
                : dialog === "section"
                  ? runtime.sessions.moveSection(thread.id, section || null)
                  : dialog === "rename"
                    ? runtime.sessions.rename(thread.id, name.trim())
                    : localDraft
                      ? Promise.resolve(runtime.discardDraft(thread.id))
                      : sessionActions.archive(
                          runtime,
                          thread.id,
                          titleOf(thread),
                        ),
            );
          }}
        >
          {dialog === "delete" && (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={deleteConfirmed}
                onChange={(event) => setDeleteConfirmed(event.target.checked)}
                required
              />
              我确认永久删除本会话及所有后代会话，且无法恢复。
            </label>
          )}
          {dialog === "section" && (
            <>
              <label className="block text-control font-medium">
                目标分区
                <SelectField
                  label="目标分区"
                  className="my-2 w-full"
                  value={section || "unsectioned"}
                  onValueChange={(value) =>
                    setSection(value === "unsectioned" ? "" : value)
                  }
                  options={[
                    { value: "unsectioned", label: "未分区" },
                    ...sessions.sections.map((entry) => ({
                      value: entry.id,
                      label: entry.name,
                    })),
                  ]}
                />
              </label>
              {sessions.sectionsError && (
                <ErrorNotice>{sessions.sectionsError}</ErrorNotice>
              )}
            </>
          )}
          {dialog === "rename" && (
            <label className="block text-control font-medium">
              会话标题
              <input
                className={`${settingsInputClass} mt-2 block w-full`}
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
              />
            </label>
          )}
          {error && <ErrorNotice>{error}</ErrorNotice>}
          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setDialog(null)}
            >
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={
                disabled ||
                (dialog === "rename" && !name.trim()) ||
                (dialog === "delete" && !deleteConfirmed)
              }
            >
              {sessions.loading || busy ? "处理中…" : "确认"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function ThreadMenuSurface({
  childrenTrigger,
  trigger,
  thread,
  children,
}: {
  childrenTrigger?: ReactNode;
  trigger?: ReactNode;
  thread: Thread;
  children: ReactNode;
}) {
  if (childrenTrigger)
    return (
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{childrenTrigger}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            aria-label="会话操作"
            data-slot="menu"
            className="menu-content z-[60] min-w-[205px] rounded-[11px] border border-border bg-elevated p-[5px] text-foreground shadow-xl"
          >
            {children}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    );
  return (
    <Menu
      label="会话操作"
      trigger={
        trigger ?? (
          <IconButton label={`会话操作：${titleOf(thread)}`}>
            <MoreHorizontal size={18} />
          </IconButton>
        )
      }
    >
      {children}
    </Menu>
  );
}
