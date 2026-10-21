import { settingsInputClass } from "../settings/settings-ui";
import { useCapabilities } from "../settings/CapabilityPanel";
import { insertReference } from "./insert-reference";
import type { RpcMethod } from "../../lib/rpc";
import { useEffect, useMemo, useState } from "react";
import { Button, ErrorNotice, SelectField } from "../../components/ui";
import { useStore } from "../../components/hooks";
import { useRuntime } from "../../lib/runtime-context";
import { errorMessage } from "../../lib/store";
import type { Thread } from "../../generated/v2/Thread";
import type { ThreadGoal } from "../../generated/v2/ThreadGoal";
import type { ThreadGoalStatus } from "../../generated/v2/ThreadGoalStatus";
import type { ReviewTarget } from "../../generated/v2/ReviewTarget";
import { safeElicitationUrl } from "../approvals/validation";
import { ThreadToolsStore } from "./thread-tools-store";
import {
  attachmentLabel,
  goalParams,
  referenceAttachmentType,
  referenceParams,
  reviewTarget,
} from "./thread-tools-model";

const inputClass = `${settingsInputClass} my-1`;
const statusLabels: Record<ThreadGoalStatus, string> = {
  active: "进行中",
  paused: "已暂停",
  blocked: "受阻",
  usageLimited: "用量受限",
  budgetLimited: "预算受限",
  complete: "已完成",
};
function GoalEditor({
  goal,
  store,
  disabled,
  setUnsupported,
  clearUnsupported,
}: {
  goal: ThreadGoal | null;
  store: ThreadToolsStore;
  disabled: boolean;
  setUnsupported: boolean;
  clearUnsupported: boolean;
}) {
  const [objective, setObjective] = useState(goal?.objective ?? "");
  const [budget, setBudget] = useState(goal?.tokenBudget?.toString() ?? "");
  const [status, setStatus] = useState<ThreadGoalStatus>(
    goal?.status ?? "active",
  );
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        try {
          const params = goalParams(store.threadId, objective, status, budget);
          setError(null);
          void store.setGoal(params);
        } catch (error) {
          setError(errorMessage(error));
        }
      }}
    >
      <label className="block text-control font-medium">
        目标内容
        <textarea
          className={inputClass}
          required
          maxLength={4000}
          disabled={disabled}
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
        />
      </label>
      <label className="block text-control font-medium">
        目标状态
        <SelectField
          label="目标状态"
          className="my-1 w-full"
          disabled={disabled}
          value={status}
          onValueChange={(value) => setStatus(value as ThreadGoalStatus)}
          options={Object.entries(statusLabels).map(([value, label]) => ({
            value,
            label,
          }))}
        />
      </label>
      <label className="block text-control font-medium">
        Token 预算（留空不限）
        <input
          className={inputClass}
          type="number"
          min={1}
          step={1}
          disabled={disabled}
          value={budget}
          onChange={(event) => setBudget(event.target.value)}
        />
      </label>
      <p className="my-2 text-xs text-muted">
        更换目标内容会重置用量记录。保存目标可能让会话继续执行。
      </p>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={disabled || setUnsupported || !objective.trim()}
        >
          保存目标
        </Button>
        {goal && (
          <Button
            disabled={disabled || clearUnsupported}
            onClick={() => void store.clearGoal()}
          >
            清除目标
          </Button>
        )}
      </div>
    </form>
  );
}
export function ThreadTools({ thread }: { thread: Thread }) {
  const runtime = useRuntime();
  const connection = useStore(runtime.connection);
  const capabilities = useCapabilities(runtime.connection);
  const unsupported = (method: RpcMethod) =>
    capabilities[method]?.state === "unsupported";
  const unavailable = (
    [
      "thread/goal/get",
      "thread/goal/set",
      "thread/goal/clear",
      "thread/attachment/list",
      "thread/attachment/add",
      "thread/attachment/remove",
      "thread/attachmentOwner/list",
      "review/start",
    ] as const
  ).filter(unsupported);
  const [insertedReference, setInsertedReference] = useState(false);
  const sessions = useStore(runtime.sessions);
  const store = useMemo(
    () =>
      new ThreadToolsStore(
        thread.id,
        connection.epoch,
        runtime.connection,
        runtime.sessions,
      ),
    [thread.id, connection.epoch, runtime],
  );
  const state = useStore(store);
  useEffect(
    () => (connection.status === "connected" ? store.start() : undefined),
    [store, connection.status],
  );
  const [reviewType, setReviewType] =
    useState<ReviewTarget["type"]>("uncommittedChanges");
  const [reviewValue, setReviewValue] = useState("");
  const [referenceLabel, setReferenceLabel] = useState("");
  const [referenceLocation, setReferenceLocation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const running = !!runtime.sessions.activeTurn(thread.id);
  const disabled =
    connection.status !== "connected" ||
    state.busy ||
    !!sessions.localDrafts[thread.id] ||
    running;
  const act = (operation: () => void) => {
    try {
      setFormError(null);
      operation();
    } catch (error) {
      setFormError(errorMessage(error));
    }
  };
  return (
    <div className="space-y-5" aria-label="会话工具">
      {unavailable.length > 0 && (
        <p role="status" className="text-xs text-muted">
          服务端未提供：{unavailable.join("、")}
          。对应操作已禁用；可在设置的「服务端功能支持」清除具体接口记录后重新验证，其他接口仍可使用。
        </p>
      )}
      {insertedReference && (
        <p role="status" className="text-xs text-muted">
          参考资料已引用到输入框，请检查后发送。已关联不等于助手已阅读。
        </p>
      )}
      {running && (
        <p className="text-xs text-muted">
          会话执行期间可查看工具，结束后可修改。
        </p>
      )}
      {(state.error || formError) && (
        <ErrorNotice>{state.error || formError}</ErrorNotice>
      )}
      {state.message && <p role="status">{state.message}</p>}
      <details>
        <summary className="cursor-pointer font-semibold">会话目标</summary>
        <div className="mt-3">
          {state.goalError && (
            <ErrorNotice>无法读取目标：{state.goalError}</ErrorNotice>
          )}
          {state.goal && (
            <div className="mb-3 space-y-1 [overflow-wrap:anywhere]">
              <p>{state.goal.objective}</p>
              <p>状态：{statusLabels[state.goal.status]}</p>
              <p>
                Token 用量：{state.goal.tokensUsed} /{" "}
                {state.goal.tokenBudget ?? "不限"}
              </p>
              <p>运行时间：{state.goal.timeUsedSeconds} 秒</p>
            </div>
          )}
          {state.goalLoaded && (
            <GoalEditor
              key={JSON.stringify([
                thread.id,
                state.goal?.createdAt,
                state.goal?.objective,
                state.goal?.status,
                state.goal?.tokenBudget,
              ])}
              goal={state.goal}
              store={store}
              disabled={disabled}
              setUnsupported={unsupported("thread/goal/set")}
              clearUnsupported={unsupported("thread/goal/clear")}
            />
          )}
          <Button
            className="mt-2"
            size="sm"
            disabled={
              connection.status !== "connected" ||
              state.busy ||
              unsupported("thread/goal/get")
            }
            onClick={() => void store.loadGoal()}
          >
            刷新目标
          </Button>
        </div>
      </details>
      <details>
        <summary className="cursor-pointer font-semibold">代码审查</summary>
        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            act(
              () =>
                void store.startReview(reviewTarget(reviewType, reviewValue)),
            );
          }}
        >
          <label className="block text-control font-medium">
            审查范围
            <SelectField
              label="审查范围"
              className="my-1 w-full"
              disabled={disabled}
              value={reviewType}
              onValueChange={(value) => {
                setReviewType(value as ReviewTarget["type"]);
                setReviewValue("");
              }}
              options={[
                { value: "uncommittedChanges", label: "未提交修改" },
                { value: "baseBranch", label: "与分支比较" },
                { value: "commit", label: "指定提交" },
                { value: "custom", label: "自定义审查" },
              ]}
            />
          </label>
          {reviewType !== "uncommittedChanges" && (
            <label className="block text-control font-medium">
              {reviewType === "baseBranch"
                ? "基准分支"
                : reviewType === "commit"
                  ? "提交 SHA"
                  : "审查说明"}
              <input
                className={inputClass}
                required
                disabled={disabled}
                value={reviewValue}
                onChange={(event) => setReviewValue(event.target.value)}
              />
            </label>
          )}
          <Button
            type="submit"
            disabled={disabled || unsupported("review/start")}
          >
            开始审查
          </Button>
          <p className="mt-2 text-xs text-muted">
            审查在当前会话执行，结果显示在消息中。
          </p>
        </form>
      </details>
      <details>
        <summary className="cursor-pointer font-semibold">参考资料</summary>
        <div className="mt-3">
          <p className="mb-2 text-xs text-muted">
            保存链接或路径作为会话参考资料；不会上传文件内容。已关联不等于助手已阅读；可显式引用到输入框后发送。
          </p>
          {state.attachmentError && (
            <ErrorNotice>无法读取参考资料：{state.attachmentError}</ErrorNotice>
          )}
          {state.attachments.map((attachment) => {
            const own = attachment.attachmentType === referenceAttachmentType;
            const url = own
              ? safeElicitationUrl(attachment.identityKey)
              : undefined;
            return (
              <article
                className="mb-3 rounded border border-border p-2 [overflow-wrap:anywhere]"
                key={attachment.id}
              >
                {url ? (
                  <a
                    className="text-accent underline"
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {attachmentLabel(attachment)}
                  </a>
                ) : (
                  <p>{attachmentLabel(attachment)}</p>
                )}
                <p className="text-xs text-muted">{attachment.identityKey}</p>
                {!own && (
                  <p className="text-xs text-muted">
                    外部资料（只读）：{attachment.attachmentType}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      insertReference(
                        runtime.drafts,
                        thread.id,
                        attachmentLabel(attachment),
                        attachment.identityKey,
                      );
                      setInsertedReference(true);
                    }}
                  >
                    引用到输入框
                  </Button>
                  <Button
                    size="sm"
                    disabled={
                      connection.status !== "connected" ||
                      state.busy ||
                      unsupported("thread/attachmentOwner/list")
                    }
                    onClick={() => void store.findOwners(attachment)}
                  >
                    查看所属会话
                  </Button>
                  {own && (
                    <Button
                      size="sm"
                      disabled={
                        disabled || unsupported("thread/attachment/remove")
                      }
                      onClick={() => void store.removeAttachment(attachment)}
                    >
                      移除参考资料
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
          {state.attachmentCursor && (
            <Button
              disabled={
                connection.status !== "connected" ||
                state.busy ||
                unsupported("thread/attachment/list")
              }
              onClick={() => void store.loadAttachments(true)}
            >
              加载更多参考资料
            </Button>
          )}
          {state.owners && (
            <div className="my-3">
              <p className="font-medium">所属会话</p>
              {!state.owners.length && <p>没有匹配会话。</p>}
              {state.owners.map((owner) => (
                <p
                  key={owner.threadId}
                  className="text-xs [overflow-wrap:anywhere]"
                >
                  {owner.threadId}
                  {owner.archived ? "（已归档）" : ""}
                </p>
              ))}
              {state.ownerCursor && state.ownerIdentity && (
                <Button
                  disabled={
                    connection.status !== "connected" ||
                    state.busy ||
                    unsupported("thread/attachmentOwner/list")
                  }
                  onClick={() =>
                    void store.findOwners(state.ownerIdentity!, true)
                  }
                >
                  加载更多所属会话
                </Button>
              )}
            </div>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              act(
                () =>
                  void store.addReference(
                    referenceParams(
                      thread.id,
                      referenceLabel,
                      referenceLocation,
                    ),
                  ),
              );
            }}
          >
            <label className="block text-control font-medium">
              资料名称
              <input
                className={inputClass}
                disabled={disabled}
                value={referenceLabel}
                onChange={(event) => setReferenceLabel(event.target.value)}
              />
            </label>
            <label className="block text-control font-medium">
              链接或文件路径
              <input
                className={inputClass}
                required
                disabled={disabled}
                value={referenceLocation}
                onChange={(event) => setReferenceLocation(event.target.value)}
              />
            </label>
            <Button
              type="submit"
              disabled={
                disabled ||
                unsupported("thread/attachment/add") ||
                !referenceLocation.trim()
              }
            >
              保存参考资料
            </Button>
          </form>
          <Button
            className="mt-2"
            size="sm"
            disabled={
              connection.status !== "connected" ||
              state.busy ||
              unsupported("thread/attachment/list")
            }
            onClick={() => void store.loadAttachments()}
          >
            刷新参考资料
          </Button>
        </div>
      </details>
    </div>
  );
}
