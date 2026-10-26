import { t, useLocale, getLocale } from "../../lib/i18n";
import { Progress } from "radix-ui";
import { Button, Modal, ScrollArea } from "../../components/ui";
import { useEffect, useState } from "react";
import { useStore } from "../../components/hooks";
import type { ConnectionStore } from "./store";
import type { RateLimitReachedType } from "../../generated/v2/RateLimitReachedType";
import type { RateLimitSnapshot } from "../../generated/v2/RateLimitSnapshot";
import type { RateLimitWindow } from "../../generated/v2/RateLimitWindow";
import {
  accountTime,
  planLabel,
  quotaWindowLabel,
} from "./account-presentation";

const limitLabels: Record<RateLimitReachedType, string> = {
  get rate_limit_reached() {
    return t("已达到用量上限");
  },
  get workspace_owner_credits_depleted() {
    return t("工作区额度已耗尽");
  },
  get workspace_member_credits_depleted() {
    return t("成员额度已耗尽");
  },
  get workspace_owner_usage_limit_reached() {
    return t("已达到工作区用量上限");
  },
  get workspace_member_usage_limit_reached() {
    return t("已达到成员用量上限");
  },
};

function UsageWindow({
  window,
  index,
}: {
  window: RateLimitWindow;
  index: number;
}) {
  const i18nLocale = useLocale();
  void i18nLocale;

  const label = quotaWindowLabel(window.windowDurationMins, index);
  const used = Number.isFinite(window.usedPercent) ? window.usedPercent : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-between gap-2">
        <span>{label}</span>
        <span>
          {used == null
            ? t("用量暂未提供")
            : t("已用 {{value0}}% · 剩余 {{value1}}%", {
                value0: used,
                value1: Math.max(0, 100 - used),
              })}
        </span>
      </div>
      {used != null && (
        <Progress.Root
          aria-label={label}
          max={100}
          value={Math.min(100, Math.max(0, used))}
          aria-valuetext={t("已用 {{value0}}%", { value0: used })}
          className="h-2 overflow-hidden rounded-full bg-hover"
        >
          <Progress.Indicator
            className={`h-full rounded-full ${used >= 100 ? "bg-danger" : used >= 80 ? "bg-warning" : "bg-accent"}`}
            style={{ width: `${Math.min(100, Math.max(0, used))}%` }}
          />
        </Progress.Root>
      )}
      <p className="text-xs text-muted">
        {t("额度重置时间：")}
        {accountTime(window.resetsAt)}
      </p>
    </div>
  );
}

function UsageBucket({
  snapshot,
  id,
}: {
  snapshot: RateLimitSnapshot;
  id: string;
}) {
  const i18nLocale = useLocale();
  void i18nLocale;

  const credits = snapshot.credits;
  const individual = snapshot.individualLimit;
  return (
    <section className="space-y-4 rounded-lg border border-border p-3">
      <h5 className="text-sm font-medium">
        {snapshot.limitName ||
          snapshot.limitId ||
          (id === "default" ? t("Codex 用量") : id)}
      </h5>
      {snapshot.rateLimitReachedType && (
        <p className="text-danger">
          {limitLabels[snapshot.rateLimitReachedType] ?? t("用量受限")}
        </p>
      )}
      {snapshot.spendControlReached === true && (
        <p className="text-danger">{t("已达到支出控制上限")}</p>
      )}
      {[snapshot.primary, snapshot.secondary].map(
        (window, index) =>
          window && <UsageWindow key={index} window={window} index={index} />,
      )}
      {!snapshot.primary && !snapshot.secondary && (
        <p className="text-muted">{t("暂未提供用量窗口。")}</p>
      )}
      {credits && (
        <div className="space-y-1 border-t border-border pt-3">
          <p>
            {t("额外额度：")}
            {credits.unlimited
              ? t("不限额")
              : credits.balance != null
                ? credits.balance
                : credits.hasCredits
                  ? t("有可用额度")
                  : t("暂无可用额度")}
          </p>
          <p className="text-xs text-muted">
            {t("余额按服务端返回展示，未提供币种。")}
          </p>
        </div>
      )}
      {individual && (
        <div className="space-y-1 border-t border-border pt-3">
          <p>
            {t("个人支出额度：已用")}
            {individual.used} / {individual.limit}
          </p>
          <p>
            {t("剩余")}
            {individual.remainingPercent}%
          </p>
          <p className="text-xs text-muted">
            {t("额度重置时间：")}
            {accountTime(individual.resetsAt)}
          </p>
        </div>
      )}
    </section>
  );
}

