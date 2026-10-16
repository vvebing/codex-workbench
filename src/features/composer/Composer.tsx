import {
  ErrorNotice,
  Button,
  ScrollArea,
  IconButton,
  Menu,
  MenuLabel,
  MenuSeparator,
} from "../../components/ui";
import { Completions, type Completion } from "./Completions";
import { completionToken } from "./completion-token";
import { useCallback, useRef, useState } from "react";
import {
  ArrowUp,
  Square,
  Paperclip,
  ChevronDown,
  Check,
  Cpu,
  ShieldCheck,
  X,
  LoaderCircle,
} from "lucide-react";
import { AgentEntry } from "../conversation/AgentEntry";
import { useRunningSendMode } from "../settings/conversation-preferences";
import { ContextUsage } from "./ContextUsage";
import { useComposerSession } from "./useComposerSession";
import { DropdownMenu } from "radix-ui";
import { ImagePreview } from "../../components/ImagePreview";
import { MessageEditor, type MessageEditorHandle } from "./MessageEditor";
import { QueuedTasks } from "./QueuedTasks";

import type { ReasoningEffort } from "../../generated/ReasoningEffort";
import type { AskForApproval } from "../../generated/v2/AskForApproval";
const policies = [
  {
    value: "on-request",
    name: "按需审批",
    description: "由 Codex 决定何时请求批准；沙箱限制仍由服务端执行。",
  },
  {
    value: "untrusted",
    name: "谨慎审批",
    description: "不受信任的命令需要批准，受信任命令由服务端规则决定。",
  },
  {
    value: "never",
    name: "不请求审批",
    description: "不弹出执行审批；受限制操作可能失败，不代表绕过沙箱。",
  },
] as const;
const efforts: Record<string, string> = {
  none: "无",
  minimal: "最少",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
};
export function Composer({
  threadId,
  onInspectAgent,
}: {
  threadId: string;
  onInspectAgent?: (id: string) => void;
}) {
  const [chosenModel, setChosenModel] = useState("");
  const [chosenEffort, setChosenEffort] = useState<ReasoningEffort>();
  const [policy, setPolicy] = useState<AskForApproval>("on-request");
  const [reading, setReading] = useState(false);
  const {
    runtime,
    connection,
    sessions,
    draft,
    thread,
    localDraft,
    access,
    connected,
    waiting,
    modelId,
    model,
    effort,
    sending,
    stopping,
    capabilities,
    error,
    notice,
    setError,
    command: runCommand,
    send: sendDraft,
    stop,
  } = useComposerSession(
    threadId,
    { chosenModel, chosenEffort, policy },
    reading,
  );
  const { running, executing, hasContent, showStop } = capabilities;
  const queueing =
    !!running || runtime.queue.forThread(threadId).items.length > 0;
  const runningSendMode = useRunningSendMode();
  const defaultMode =
    running && access === "editable" ? runningSendMode : "queue";
  const defaultSteering = defaultMode === "steer";
  const readOnly = !capabilities.editable;
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [selected, setSelected] = useState(0);
  const [items, setItems] = useState<Completion[]>([]);
  const [modelOpen, setModelOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string>();
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);
  const attachmentLock = useRef(false);
  const dragDepth = useRef(0);
  const preview = draft.images.find((image) => image.id === previewId);
  const onItems = useCallback((next: Completion[]) => {
    setItems(next);
    setSelected(0);
  }, []);
  const token =
    !dismissed && caret >= 0 ? completionToken(draft.text, caret) : null;
  function replaceCompletion(value: string, item?: Completion) {
    editor.current?.replaceCompletion(
      token ? token.end - token.start : 0,
      value,
      item
        ? {
            kind: item.skill ? "skill" : "file",
            label: item.skill?.name || item.label,
            value: item.value,
            name: item.skill?.name || item.label,
            path: item.skill?.path || item.path || item.value,
          }
        : undefined,
    );
    setDismissed(false);
  }

  function applyCommand(action: Awaited<ReturnType<typeof runCommand>>) {
    if (action === "skills" || action === "mention")
      replaceCompletion(action === "skills" ? "$" : "@");
    else if (action === "model") setModelOpen(true);
    else if (action === "permissions") setPolicyOpen(true);
  }
  async function command(name: string) {
    applyCommand(await runCommand(name));
  }
  function selectCompletion(item: Completion) {
    if (token?.prefix === "/") {
      void command(item.value.slice(1));
      return;
    }
    replaceCompletion(item.value + " ", item);
  }
  const editor = useRef<MessageEditorHandle>(null);
  const input = useRef<HTMLInputElement>(null);
  const models = connection.models;
  async function send(mode: "queue" | "steer" = defaultMode) {
    applyCommand(await sendDraft(reading || attachmentLock.current, mode));
  }
  async function attach(files: File[]) {
    const id = runtime.sessions.resolveId(threadId);
    if (
      !files.length ||
      runtime.sessions.getSnapshot().threadAccess[id] === "occupied"
    )
      return;
    if (attachmentLock.current) {
      setError("正在读取图片，请稍后再粘贴或拖放。");
      return;
    }
    attachmentLock.current = true;
    setError("");
    setReading(true);
    const epoch = connection.epoch;
    const failures: string[] = [];
    try {
      for (const file of files) {
        try {
          if (
            !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
              file.type,
            )
          )
            throw Error(
              `${file.name || "附件"}：仅支持 PNG、JPEG、WebP 或 GIF 图片。`,
            );
          if (file.size > 5 * 1024 * 1024)
            throw Error(`${file.name} 超过单张 5 MB 限制。`);
          const current = runtime.drafts.get(threadId);
          if (
            current.images.length >= 4 ||
            current.images.reduce((sum, i) => sum + i.url.length, 0) +
              Math.ceil(file.size / 3) * 4 +
              64 >
              10 * 1024 * 1024
          )
            throw Error(
              `${file.name}：最多 4 张图片，编码后总大小不超过 10 MB。`,
            );
          const url = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () =>
              reject(Error(`无法读取 ${file.name}，请重试。`));
            reader.onabort = () => reject(Error("图片读取已取消。"));
            reader.readAsDataURL(file);
          });
          if (
            runtime.connection.getSnapshot().epoch !== epoch ||
            runtime.sessions.getSnapshot().threadAccess[
              runtime.sessions.resolveId(threadId)
            ] === "occupied"
          )
            return;
          const latest = runtime.drafts.get(threadId);
          if (
            latest.images.length >= 4 ||
            latest.images.reduce((sum, image) => sum + image.url.length, 0) +
              url.length >
              10 * 1024 * 1024
          )
            throw Error(
              `${file.name}：最多 4 张图片，编码后总大小不超过 10 MB。`,
            );
          runtime.drafts.addImage(threadId, {
            id: crypto.randomUUID(),
            name: file.name || "粘贴的图片",
            url,
          });
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }
      setError(failures.join("\n"));
    } finally {
      attachmentLock.current = false;
      setReading(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div className="mx-auto w-full min-w-0 max-w-[840px] shrink-0 px-7 pb-[13px] max-[550px]:px-2.5 max-[550px]:pb-2">
      <div
        data-slot="composer-status"
        className="flex min-h-7 items-center gap-[7px] px-[5px] text-[10px] text-subtle max-[550px]:min-h-[25px]"
        role="status"
      >
        {readOnly ? (
          <>
            {executing && (
              <LoaderCircle
                size={12}
                className="animate-spin"
                aria-label="运行中"
              />
            )}
            <span>
              {executing ? "执行中 · " : ""}
              {sessions.historySyncError
                ? "只读查看 · 同步暂时失败，将自动重试"
                : "其他客户端正在使用此会话 · 只读查看"}
            </span>
          </>
        ) : access === "activating" ? (
          <>
            <LoaderCircle size={12} className="animate-spin" />
            <span>正在确认会话是否可写…</span>
          </>
        ) : access === "viewing" ? (
          <span>
            {localDraft
              ? "发送第一条消息后创建会话"
              : executing
                ? "会话正在执行 · 发送时确认是否可继续"
                : "查看历史 · 发送消息后继续会话"}
          </span>
        ) : waiting ? (
          <>
            <span className="inline-block size-1.5 shrink-0 rounded-full bg-warning" />
            等待你的确认
          </>
        ) : executing ? (
          <>
            <span className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-success ring-[3px] ring-success/10" />
            Codex 正在执行 ·{" "}
            {defaultSteering
              ? "Enter 引导 · ⌘/Ctrl+Shift+Enter 排队"
              : "Enter 排队 · ⌘/Ctrl+Enter 立即引导"}
          </>
        ) : (
          <span>
            {draft.restored
              ? `${draft.restored.preserved ? "原消息已恢复，未发送草稿已保留" : "原消息已恢复，可修改后发送"}${draft.restored.unavailableAttachments ? " · 部分附件需重新添加" : ""}${sessions.historySyncError ? " · 历史暂未刷新" : ""}`
              : connected
                ? "准备就绪"
                : "连接后即可发送消息"}
          </span>
        )}
      </div>
      <QueuedTasks key={`${connection.url}-${threadId}`} threadId={threadId} />
      <form
        className={`relative overflow-hidden rounded-[15px] border bg-elevated shadow-sm focus-within:border-accent/60 focus-within:ring-[3px] focus-within:ring-accent/10 ${dragging ? "border-accent ring-[3px] ring-accent/20" : "border-border"}`}
        onDragEnter={(event) => {
          if (readOnly || !event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = readOnly || reading ? "none" : "copy";
        }}
        onDragLeave={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }}
        onDropCapture={(event) => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          event.stopPropagation();
          dragDepth.current = 0;
          setDragging(false);
          void attach(Array.from(event.dataTransfer.files));
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {dragging && (
          <div
            className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-elevated/90 text-sm text-accent"
            role="status"
          >
            松开以添加图片
          </div>
        )}
        {token && !readOnly && (
          <Completions
            key={`${threadId}-${connection.epoch}`}
            token={token}
            cwd={thread?.cwd || ""}
            connected={connected}
            selected={selected}
            onItems={onItems}
            onSelect={selectCompletion}
          />
        )}
        <label className="sr-only" htmlFor="message-input">
          消息输入框
        </label>
        {draft.images.length > 0 && (
          <ScrollArea orientation="horizontal">
            <div className="flex w-max min-w-full gap-2 px-3 pt-3">
              {draft.images.map((image) => (
                <div
                  data-slot="attachment"
                  className="flex shrink-0 items-center gap-[7px] rounded-lg border border-border p-1 text-[11px]"
                  key={image.id}
                >
                  <button
                    type="button"
                    aria-label={`预览图片 ${image.name}`}
                    onClick={(event) => {
                      previewTrigger.current = event.currentTarget;
                      setPreviewId(image.id);
                    }}
                    className="shrink-0 rounded focus-visible:outline-accent"
                  >
                    <img
                      className="size-[34px] rounded object-cover"
                      src={image.url}
                      alt={image.name}
                    />
                  </button>
                  <span className="max-w-[90px] truncate">{image.name}</span>
                  <IconButton
                    label={`移除附件 ${image.name}`}
                    disabled={readOnly}
                    onClick={() =>
                      runtime.drafts.removeImage(threadId, image.id)
                    }
                  >
                    <X size={13} />
                  </IconButton>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
        <MessageEditor
          key={`${connection.url}-${threadId}`}
          ref={editor}
          draft={draft}
          disabled={readOnly}
          hasCompletions={!!token}
          completionId={
            token && items[selected]
              ? `composer-completion-${selected}`
              : undefined
          }
          placeholder={
            readOnly
              ? "其他客户端正在使用此会话，可在这里查看输出"
              : queueing
                ? defaultSteering
                  ? "补充当前任务的要求，Enter 立即引导；Shift+Enter 换行…"
                  : "输入下一项任务，Enter 排队；Shift+Enter 换行…"
                : "描述任务，/ 命令 · $ 技能 · @ 文件；可粘贴图片…"
          }
          onChange={(document, text, skills) => {
            runtime.drafts.setDocument(threadId, document, text, skills);
            setDismissed(false);
          }}
          onCaret={setCaret}
          onFiles={(files) => void attach(files)}
          onOpenFile={(path) => {
            void runtime.files
              .open({ path, cwd: thread?.cwd, threadId })
              .catch((cause: unknown) =>
                setError(
                  cause instanceof Error ? cause.message : String(cause),
                ),
              );
          }}
          onKeyDown={(e) => {
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send(e.shiftKey ? "queue" : "steer");
              return;
            }
            if (token && e.key === "Escape") {
              e.preventDefault();
              setDismissed(true);
              return;
            }
            if (token && items.length && !e.shiftKey) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setSelected(
                  (index) =>
                    (index + (e.key === "ArrowDown" ? 1 : items.length - 1)) %
                    items.length,
                );
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                selectCompletion(items[selected] || items[0]);
                return;
              }
            }
            if (
              token &&
              (token.prefix === "$" || token.prefix === "@") &&
              e.key === "Enter" &&
              !e.shiftKey
            ) {
              e.preventDefault();
              return;
            }
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.isComposing &&
              e.keyCode !== 229
            ) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="@container flex flex-wrap items-center gap-[3px] px-[9px] pt-2 pb-[9px] max-[550px]:gap-0 max-[550px]:px-[7px] max-[550px]:pt-[5px] max-[550px]:pb-2">
          <input
            hidden
            ref={input}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => void attach(Array.from(e.target.files || []))}
          />
          <IconButton
            size="composer"
            label={
              reading ? "读取附件中" : "添加图片（可粘贴或拖放，每张最多 5 MB）"
            }
            disabled={readOnly || reading}
            onClick={() => input.current?.click()}
          >
            {reading ? (
              <LoaderCircle size={17} className="animate-spin" />
            ) : (
              <Paperclip size={18} />
            )}
          </IconButton>
          <Menu
            label="审批策略"
            open={policyOpen}
            onOpenChange={setPolicyOpen}
            trigger={
              <button
                data-slot="policy-choice"
                type="button"
                className="flex min-h-[30px] items-center gap-[5px] whitespace-nowrap rounded-[7px] border-0 bg-transparent px-[7px] py-1.5 text-[11px] text-muted hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 max-[550px]:min-h-10 max-[550px]:px-1 max-[550px]:text-[10px] max-[550px]:gap-[3px]"
                disabled={readOnly}
              >
                <ShieldCheck size={15} />
                <span>{policies.find((p) => p.value === policy)?.name}</span>
                <ChevronDown size={12} />
              </button>
            }
          >
            <MenuLabel>审批策略</MenuLabel>
            <DropdownMenu.RadioGroup
              value={typeof policy === "string" ? policy : "on-request"}
              onValueChange={(value) => setPolicy(value as AskForApproval)}
            >
              {policies.map((p) => (
                <DropdownMenu.RadioItem value={p.value} key={p.value}>
                  <span className="w-4 shrink-0 text-accent">
                    <DropdownMenu.ItemIndicator>
                      <Check size={15} />
                    </DropdownMenu.ItemIndicator>
                  </span>
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.description}</small>
                  </span>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </Menu>
          <Menu
            label="模型与推理强度"
            open={modelOpen}
            onOpenChange={setModelOpen}
            trigger={
              <button
                data-slot="model-choice"
                type="button"
                className="flex min-h-[30px] items-center gap-[5px] whitespace-nowrap rounded-[7px] border-0 bg-transparent px-[7px] py-1.5 text-[11px] text-foreground hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 max-[550px]:min-h-10 max-[550px]:px-1 max-[550px]:text-[10px]"
                disabled={readOnly}
              >
                <Cpu size={14} className="max-[550px]:hidden" />
                <span className="max-w-[160px] truncate @max-[650px]:max-w-[90px] max-[550px]:max-w-[85px]">
                  {model?.displayName ||
                    modelId ||
                    (localDraft ? "设备默认" : "服务端默认")}
                </span>
                {effort && (
                  <small className="text-[10px] text-subtle">
                    · {efforts[effort] || effort}
                  </small>
                )}
                <ChevronDown size={12} />
              </button>
            }
          >
            <MenuLabel>模型</MenuLabel>
            {!connected ? (
              <p className="p-[9px] text-[11px] text-muted">
                连接工作环境后，可选择服务端提供的模型。
              </p>
            ) : connection.modelsLoading ? (
              <p className="p-[9px] text-[11px] text-muted" role="status">
                正在读取可用模型…
              </p>
            ) : connection.modelsError ? (
              <>
                <p className="p-[9px] text-[11px] text-muted" role="alert">
                  读取模型失败：{connection.modelsError}
                </p>
                <DropdownMenu.Item
                  onSelect={(event) => {
                    event.preventDefault();
                    void runtime.connection.loadModels();
                  }}
                >
                  重试读取模型
                </DropdownMenu.Item>
              </>
            ) : !models.length ? (
              <p className="p-[9px] text-[11px] text-muted">
                服务端未返回可选模型，继续使用当前会话模型或服务端默认模型。
              </p>
            ) : null}
            <DropdownMenu.RadioGroup
              value={modelId || ""}
              onValueChange={(value) => {
                setChosenModel(value);
                setChosenEffort(undefined);
              }}
            >
              {localDraft && !modelId && (
                <DropdownMenu.RadioItem value="" disabled>
                  <span className="w-4 shrink-0 text-accent">
                    <DropdownMenu.ItemIndicator>
                      <Check size={15} />
                    </DropdownMenu.ItemIndicator>
                  </span>
                  <span>
                    <strong>设备默认</strong>
                    <small>发送时由设备配置决定</small>
                  </span>
                </DropdownMenu.RadioItem>
              )}
              {models.map((m) => (
                <DropdownMenu.RadioItem key={m.id} value={m.model}>
                  <span className="w-4 shrink-0 text-accent">
                    <DropdownMenu.ItemIndicator>
                      <Check size={15} />
                    </DropdownMenu.ItemIndicator>
                  </span>
                  <span>
                    <strong>{m.displayName}</strong>
                    <small>{m.description}</small>
                  </span>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            {model && (
              <>
                <MenuSeparator />
                <MenuLabel data-menu-section="reasoning">推理强度</MenuLabel>
                <DropdownMenu.RadioGroup
                  value={effort || ""}
                  onValueChange={(value) =>
                    setChosenEffort(value as ReasoningEffort)
                  }
                >
                  {model.supportedReasoningEfforts.map((e) => (
                    <DropdownMenu.RadioItem
                      key={e.reasoningEffort}
                      value={e.reasoningEffort}
                    >
                      <span className="w-4 shrink-0 text-accent">
                        <DropdownMenu.ItemIndicator>
                          <Check size={15} />
                        </DropdownMenu.ItemIndicator>
                      </span>
                      <span>
                        {efforts[e.reasoningEffort] || e.reasoningEffort}
                      </span>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </>
            )}
          </Menu>
          <div className="flex-1" />
          {thread && onInspectAgent && (
            <AgentEntry thread={thread} onSelect={onInspectAgent} />
          )}
          <ContextUsage key={threadId} usage={sessions.tokenUsage[threadId]} />
          {running && hasContent && (
            <Button
              type="button"
              variant="quiet"
              size="sm"
              className="shrink-0"
              disabled={!capabilities.canSend || access !== "editable"}
              title={
                defaultSteering
                  ? "加入队列，当前轮次结束后发送（⌘/Ctrl+Shift+Enter）"
                  : "立即引导当前轮次（⌘/Ctrl+Enter）"
              }
              onClick={() => void send(defaultSteering ? "queue" : "steer")}
            >
              {defaultSteering ? "排队发送" : "立即引导"}
            </Button>
          )}
          <button
            data-slot="composer-action"
            className={`ml-auto grid size-[31px] shrink-0 place-items-center rounded-[9px] border-0 disabled:bg-hover disabled:text-subtle max-[550px]:size-10 ${showStop ? "bg-danger-soft text-danger enabled:hover:bg-danger/20" : "bg-accent text-background enabled:hover:bg-accent/90"}`}
            type={showStop ? "button" : "submit"}
            onClick={showStop ? () => void stop() : undefined}
            aria-label={
              showStop
                ? stopping
                  ? "正在停止"
                  : "停止执行"
                : sending
                  ? "正在提交"
                  : access === "occupied"
                    ? "重试发送"
                    : defaultSteering
                      ? "立即引导"
                      : queueing
                        ? "排队发送"
                        : "发送消息"
            }
            title={
              !connected
                ? "请先连接"
                : showStop
                  ? stopping
                    ? "正在停止"
                    : "停止执行"
                  : waiting
                    ? "请先回答当前请求"
                    : !hasContent
                      ? "输入消息或添加图片"
                      : sending
                        ? "正在提交"
                        : defaultSteering
                          ? "立即引导当前轮次（Enter）"
                          : queueing
                            ? "加入队列，当前轮次结束后发送（Enter）"
                            : "发送消息"
            }
            disabled={showStop ? !capabilities.canStop : !capabilities.canSend}
          >
            {showStop ? (
              stopping ? (
                <LoaderCircle size={18} className="animate-spin" />
              ) : (
                <Square size={14} fill="currentColor" strokeWidth={0} />
              )
            ) : sending ? (
              <LoaderCircle size={18} className="animate-spin" />
            ) : (
              <ArrowUp size={19} />
            )}
          </button>
        </div>
      </form>
      <ImagePreview
        image={preview}
        onClose={() => setPreviewId(undefined)}
        triggerRef={previewTrigger}
      />
      {notice && (
        <p
          role="status"
          className="mt-2 text-xs text-muted [overflow-wrap:anywhere]"
        >
          {notice}
        </p>
      )}
      {error && (
        <ErrorNotice className="mt-2" onDismiss={() => setError("")}>
          {error}
        </ErrorNotice>
      )}
    </div>
  );
}
