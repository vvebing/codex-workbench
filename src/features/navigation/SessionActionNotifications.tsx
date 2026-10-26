import { t, useLocale } from "../../lib/i18n";
import { X } from "lucide-react";
import { useStore } from "../../components/hooks";
import { Button, IconButton } from "../../components/ui";
import { sessionActions } from "./session-actions";

/** Render once at application level, outside session rows and runtime providers. */
export function SessionActionNotifications() {
  const i18nLocale = useLocale();
  void i18nLocale;

  const { notices } = useStore(sessionActions);
  if (!notices.length) return null;
  return (
    <div
      className="fixed bottom-6 left-1/2 z-80 flex w-[min(460px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2"
      aria-label={t("会话操作提示")}
    >
      {notices.map((notice) => (
        <div
          key={notice.id}
          role={notice.error ? "alert" : "status"}
          className="rounded-xl border border-border bg-elevated px-3.5 py-2.5 text-xs shadow-lg"
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate" title={notice.title}>
              {notice.restored ? t("已恢复") : t("已归档")}「{notice.title}」
            </span>
            {!notice.restored && (
              <Button
                variant="secondary"
                size="sm"
                disabled={notice.busy}
                onClick={() => void sessionActions.undo(notice.id)}
              >
                {notice.busy ? t("恢复中…") : t("撤销")}
              </Button>
            )}
            <IconButton
              label={t("关闭归档提示")}
              disabled={notice.busy}
              onClick={() => sessionActions.dismiss(notice.id)}
            >
              <X size={14} />
            </IconButton>
          </div>
          {notice.error && (
            <p className="mt-2 text-danger">
              {notice.restored
                ? t("会话已恢复，刷新失败：{{value0}}", {
                    value0: notice.error,
                  })
                : notice.error}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
