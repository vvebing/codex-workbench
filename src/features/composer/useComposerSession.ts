import { t } from "../../lib/i18n";
import {
  selectComposerSession,
  sameComposerSession,
} from "./session-selection";
import { useMemo, useRef, useState } from "react";
import { useStore, useStoreSelector } from "../../components/hooks";
import { useRuntime } from "../../lib/runtime-context";
import { errorMessage } from "../../lib/store";
import type { ReasoningEffort } from "../../generated/ReasoningEffort";
import type { AskForApproval } from "../../generated/v2/AskForApproval";
import { conversationCapabilities, draftCommand } from "./capabilities";
import { commands } from "./Completions";
import { getDefaultModel, useDefaultModel } from "../settings/model-preference";
import { composerModel } from "./model";
import { serviceTierOptions } from "./service-tier";
import { approvalOptions } from "./approval-policy";
import { pendingAsyncQuestions } from "../conversation/async-questions";

interface Selection {
  chosenModel: string;
  chosenEffort?: ReasoningEffort;
  tierChoices?: Record<string, string | undefined>;
  policyChoices?: Record<string, AskForApproval | undefined>;
}
type CommandAction = "skills" | "mention" | "model" | "permissions";

export function useComposerSession(
  threadId: string,
  selection: Selection,
  attachmentReading = false,
) {
  const runtime = useRuntime();
  const connection = useStore(runtime.connection);
  const selectSession = useMemo(
    () => (state: ReturnType<typeof runtime.sessions.getSnapshot>) =>
      selectComposerSession(state, threadId),
    [runtime, threadId],
  );
  const { sessions } = useStoreSelector(
    runtime.sessions,
    selectSession,
    sameComposerSession,
  );
  useDefaultModel();
  useStore(runtime.drafts);
  useStore(runtime.requests);
  useStore(runtime.submissions);
  useStore(runtime.queue);
  useStore(runtime.questionDismissals);
  const [commandPending, setCommandPending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const commandLock = useRef(false);
  const stopLock = useRef(false);
  const epoch = connection.epoch;

  // Actions re-read stores: a render can precede a request, permission change,
  // draft promotion, or a send started by another Composer instance.
  function current(reading = attachmentReading) {
    const id = runtime.sessions.resolveId(threadId);
    const state = runtime.sessions.getSnapshot();
    const connection = runtime.connection.getSnapshot();
    const draft = runtime.drafts.get(id);
    const thread = state.threads[id];
    const access = state.threadAccess[id] ?? "viewing";
    const sending =
      commandLock.current ||
      runtime.submissions.isSending(id) ||
      !runtime.queue.getSnapshot().ready;
    const requests = runtime.requests.forThread(id);
    const waiting = requests.length > 0;
    const inputRequest = requests.find(
      (request) => request.method === "item/tool/requestUserInput",
    );
    const queue = runtime.queue.forThread(id);
    const asyncQuestion =
      thread &&
      pendingAsyncQuestions(thread).find(
        (item) =>
          !runtime.questionDismissals.isIgnored(id, item.id) &&
          !queue.sentAnswers?.[item.id] &&
          !queue.items.some((task) => task.question?.itemId === item.id),
      );
    return {
      id,
      draft,
      thread,
      threadSettings: state.threadSettings[id],
      access,
      waiting,
      inputRequest,
      asyncQuestion,
      sending,
      localDraft: !!state.localDrafts[id],
      connected: connection.status === "connected",
      capabilities: conversationCapabilities({
        thread,
        access,
        draft,
        connected: connection.status === "connected",
        waiting,
        sending,
        stopping: stopLock.current,
        reading,
      }),
      ...composerModel(
        connection.models,
        thread,
        selection.chosenModel,
        selection.chosenEffort,
        state.localDrafts[id]
          ? state.localDrafts[id].options.model || getDefaultModel()
          : "",
        !!state.localDrafts[id],
      ),
    };
  }
  const isCurrent = () => runtime.connection.getSnapshot().epoch === epoch;

  async function command(name: string): Promise<CommandAction | undefined> {
    const state = current();
    if (!isCurrent() || !state.capabilities.canCommand) return;
    setError("");
    if (name === "skills" || name === "mention") return name;
    if (name === "model" || name === "permissions") {
      runtime.drafts.setText(state.id, "");
      return name;
    }
    if (name === "help" || name === "status") {
      setNotice(
        name === "help"
          ? t("/ 快捷命令 · $ 调用技能 · @ 引用文件 · Shift+Enter 换行")
          : t("模型：{{value0}} · 目录：{{value1}} · {{value2}}", {
              value0: state.modelId || t("服务端默认"),
              value1: state.thread?.cwd || t("未知"),
              value2: state.capabilities.executing ? t("执行中") : t("空闲"),
            }),
      );
      runtime.drafts.setText(state.id, "");
      return;
    }
    if (state.capabilities.running) {
      setError(t("请等待当前轮次结束后执行此命令。"));
      return;
    }
    commandLock.current = true;
    setCommandPending(true);
    try {
      if (name === "new")
        await runtime.sessions.create({ cwd: state.thread?.cwd });
      else if (name === "compact") {
        if (state.localDraft)
          throw new Error(t("发送第一条消息后才能压缩上下文。"));
        await runtime.connection.client.request("thread/compact/start", {
          threadId: state.id,
        });
      }
      if (isCurrent())
        runtime.drafts.clearIfRevision(state.id, state.draft.revision);
    } catch (error) {
      if (isCurrent()) setError(errorMessage(error));
    } finally {
      commandLock.current = false;
      setCommandPending(false);
    }
  }

  async function send(
    reading: boolean,
    mode: "queue" | "steer" = "queue",
  ): Promise<CommandAction | undefined> {
    const state = current(reading);
    if (!isCurrent() || !state.capabilities.canSend) return;
    const name = draftCommand(state.draft);
    if (name) {
      if (commands.some((entry) => entry.name === name)) return command(name);
      setError(
        t("未知命令 /{{value0}}，输入 / 查看支持的命令。", { value0: name }),
      );
      return;
    }
    if (
      state.draft.images.length &&
      !state.model?.inputModalities.includes("image")
    ) {
      setError(
        state.modelId
          ? t("当前模型未声明支持图片，请切换支持图片的模型。")
          : t("设备默认模型的图片能力未知，请先明确选择支持图片的模型。"),
      );
      return;
    }
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    )
      void Notification.requestPermission().catch(() => {});
    setError("");
    try {
      if (mode === "steer" && state.capabilities.running)
        setNotice(
          t(
            "立即引导沿用当前轮次的模型、审批与服务档位；下次发送设置不会应用到本次引导。",
          ),
        );
      await runtime.sendDraft(
        state.id,
        {
          ...(state.modelId ? { model: state.modelId } : {}),
          ...(state.effort ? { effort: state.effort } : {}),
          ...serviceTierOptions(
            state.model,
            selection.tierChoices?.[
              JSON.stringify([connection.scope, threadId])
            ],
          ),
          ...approvalOptions(
            selection.policyChoices?.[
              JSON.stringify([connection.scope, threadId])
            ],
          ),
        },
        mode,
      );
    } catch (error) {
      if (isCurrent()) setError(errorMessage(error));
    }
  }

  async function stop() {
    const state = current();
    if (!isCurrent() || !state.capabilities.canStop) return;
    stopLock.current = true;
    setStopping(true);
    setError("");
    try {
      await Promise.all([
        runtime.queue.pause(state.id, t("执行已停止，队列已暂停。")),
        runtime.sessions.interrupt(state.id),
      ]);
    } catch (error) {
      if (isCurrent()) setError(errorMessage(error));
    } finally {
      stopLock.current = false;
      setStopping(false);
    }
  }

  return {
    runtime,
    connection,
    sessions,
    ...current(),
    sending: commandPending || runtime.submissions.isSending(threadId),
    stopping,
    error,
    notice,
    setError,
    command,
    send,
    stop,
  };
}