function ResetCredits({ connection }: { connection: ConnectionStore }) {
  const i18nLocale = useLocale();
  void i18nLocale;
  const state = useStore(connection);
  const [selection, setSelection] = useState<{ id?: string } | null>(null);
  useEffect(() => setSelection(null), [state.epoch, state.accountDetails]);
  const summary = state.rateLimits?.rateLimitResetCredits;
  const credits = summary?.credits ?? [];
  const countOnly =
    summary?.credits === null && Number(summary.availableCount) > 0;
  const selected = credits.find((credit) => credit.id === selection?.id);
  const busy =
    state.rateLimitResetStatus === "consuming" ||
    state.rateLimitResetStatus === "refreshing";
  const disabled =
    !state.accountDetails?.account ||
    !summary ||
    Number(summary.availableCount) <= 0 ||
    state.status !== "connected" ||
    state.rateLimitsStatus !== "ready" ||
    busy ||
    state.rateLimitResetStatus === "unsupported";
  const usable = (credit: (typeof credits)[number]) =>
    credit.status === "available" &&
    credit.resetType === "codexRateLimits" &&
    (credit.expiresAt == null || credit.expiresAt * 1000 > Date.now());
  const outcomes = {
    reset: t("已使用一次重置机会，请以最新用量为准。"),
    alreadyRedeemed: t("这次重置已处理，请以最新用量为准。"),
    nothingToReset: t("当前没有符合条件的用量窗口可重置。"),
    noCredit: t("当前没有可用的重置次数。"),
  };
  const feedback = (
    <>
      {state.rateLimitResetOutcome && (
        <p role="status">{outcomes[state.rateLimitResetOutcome]}</p>
      )}
      {state.rateLimitResetError && (
        <p role="alert" className="break-words text-danger">
          {state.rateLimitResetError}
        </p>
      )}
    </>
  );
  if (!summary || Number(summary.availableCount) <= 0) return feedback;
  return (
    <section className="space-y-3 rounded-lg border border-border p-3">
      <h5 className="text-sm font-medium">{t("主动重置额度")}</h5>
      {summary && (
        <p>
          {t("可用重置次数：")}
          {String(summary.availableCount)}
        </p>
      )}
      <p className="text-xs text-muted">
        {t("使用已获得的重置机会，重置符合条件的 Codex 用量窗口。")}
      </p>
      {summary && !credits.length && (
        <p className="text-xs text-muted">
          {Number(summary.availableCount) > 0
            ? countOnly
              ? t(
                  "服务端仅提供次数，使用时会自动选择一个可用重置机会，有效期暂未提供。",
                )
              : t("服务端未返回可用重置明细，请刷新用量后再试。")
            : t("暂无可用重置机会，可等待额度自动重置。")}
        </p>
      )}
      {countOnly && (
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={() => setSelection({})}
        >
          {t("使用一次重置机会")}
        </Button>
      )}
      {credits.map((credit) => (
        <div key={credit.id} className="space-y-2 border-t border-border pt-3">
          <p className="font-medium">{credit.title || t("Codex 额度重置")}</p>
          {credit.description && (
            <p className="break-words text-muted">{credit.description}</p>
          )}
          <p className="text-xs text-muted">
            {t("有效期：")}
            {credit.expiresAt == null
              ? t("无到期时间")
              : accountTime(credit.expiresAt)}
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || !usable(credit)}
            onClick={() => setSelection({ id: credit.id })}
          >
            {usable(credit) ? t("使用此重置机会") : t("当前不可使用")}
          </Button>
        </div>
      ))}
      {feedback}
      <Modal
        open={!!selection}
        onOpenChange={(open) => {
          if (!open && !busy) setSelection(null);
        }}
        title={t("确认使用额度重置")}
        description={t(
          "将消耗一次已获得的重置机会。服务端决定可重置的用量窗口，此操作不能撤销。",
        )}
      >
        <div className="space-y-4">
          <p className="text-sm">
            {selected?.title || t("由服务端选择一个可用重置机会")}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button disabled={busy} onClick={() => setSelection(null)}>
              {t("取消")}
            </Button>
            <Button
              variant="primary"
              disabled={
                disabled ||
                (selection?.id ? !selected || !usable(selected) : !countOnly)
              }
              onClick={async () => {
                if (!selection) return;
                await connection.consumeRateLimitResetCredit(selection.id);
                setSelection((current) =>
                  current === selection ? null : current,
                );
              }}
            >
              {busy ? t("正在处理…") : t("确认使用一次")}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

export function AccountStatus({ connection }: { connection: ConnectionStore }) {
  const i18nLocale = useLocale();
  void i18nLocale;
  const state = useStore(connection);
  useEffect(() => {
    if (state.status === "connected") void connection.loadRateLimits();
  }, [connection, state.epoch, state.status]);
  const account = state.accountDetails?.account;
  const snapshots = state.rateLimits?.rateLimitsByLimitId;
  const buckets =
    snapshots && Object.values(snapshots).some(Boolean)
      ? Object.entries(snapshots).flatMap(([id, value]) =>
          value ? [[id, value] as const] : [],
        )
      : state.rateLimits
        ? [["default", state.rateLimits.rateLimits] as const]
        : [];
  const chatgpt = account?.type === "chatgpt";
  const plan = chatgpt ? account.planType : null;
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
        <dt className="text-muted">{t("账号")}</dt>
        <dd className="break-words">{state.account}</dd>
        <dt className="text-muted">{t("登录方式")}</dt>
        <dd>
          {chatgpt
            ? "ChatGPT"
            : account?.type === "apiKey"
              ? "API Key"
              : account?.type === "amazonBedrock"
                ? "Amazon Bedrock"
                : state.accountDetails?.requiresOpenaiAuth === false
                  ? t("当前提供方无需 OpenAI 登录")
                  : t("暂未登录或尚未读取")}
        </dd>
        {chatgpt && (
          <>
            <dt className="text-muted">{t("套餐")}</dt>
            <dd>{planLabel(plan)}</dd>
          </>
        )}
      </dl>
      {account?.type === "apiKey" && (
        <p className="text-xs text-muted">
          {t("API Key 按 API 账户计费，不使用 ChatGPT 套餐额度。")}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">
          {
            {
              unknown: t("尚未加载用量"),
              loading: state.rateLimits
                ? t("正在刷新用量…")
                : t("正在加载用量…"),
              ready: t("用量快照"),
              error: t("用量暂时不可用"),
              unsupported: t("当前服务端不支持查询用量"),
            }[state.rateLimitsStatus]
          }
        </span>
        <Button
          variant="quiet"
          size="sm"
          type="button"
          disabled={
            state.status !== "connected" ||
            state.rateLimitsStatus === "loading" ||
            state.rateLimitResetStatus === "consuming" ||
            state.rateLimitResetStatus === "refreshing"
          }
          onClick={() => void connection.loadRateLimits()}
        >
          {t("刷新用量")}
        </Button>
      </div>
      {state.rateLimitsError && state.rateLimitsStatus === "error" && (
        <p role="status" className="break-words text-xs text-danger">
          {state.rateLimitsError}
        </p>
      )}
      {state.rateLimitsUpdatedAt && (
        <p className="text-xs text-muted">
          {t("更新于")}
          {new Date(state.rateLimitsUpdatedAt).toLocaleString(getLocale())}{" "}
          {t("· 时间按本地时区显示")}
        </p>
      )}
      {state.rateLimits?.ordinaryUsageAllowed === false && (
        <p role="status" className="text-danger">
          {t("套餐内用量已受限，请等待额度重置或检查可用重置机会。")}
        </p>
      )}
      {buckets.map(([id, snapshot]) => (
        <UsageBucket key={id} id={id} snapshot={snapshot} />
      ))}
      <ResetCredits connection={connection} />
    </div>
  );
}

export function ConnectionNotices({
  connection,
}: {
  connection: ConnectionStore;
}) {
  const i18nLocale = useLocale();
  void i18nLocale;
  const { notices } = useStore(connection);
  if (!notices.length) return null;
  return (
    <ScrollArea
      role="status"
      className="max-h-40 shrink-0 border-b border-border bg-surface text-xs"
      viewportProps={{ className: "px-4 py-2" }}
    >
      <div className="space-y-1">
        {notices.map((notice) => (
          <div
            key={notice.id}
            className="flex items-center justify-between gap-3"
          >
            <p className="min-w-0 break-words">
              {notice.message}
              {notice.threadId && (
                <span className="text-muted">
                  {" "}
                  {t("· 会话")}
                  {notice.threadId}
                </span>
              )}
            </p>
            <Button
              variant="quiet"
              size="sm"
              type="button"
              className="shrink-0 text-muted"
              aria-label={t("关闭通知")}
              onClick={() => connection.dismissNotice(notice.id)}
            >
              {t("关闭")}
            </Button>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
