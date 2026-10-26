import { useTranslation } from "react-i18next";
import { t } from "../../lib/i18n";
import { useState } from "react";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import type { LocalMessage } from "../composer/local-messages";
import { Button, Modal } from "../../components/ui";
export function LocalDeliveryStatus({
  message,
  onDismiss,
  onRestore,
}: {
  message: LocalMessage;
  onDismiss: () => void;
  onRestore?: () => void;
}) {
  useTranslation();
  const [discarding, setDiscarding] = useState(false);
  const needsReview =
    message.status === "failed" || message.status === "uncertain";
  const label =
    message.status === "creating"
      ? t("正在创建会话…")
      : message.status === "sending"
        ? t("正在发送…")
        : message.status === "accepted"
          ? t("服务器已接收，等待消息记录同步…")
          : message.status === "failed"
            ? t("发送失败：{{value0}}", {
                value0: message.error ?? t("服务器拒绝了此消息"),
              })
            : t("发送结果待核实：{{value0}}", {
                value0: message.error ?? t("连接中断"),
              });
  return (
    <div
      data-slot="local-delivery-status"
      className="absolute top-4 right-2.5 z-10 text-muted"
    >
      {!needsReview && (
        <span
          role="status"
          aria-label={label}
          title={label}
          className="inline-flex size-7 items-center justify-center"
        >
          {message.status === "accepted" ? (
            <Check size={15} aria-hidden="true" />
          ) : (
            <LoaderCircle
              size={15}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
        </span>
      )}
      {needsReview && (
        <details open>
          <summary
            aria-label={label}
            title={label}
            className="flex size-7 cursor-pointer list-none items-center justify-center rounded-md text-danger hover:bg-hover [&::-webkit-details-marker]:hidden"
          >
            <CircleAlert size={15} />
          </summary>
          <div className="absolute top-8 right-0 w-64 max-w-[calc(100vw-4rem)] rounded-lg border border-border bg-elevated p-3 text-xs text-muted shadow-lg">
            <p role="status" className="mb-2 text-danger">
              {label}
            </p>
            <p>
              {message.status === "uncertain"
                ? t(
                    "不会自动重发。请先核实会话记录，确认未送达后再恢复编辑并手动发送。",
                  )
                : t("消息内容已保留，可恢复到输入框修改后发送。")}
            </p>
            {onRestore && (
              <Button
                variant="quiet"
                size="sm"
                className="mt-1 mr-2"
                onClick={onRestore}
              >
                {t("恢复到输入框")}
              </Button>
            )}
            <Button
              variant="quiet"
              size="sm"
              className="mt-1"
              onClick={() => setDiscarding(true)}
            >
              {t("丢弃消息")}
            </Button>
            <Modal
              open={discarding}
              onOpenChange={setDiscarding}
              title={t("丢弃消息？")}
            >
              <p className="text-sm text-muted">
                {t(
                  "将删除此消息在当前页面保留的内容，无法恢复。此操作不会撤回服务器可能已接收的消息。",
                )}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="quiet" onClick={() => setDiscarding(false)}>
                  {t("取消")}
                </Button>
                <Button variant="danger" onClick={onDismiss}>
                  {t("确认丢弃")}
                </Button>
              </div>
            </Modal>
          </div>
        </details>
      )}
    </div>
  );
}
