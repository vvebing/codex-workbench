import { t, useLocale } from "../../lib/i18n";
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
import { memo, useCallback, useRef, useState } from "react";
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
import { referenceProjectFile } from "../shell/project-files";
import { environments } from "../connection/environments";
import { DEFAULT_ATTACHMENT_DIRECTORY } from "../settings/attachment-preferences";
import {
  PROJECT_FILE_DRAG_TYPE,
  projectFileDrop,
  saveAttachment,
  resolveAttachmentDirectory,
} from "./file-attachments";

import type { ReasoningEffort } from "../../generated/ReasoningEffort";
import type { AskForApproval } from "../../generated/v2/AskForApproval";
import { serviceTierOptions } from "./service-tier";
import { approvalLabel, approvalOptions } from "./approval-policy";
const policies = [
  {
    value: "inherit",
    get name() {
      return t("沿用当前审批设置");
    },
    get description() {
      return t("不发送新的覆盖，也不会撤销此前已发送的审批设置。");
    },
  },
  {
    value: "on-request",
    get name() {
      return t("按需审批");
    },
    get description() {
      return t("由 Codex 决定何时请求批准；沙箱限制仍由服务端执行。");
    },
  },
  {
    value: "untrusted",
    get name() {
      return t("谨慎审批");
    },
    get description() {
      return t("不受信任的命令需要批准，受信任命令由服务端规则决定。");
    },
  },
  {
    value: "never",
    get name() {
      return t("不请求审批");
    },
    get description() {
      return t("不弹出执行审批；受限制操作可能失败，不代表绕过沙箱。");
    },
  },
] as const;
const efforts: Record<string, string> = {
  get none() {
    return t("无");
  },
  get minimal() {
    return t("最少");
  },
  get low() {
    return t("低");
  },
  get medium() {
    return t("中");
  },
  get high() {
    return t("高");
  },
  get xhigh() {
    return t("极高");
  },
};
export const Composer = memo(function Composer({
  threadId,
  onInspectAgent,
}: {
  threadId: string;
  onInspectAgent?: (id: string) => void;
}) {
  const i18nLocale = useLocale();
  void i18nLocale;

  const [chosenModel, setChosenModel] = useState("");
  const [chosenEffort, setChosenEffort] = useState<ReasoningEffort>();
  const [policyChoices, setPolicyChoices] = useState<
    Record<string, AskForApproval | undefined>
  >({});
  const [tierChoices, setTierChoices] = useState<
    Record<string, string | undefined>
  >({});
  const [reading, setReading] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState("");
  const {
    runtime,
    connection,
    sessions,
    draft,
    thread,
    threadSettings,
    localDraft,
    access,
    connected,
    waiting,
    inputRequest,
    asyncQuestion,
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
    { chosenModel, chosenEffort, policyChoices, tierChoices },
    reading,
  );
  const policyKey = JSON.stringify([connection.scope, threadId]);
  const policy = policyChoices[policyKey];
  const tier = serviceTierOptions(model, tierChoices[policyKey]).serviceTier;
  const supportsFast = !!model?.serviceTiers?.some(
    (item) => item.id === "priority",
  );
  const effectiveTier = tier !== undefined ? tier : threadSettings?.serviceTier;
  const fastTier =
    effectiveTier === null ? model?.defaultServiceTier : effectiveTier;
  const fastUnknown = effectiveTier === undefined;
  const fastInput = useCallback(
    (node: HTMLInputElement | null) => {
      if (node) node.indeterminate = fastUnknown;
    },
    [fastUnknown],
  );
  const { running, executing, hasContent } = capabilities;
  const showStop = capabilities.showStop && !inputRequest;
  function goToQuestion() {
    const attribute = inputRequest
      ? "data-question-request-id"
      : "data-async-question-id";
    const id = String(inputRequest?.id ?? asyncQuestion?.id ?? "");
    const card = Array.from(
      document.querySelectorAll<HTMLElement>(`[${attribute}]`),
    ).find((element) => element.getAttribute(attribute) === id);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.focus({ preventScroll: true });
  }
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
      setError(t("正在准备附件，请稍后再粘贴或拖放。"));
      return;
    }
    attachmentLock.current = true;
    setError("");
    setReading(true);
    const epoch = connection.epoch;
    const failures: string[] = [];
    const isCurrent = () =>
      runtime.connection.getSnapshot().epoch === epoch &&
      runtime.connection.getSnapshot().status === "connected" &&
      runtime.sessions.getSnapshot().threadAccess[
        runtime.sessions.resolveId(threadId)
      ] !== "occupied";
    const configuredDirectory =
      environments
        .getSnapshot()
        .entries.find((environment) => environment.runtime === runtime)
        ?.attachmentDirectory ?? DEFAULT_ATTACHMENT_DIRECTORY;
    let attachmentDirectory: string | undefined;
    const persist = async (file: File, encoded?: string) => {
      attachmentDirectory ??= await resolveAttachmentDirectory(
        runtime.connection.client,
        configuredDirectory,
        isCurrent,
      );
      return saveAttachment(
        runtime.connection.client,
        attachmentDirectory,
        file,
        isCurrent,
        encoded,
      );
    };
    try {
      for (const file of files) {
        try {
          setPendingAttachment(
            `${file.name} · ${Math.ceil(file.size / 1024)} KB`,
          );
          if (
            !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
              file.type,
            )
          ) {
            const path = await persist(file);
            if (!isCurrent()) return;
            referenceProjectFile(
              runtime.drafts,
              threadId,
              `${file.name} · ${Math.ceil(file.size / 1024)} KB`,
              path,
            );
            continue;
          }
          if (file.size > 5 * 1024 * 1024)
            throw Error(
              t("{{value0}} 超过单张 5 MB 限制。", { value0: file.name }),
            );
          const current = runtime.drafts.get(threadId);
          if (
            current.images.length >= 4 ||
            current.images.reduce((sum, i) => sum + i.url.length, 0) +
              Math.ceil(file.size / 3) * 4 +
              64 >
              10 * 1024 * 1024
          )
            throw Error(
              t("{{value0}}：最多 4 张图片，编码后总大小不超过 10 MB。", {
                value0: file.name,
              }),
            );
          const url = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () =>
              reject(
                Error(
                  t("无法读取 {{value0}}，请重试。", { value0: file.name }),
                ),
              );
            reader.onabort = () => reject(Error(t("图片读取已取消。")));
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
              t("{{value0}}：最多 4 张图片，编码后总大小不超过 10 MB。", {
                value0: file.name,
              }),
            );
          await persist(file, url.slice(url.indexOf(",") + 1));
          if (!isCurrent()) return;
          runtime.drafts.addImage(threadId, {
            id: crypto.randomUUID(),
            name: file.name || t("粘贴的图片"),
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
      setPendingAttachment("");
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div
      data-slot="conversation-composer"
      className="conversation-content shrink-0 pb-3 @max-[550px]/conversation:pb-2"
    >
      <div
        data-slot="composer-status"
        className="flex min-h-7 items-center gap-[7px] px-[5px] text-fine text-subtle @max-[550px]/conversation:min-h-[25px]"
        role="status"
      >
        {readOnly ? (
          <>
            {executing && (
              <LoaderCircle
                size={12}
                className="animate-spin"
                aria-label={t("运行中")}
              />
            )}
            <span>
              {executing ? t("执行中 · ") : ""}
              {sessions.historySyncError
                ? t("只读查看 · 同步暂时失败，将自动重试")
                : t("其他客户端正在使用此会话 · 只读查看")}
            </span>
          </>
        ) : access === "activating" ? (
          <>
            <LoaderCircle size={12} className="animate-spin" />
            <span>{t("正在确认会话是否可写…")}</span>
          </>
        ) : access === "viewing" ? (
          <span>
            {localDraft
              ? t("发送第一条消息后创建会话")
              : executing
                ? t("会话正在执行 · 发送时确认是否可继续")
                : t("查看历史 · 发送消息后继续会话")}
          </span>
        ) : inputRequest ? (
          <span>{t("请先在问题卡片中回答 · 下方普通消息草稿会保留")}</span>
        ) : waiting ? (
          <>
            <span className="inline-block size-1.5 shrink-0 rounded-full bg-warning" />
            {t("等待你的确认")}
          </>
        ) : executing ? (
          <>
            <span className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-success ring-[3px] ring-success/10" />
            {t("Codex 正在执行 ·")}{" "}
            {defaultSteering
              ? t("Enter 引导 · ⌘/Ctrl+Shift+Enter 排队")
              : t("Enter 排队 · ⌘/Ctrl+Enter 立即引导")}
          </>
        ) : (
          <span>
            {draft.restored
              ? t("{{value0}}{{value1}}", {
                  value0:
                    draft.restored.source === "draft"
                      ? t("草稿已恢复，可修改后发送")
                      : draft.restored.preserved
                        ? t("原消息已恢复，未发送草稿已保留")
                        : t("原消息已恢复，可修改后发送"),
                  value1: sessions.historySyncError ? t(" · 历史暂未刷新") : "",
                })
              : connected
                ? t("准备就绪")
                : t("连接后即可发送消息")}
          </span>
        )}
      </div>
      {(draft.persistenceWarning || sessions.draftPersistenceWarning) && (
        <div className="mb-2 px-[5px] text-xs text-warning" role="status">
          {draft.persistenceWarning || sessions.draftPersistenceWarning}
        </div>
      )}
      {draft.restored?.unavailableAttachments && (
        <div className="mb-2 px-[5px] text-xs text-muted" role="status">
          {t("草稿已恢复 · 图片附件需重新添加")}
        </div>
      )}
      {(inputRequest || asyncQuestion) && (
        <div
          className="mb-2 flex flex-wrap items-center gap-2 px-[5px] text-xs text-muted"
          role="status"
        >
          <span>
            {inputRequest
              ? t("回答请在问题卡片中提交；此输入框保留普通消息草稿。")
              : t(
                  "有待回答问题。下方输入框发送普通消息，{{value0}}；回答请使用问题卡片。",
                  {
                    value0: defaultSteering
                      ? t("立即引导当前任务")
                      : queueing
                        ? t("加入任务队列")
                        : t("发送到会话"),
                  },
                )}
          </span>
          <Button
            type="button"
            variant="quiet"
            size="sm"
            onClick={goToQuestion}
          >
            {t("前往问题卡片回答")}
          </Button>
        </div>
      )}
      <QueuedTasks key={`${connection.url}-${threadId}`} threadId={threadId} />
      <form
        className={`relative overflow-hidden rounded-[15px] border bg-elevated shadow-sm focus-within:border-accent/60 focus-within:ring-[3px] focus-within:ring-accent/10 ${dragging ? "border-accent ring-[3px] ring-accent/20" : "border-border"}`}
        onDragEnter={(event) => {
          if (
            readOnly ||
            !event.dataTransfer.types.some(
              (type) => type === "Files" || type === PROJECT_FILE_DRAG_TYPE,
            )
          )
            return;
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (
            !event.dataTransfer.types.some(
              (type) => type === "Files" || type === PROJECT_FILE_DRAG_TYPE,
            )
          )
            return;
          event.preventDefault();
          event.dataTransfer.dropEffect = readOnly || reading ? "none" : "copy";
        }}
        onDragLeave={(event) => {
          if (
            !event.dataTransfer.types.some(
              (type) => type === "Files" || type === PROJECT_FILE_DRAG_TYPE,
            )
          )
            return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }}
        onDropCapture={(event) => {
          const projectFile = event.dataTransfer.getData(
            PROJECT_FILE_DRAG_TYPE,
          );
          if (!projectFile && !event.dataTransfer.files.length) return;
          event.preventDefault();
          event.stopPropagation();
          dragDepth.current = 0;
          setDragging(false);
          if (readOnly || reading) return;
          if (projectFile) {
            try {
              const file = projectFileDrop(projectFile, thread?.cwd || "");
              referenceProjectFile(
                runtime.drafts,
                threadId,
                file.relative,
                file.path,
              );
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          } else void attach(Array.from(event.dataTransfer.files));
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
            {t("松开以添加文件或引用")}
          </div>
        )}
        {reading && (
          <p className="px-4 pt-3 text-xs text-muted" role="status">
            {t("正在准备：")}
            {pendingAttachment}
          </p>
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
          {t("消息输入框")}
        </label>
        {draft.images.length > 0 && (
          <ScrollArea orientation="horizontal">
            <div className="flex w-max min-w-full gap-2 px-3 pt-3">
              {draft.images.map((image) => (
                <div
                  data-slot="attachment"
                  className="flex shrink-0 items-center gap-[7px] rounded-lg border border-border p-1 text-meta"
                  key={image.id}
                >
                  <button
                    type="button"
                    aria-label={t("预览图片 {{value0}}", {
                      value0: image.name,
                    })}
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
                    label={t("移除附件 {{value0}}", { value0: image.name })}
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
          autoFocus={localDraft}
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
              ? t("其他客户端正在使用此会话，可在这里查看输出")
              : inputRequest
                ? t("普通消息草稿 · 请先前往问题卡片回答…")
                : asyncQuestion
                  ? defaultSteering
                    ? t("普通消息 · Enter 立即引导；回答请前往问题卡片…")
                    : queueing
                      ? t("普通消息 · Enter 排队；回答请前往问题卡片…")
                      : t("普通消息 · Enter 发送；回答请前往问题卡片…")
                  : queueing
                    ? defaultSteering
                      ? t(
                          "补充当前任务的要求，Enter 立即引导；Shift+Enter 换行…",
                        )
                      : t("输入下一项任务，Enter 排队；Shift+Enter 换行…")
                    : t("描述任务，/ 命令 · $ 技能 · @ 文件；可粘贴图片…")
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
            if (
              token &&
              items.length &&
              !e.shiftKey &&
              !e.metaKey &&
              !e.ctrlKey &&
              !e.altKey
            ) {
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
        <div className="composer-toolbar @container flex flex-wrap items-center gap-[3px] px-[9px] pt-2 pb-[9px] @max-[550px]/conversation:gap-1 @max-[550px]/conversation:px-[7px] @max-[550px]/conversation:pt-[5px] @max-[550px]/conversation:pb-2">
          <input
            hidden
            ref={input}
            type="file"
            multiple
            onChange={(e) => void attach(Array.from(e.target.files || []))}
          />
          <IconButton
            size="composer"
            label={
              reading
                ? t("读取附件中")
                : t("添加附件（可粘贴或拖放，每个最多 5 MB）")
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
            label={t("审批策略")}
            open={policyOpen}
            onOpenChange={setPolicyOpen}
            trigger={
              <button
                data-slot="policy-choice"
                type="button"
                className="flex min-h-[30px] items-center gap-[5px] whitespace-nowrap rounded-[7px] border-0 bg-transparent px-[7px] py-1.5 text-meta text-muted hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 @max-[550px]/conversation:min-h-11 @max-[550px]/conversation:px-1 @max-[550px]/conversation:text-fine @max-[550px]/conversation:gap-[3px]"
                disabled={readOnly}
              >
                <ShieldCheck size={15} />
                <span>
                  {policy &&
                  JSON.stringify(policy) !==
                    JSON.stringify(threadSettings?.approvalPolicy)
                    ? t("下次：{{value0}}", { value0: approvalLabel(policy) })
                    : t("审批：{{value0}}", {
                        value0: approvalLabel(threadSettings?.approvalPolicy),
                      })}
                </span>
                <ChevronDown size={12} />
              </button>
            }
          >
            <MenuLabel>{t("审批策略 · 下次发送设置")}</MenuLabel>
            <div className="max-w-80 px-3 py-2 text-fine text-muted">
              {t("当前会话（服务端）：")}
              {approvalLabel(threadSettings?.approvalPolicy)}
            </div>
            <div className="max-w-80 px-3 py-2 text-fine text-muted">
              {policy
                ? t(
                    "来源：本地持续显式选择（即使已与服务端值一致仍保留）。发送新轮次时覆盖当前及后续轮次；排队任务保留入队时的选择。",
                  )
                : t(
                    "不发送审批覆盖；沿用服务端会话策略。沿用不会撤销此前已发送的覆盖。",
                  )}
              {t(
                "立即引导沿用该轮策略；问题卡片回答沿用会话设置，不使用此处未发送的选择。此菜单不控制沙箱。",
              )}
            </div>
            <DropdownMenu.RadioGroup
              value={typeof policy === "string" ? policy : "inherit"}
              onValueChange={(value) =>
                setPolicyChoices((choices) => ({
                  ...choices,
                  [policyKey]: approvalOptions(
                    value as AskForApproval | "inherit",
                  ).approvalPolicy,
                }))
              }
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
            label={t("模型与推理强度")}
            open={modelOpen}
            onOpenChange={setModelOpen}
            trigger={
              <button
                data-slot="model-choice"
                type="button"
                className="flex min-h-[30px] items-center gap-[5px] whitespace-nowrap rounded-[7px] border-0 bg-transparent px-[7px] py-1.5 text-meta text-foreground hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 @max-[550px]/conversation:min-h-11 @max-[550px]/conversation:px-1 @max-[550px]/conversation:text-fine"
                disabled={readOnly}
              >
                <Cpu size={14} className="@max-[550px]/conversation:hidden" />
                <span className="max-w-[160px] truncate @max-[650px]:max-w-[90px] @max-[550px]/conversation:max-w-[85px]">
                  {model?.displayName ||
                    modelId ||
                    (localDraft ? t("设备默认") : t("服务端默认"))}
                </span>
                {effort && (
                  <small className="text-fine text-subtle">
                    · {efforts[effort] || effort}
                  </small>
                )}
                <ChevronDown size={12} />
              </button>
            }
          >
            <MenuLabel>{t("模型")}</MenuLabel>
            {!connected ? (
              <p className="p-[9px] text-meta text-muted">
                {t("连接工作环境后，可选择服务端提供的模型。")}
              </p>
            ) : connection.modelsLoading ? (
              <p className="p-[9px] text-meta text-muted" role="status">
                {t("正在读取可用模型…")}
              </p>
            ) : connection.modelsError ? (
              <>
                <ErrorNotice className="m-1">
                  {t("读取模型失败：")}
                  {connection.modelsError}
                </ErrorNotice>
                <DropdownMenu.Item
                  onSelect={(event) => {
                    event.preventDefault();
                    void runtime.connection.loadModels();
                  }}
                >
                  {t("重试读取模型")}
                </DropdownMenu.Item>
              </>
            ) : !models.length ? (
              <p className="p-[9px] text-meta text-muted">
                {t(
                  "服务端未返回可选模型，继续使用当前会话模型或服务端默认模型。",
                )}
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
                    <strong>{t("设备默认")}</strong>
                    <small>{t("发送时由设备配置决定")}</small>
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
                <MenuLabel data-menu-section="reasoning">
                  {t("推理强度")}
                </MenuLabel>
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
          <label
            data-slot="service-tier-choice"
            className="composer-fast flex min-h-[32px] shrink-0 items-center gap-2 rounded-[7px] px-2 text-meta text-muted hover:bg-hover has-disabled:cursor-not-allowed has-disabled:opacity-40"
            title={[
              supportsFast && fastUnknown
                ? t("尚未收到会话的 Fast 模式设置。")
                : "",
              t(
                "Fast 模式使用优先服务；下次发送新轮次时生效，排队任务保留入队时设置。",
              ),
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <input
              ref={fastInput}
              type="checkbox"
              className="size-4 accent-accent"
              aria-label={t("Fast 模式")}
              checked={fastTier === "priority"}
              disabled={readOnly || !supportsFast}
              onChange={(event) =>
                setTierChoices((choices) => ({
                  ...choices,
                  [policyKey]: event.target.checked ? "priority" : "default",
                }))
              }
            />
            <span>{t("Fast 模式")}</span>
            {!supportsFast && (
              <span className="text-fine text-subtle">
                {model ? t("不支持") : t("加载中")}
              </span>
            )}
          </label>
          <div className="composer-toolbar-spacer flex-1" />
          {thread && onInspectAgent && (
            <AgentEntry thread={thread} onSelect={onInspectAgent} />
          )}
          <ContextUsage key={threadId} usage={sessions.tokenUsage[threadId]} />
          {inputRequest && running && access === "editable" && (
            <Button
              type="button"
              variant="quiet"
              size="sm"
              disabled={!capabilities.canStop}
              onClick={() => void stop()}
              title={t("停止当前执行并暂停任务队列；不会提交问题回答")}
            >
              {stopping ? t("正在停止") : t("停止当前执行")}
            </Button>
          )}
          {running && hasContent && !inputRequest && (
            <Button
              type="button"
              variant="quiet"
              size="sm"
              className="shrink-0"
              disabled={!capabilities.canSend || access !== "editable"}
              title={
                defaultSteering
                  ? t("加入队列，当前轮次结束后发送（⌘/Ctrl+Shift+Enter）")
                  : t("立即引导当前轮次（⌘/Ctrl+Enter）")
              }
              onClick={() => void send(defaultSteering ? "queue" : "steer")}
            >
              {defaultSteering ? t("排队发送") : t("立即引导")}
            </Button>
          )}
          <button
            data-slot="composer-action"
            className={`ml-auto grid size-[31px] shrink-0 place-items-center rounded-[9px] border-0 disabled:bg-hover disabled:text-subtle @max-[550px]/conversation:size-11 ${showStop ? "bg-danger-soft text-danger enabled:hover:bg-danger/20" : "bg-accent text-background enabled:hover:bg-accent/90"}`}
            type={inputRequest || showStop ? "button" : "submit"}
            onClick={
              inputRequest
                ? goToQuestion
                : showStop
                  ? () => void stop()
                  : undefined
            }
            aria-label={
              inputRequest
                ? t("前往问题卡片回答")
                : showStop
                  ? stopping
                    ? t("正在停止")
                    : t("停止执行")
                  : sending
                    ? t("正在提交")
                    : access === "occupied"
                      ? t("重试发送")
                      : defaultSteering
                        ? t("立即引导")
                        : queueing
                          ? t("排队发送")
                          : t("发送消息")
            }
            title={
              inputRequest
                ? t("前往问题卡片回答，普通消息草稿会保留")
                : !connected
                  ? t("请先连接")
                  : showStop
                    ? stopping
                      ? t("正在停止")
                      : t("停止执行")
                    : waiting
                      ? t("请先回答当前请求")
                      : !hasContent
                        ? t("输入消息或添加附件")
                        : sending
                          ? t("正在提交")
                          : defaultSteering
                            ? t("立即引导当前轮次（Enter）")
                            : queueing
                              ? t("加入队列，当前轮次结束后发送（Enter）")
                              : t("发送消息")
            }
            disabled={
              !inputRequest &&
              (showStop ? !capabilities.canStop : !capabilities.canSend)
            }
          >
            {inputRequest ? (
              <ChevronDown size={19} className="rotate-180" />
            ) : showStop ? (
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
});
