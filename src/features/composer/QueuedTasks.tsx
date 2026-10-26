import { t, useLocale } from "../../lib/i18n";
import { settingsInputClass } from "../settings/settings-ui";
import { useEffect, useState } from "react";
import { DropdownMenu } from "radix-ui";
import {
  MoreHorizontal,
  ArrowUpToLine,
  Pencil,
  X,
  CornerUpRight,
} from "lucide-react";
import {
  Button,
  ErrorNotice,
  IconButton,
  Menu,
  Modal,
  ScrollArea,
} from "../../components/ui";
import { useRuntime } from "../../lib/runtime-context";
import { useStore } from "../../components/hooks";
import { errorMessage } from "../../lib/store";
import type { Draft } from "./drafts";
import { draftInput } from "./submission";
import { hasSkillToken } from "./completion-token";

export function QueuedTasks({ threadId }: { threadId: string }) {
  const i18nLocale = useLocale();
  void i18nLocale;

  const runtime = useRuntime();
  const state = useStore(runtime.queue);
  useStore(runtime.sessions);
  const connection = useStore(runtime.connection);
  const requests = useStore(runtime.requests);
  const fullQueue = runtime.queue.forThread(threadId);
  const queue = {
    ...fullQueue,
    items: fullQueue.items.filter((item) => !item.question),
  };
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; draft: Draft }>();
  const active = runtime.sessions.activeTurn(threadId);
  const canSteer =
    !!active &&
    connection.status === "connected" &&
    runtime.sessions.getSnapshot().threadAccess[threadId] === "editable" &&
    !runtime.requests.forThread(threadId).length;
  const waitingReason =
    queue.paused ||
    (connection.status !== "connected"
      ? t("工作环境未连接，等待连接后调度。")
      : queue.items.some((item) => item.status === "uncertain")
        ? t("发送结果待核实，队列不会继续发送。")
        : queue.editingId
          ? t("正在编辑排队消息，等待编辑结束。")
          : requests.pending.some(
                (request) =>
                  "threadId" in request.params &&
                  request.params.threadId === threadId,
              )
            ? t("等待处理当前会话的审批或问题。")
            : runtime.sessions.getSnapshot().threadAccess[threadId] !==
                "editable"
              ? t("等待取得此会话的编辑权限。")
              : null);
  const editingId = editing?.id;
  useEffect(
    () => () => {
      if (editingId)
        void runtime.queue.finishEdit(threadId, editingId).catch(() => {});
    },
    [runtime, threadId, editingId],
  );

  async function act(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function closeEditor() {
    if (!editing || busy) return;
    await act(async () => {
      await runtime.queue.finishEdit(threadId, editing.id);
      setEditing(undefined);
    });
  }
  if (!queue.items.length && !state.error && !error) return null;
  return (
    <section
      aria-label={t("待发送任务")}
      data-slot="message-queue"
      className="mb-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs"
    >
      {queue.items.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              {t("待发送 ·")}
              {queue.items.length} {t("条")}
            </span>
            <Button
              size="sm"
              variant="quiet"
              disabled={
                busy ||
                connection.status !== "connected" ||
                queue.items.some((item) => item.status === "uncertain")
              }
              onClick={() =>
                void act(() =>
                  queue.paused
                    ? runtime.queue.resume(threadId)
                    : runtime.queue.pause(threadId),
                )
              }
            >
              {queue.paused ? t("继续队列") : t("暂停队列")}
            </Button>
          </div>
          <p className="mb-1 text-meta text-muted" role="status">
            {waitingReason ||
              (queue.items[0]?.question
                ? t("问题回答的内容与发送状态见上方问题面板")
                : t("当前轮次结束后，按顺序逐条发送"))}
          </p>
          <p className="mb-1 text-meta text-muted">
            {t(
              "由当前浏览器调度；关闭页面后不会发送。发送结果待核实时，先核对会话记录。",
            )}
          </p>
          <ScrollArea className="max-h-[min(10rem,calc(var(--viewport-height,100dvh)*0.18))]">
            <ol className="m-0 list-none p-0">
              {queue.items.map((task, index) => (
                <li
                  key={task.id}
                  data-slot="queued-task"
                  className="flex items-center gap-2 border-t border-border/60 py-1.5"
                  aria-label={t("待发送任务 {{value0}}", { value0: index + 1 })}
                >
                  <span className="w-4 shrink-0 text-subtle">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate" title={task.draft.text}>
                      {task.question
                        ? t("问题回答（详见问题面板）")
                        : task.draft.text || t("图片任务")}
                    </p>
                    <p className="truncate text-fine text-muted">
                      {task.status === "sending"
                        ? t("正在发送…")
                        : task.status === "uncertain"
                          ? t("发送结果待核实")
                          : t("等待发送")}
                      {task.draft.images.length > 0 &&
                        t(" · {{value0}} 张图片", {
                          value0: task.draft.images.length,
                        })}
                      {task.options.model && ` · ${task.options.model}`}
                    </p>
                  </div>
                  <Menu
                    label={t("任务操作 {{value0}}", { value0: index + 1 })}
                    trigger={
                      <IconButton
                        size="sm"
                        label={t("任务操作 {{value0}}", { value0: index + 1 })}
                        disabled={busy || task.status === "sending"}
                      >
                        <MoreHorizontal size={15} />
                      </IconButton>
                    }
                  >
                    {index > 0 && task.status === "queued" && (
                      <DropdownMenu.Item
                        onSelect={() =>
                          void act(() =>
                            runtime.queue.moveFirst(threadId, task.id),
                          )
                        }
                      >
                        <ArrowUpToLine size={14} />
                        {t("移到最前")}
                      </DropdownMenu.Item>
                    )}
                    {task.status === "queued" && !task.question && (
                      <>
                        <DropdownMenu.Item
                          onSelect={() =>
                            void act(async () => {
                              await runtime.queue.beginEdit(threadId, task.id);
                              setEditing({
                                id: task.id,
                                draft: structuredClone(task.draft),
                              });
                            })
                          }
                        >
                          <Pencil size={14} />
                          {t("编辑")}
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          disabled={!canSteer}
                          onSelect={() =>
                            void act(() =>
                              runtime.queue.steer(threadId, task.id),
                            )
                          }
                        >
                          <CornerUpRight size={14} />
                          {t("立即引导")}
                        </DropdownMenu.Item>
                      </>
                    )}
                    {task.status === "uncertain" && (
                      <DropdownMenu.Item
                        onSelect={() =>
                          void act(() => runtime.queue.retry(threadId, task.id))
                        }
                      >
                        {t("确认未发送，允许重试")}
                      </DropdownMenu.Item>
                    )}
                    <DropdownMenu.Item
                      disabled={task.status === "sending"}
                      onSelect={() =>
                        void act(() => runtime.queue.remove(threadId, task.id))
                      }
                    >
                      <X size={14} />
                      {t("删除")}
                    </DropdownMenu.Item>
                  </Menu>
                </li>
              ))}
            </ol>
          </ScrollArea>
        </>
      )}
      {(error || state.error) && (
        <ErrorNotice className="mt-1">{error || state.error}</ErrorNotice>
      )}
      <Modal
        open={!!editing}
        title={t("编辑待发送任务")}
        description={t("保存后保留原来的排队位置和执行配置。")}
        onOpenChange={(open) => {
          if (!open) void closeEditor();
        }}
        returnFocusSelector="[data-slot=message-queue] button"
      >
        {editing && (
          <>
            <label htmlFor="queued-task-text" className="mb-2 block text-xs">
              {t("任务内容")}
            </label>
            <textarea
              id="queued-task-text"
              autoFocus
              rows={7}
              disabled={busy}
              className={`${settingsInputClass} resize-y`}
              value={editing.draft.text}
              onChange={(event) => {
                const text = event.target.value;
                setEditing({
                  ...editing,
                  draft: {
                    ...editing.draft,
                    text,
                    document: undefined,
                    skills: editing.draft.skills?.filter((skill) =>
                      hasSkillToken(text, skill.name),
                    ),
                  },
                });
              }}
            />
            {editing.draft.images.length > 0 && (
              <div className="my-2 flex flex-wrap gap-2">
                {editing.draft.images.map((image) => (
                  <div
                    key={image.id}
                    className="flex items-center gap-1 rounded-lg border border-border p-1"
                  >
                    <img
                      src={image.url}
                      alt={image.name}
                      className="size-10 rounded object-cover"
                    />
                    <IconButton
                      size="sm"
                      label={t("移除排队附件 {{value0}}", {
                        value0: image.name,
                      })}
                      disabled={busy}
                      onClick={() =>
                        setEditing({
                          ...editing,
                          draft: {
                            ...editing.draft,
                            images: editing.draft.images.filter(
                              (item) => item.id !== image.id,
                            ),
                          },
                        })
                      }
                    >
                      <X size={12} />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
            {error && <ErrorNotice>{error}</ErrorNotice>}
            <div className="mt-3 flex justify-end gap-2">
              <Button onClick={() => void closeEditor()} disabled={busy}>
                {t("取消")}
              </Button>
              <Button
                variant="primary"
                disabled={busy || !draftInput(editing.draft).length}
                onClick={() =>
                  void act(async () => {
                    await runtime.queue.finishEdit(
                      threadId,
                      editing.id,
                      editing.draft,
                      draftInput(editing.draft),
                    );
                    setEditing(undefined);
                  })
                }
              >
                {t("保存修改")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}
