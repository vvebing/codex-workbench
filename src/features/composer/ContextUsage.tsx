import { getLocale, t, useLocale } from "../../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { ScrollArea } from "../../components/ui";
import type { ThreadTokenUsage } from "../../generated/v2/ThreadTokenUsage";

const formatTokens = (value: number) =>
  new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 }).format(
    value,
  );

export function ContextUsage({ usage }: { usage?: ThreadTokenUsage }) {
  const i18nLocale = useLocale();
  void i18nLocale;

  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const used = usage ? Math.max(0, usage.last.totalTokens) : null;
  const capacity = usage?.modelContextWindow;
  const known = used !== null && capacity != null && capacity > 0;
  const percent = known
    ? Math.min(100, Math.round((used / capacity) * 100))
    : null;
  const reveal = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  const dismiss = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 150);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`flex min-h-[30px] shrink-0 items-center gap-[5px] whitespace-nowrap rounded-[7px] border-0 bg-transparent px-[7px] py-1.5 text-meta tabular-nums hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent max-[550px]:min-h-10 max-[550px]:px-1 max-[550px]:text-fine ${percent !== null && percent >= 80 ? "text-warning" : "text-muted"}`}
          aria-label={t("上下文：{{value0}}", {
            value0:
              percent !== null
                ? `${percent}%`
                : used === null
                  ? t("暂无数据")
                  : t("{{value0}} tokens（上限未知）", {
                      value0: formatTokens(used),
                    }),
          })}
          onClick={(event) => {
            event.preventDefault();
            reveal();
          }}
          onMouseEnter={reveal}
          onMouseLeave={dismiss}
          onFocus={reveal}
          onBlur={dismiss}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
            <circle
              className="fill-none stroke-border stroke-[2.5]"
              cx="10"
              cy="10"
              r="7"
            />
            {percent !== null && (
              <circle
                className="fill-none stroke-current stroke-[2.5]"
                cx="10"
                cy="10"
                r="7"
                pathLength="100"
                strokeDasharray={`${percent} 100`}
                transform="rotate(-90 10 10)"
              />
            )}
          </svg>
          <span>
            {percent !== null
              ? t("上下文 {{value0}}%", { value0: percent })
              : used === null
                ? t("上下文：暂无数据")
                : t("上下文 {{value0}} tokens", { value0: formatTokens(used) })}
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-[100] w-[min(300px,calc(100vw-24px))] overflow-hidden rounded-xl border border-border bg-elevated text-xs leading-help text-muted shadow-lg"
          side="top"
          align="end"
          sideOffset={10}
          aria-label={t("上下文使用量详情")}
          onMouseEnter={reveal}
          onMouseLeave={dismiss}
          onFocusCapture={reveal}
          onBlurCapture={dismiss}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <ScrollArea
            className="max-h-[var(--radix-popover-content-available-height)]"
            viewportProps={{ className: "px-4 py-3.5" }}
          >
            <strong className="text-control text-foreground">
              {t("上下文使用量")}
            </strong>
            {known ? (
              <>
                <p className="mt-1.5 text-foreground tabular-nums">
                  {t("已用")}
                  {formatTokens(used)} / {formatTokens(capacity)} tokens ·{" "}
                  {percent}%
                </p>
                <p className="mt-1.5">
                  {t("剩余约")}
                  {formatTokens(Math.max(0, capacity - used))} tokens
                </p>
                {percent !== null && percent >= 80 && (
                  <p className="mt-1.5 text-warning">{t("上下文接近上限。")}</p>
                )}
              </>
            ) : (
              <p className="mt-1.5">
                {used === null
                  ? t("等待服务端上报上下文用量。")
                  : t("已用 {{value0}} tokens；服务端尚未提供上下文上限。", {
                      value0: formatTokens(used),
                    })}
              </p>
            )}
            <p className="mt-2.5 border-t border-border pt-2.5 text-meta">
              {t(
                "根据最近一次模型请求的用量更新，包含输入与输出，不代表累计消耗。当前草稿尚未计入。历史会话若没有服务端用量通知，会显示暂无数据；不代表上下文为空。",
              )}
            </p>
          </ScrollArea>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
