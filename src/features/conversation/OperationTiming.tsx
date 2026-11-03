import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ThreadItem } from "../../generated/v2/ThreadItem";
import { t } from "../../lib/i18n";
import {
  operationDurationMs,
  operationElapsedMs,
  validItemTime,
} from "./operation-timing";

export function OperationTiming({
  item,
  status,
}: {
  item: ThreadItem;
  status: string;
}) {
  useTranslation();
  const [now, setNow] = useState(Date.now);
  const running =
    operationDurationMs(item) === null &&
    validItemTime(item.startedAtMs) &&
    item.completedAtMs == null &&
    ["inProgress", "in_progress", "waiting"].includes(status);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, item.startedAtMs]);
  const duration = operationElapsedMs(item, status, now);
  if (duration === null) return null;
  const seconds = (duration / 1000).toFixed(1);
  return (
    <small
      className="shrink-0 whitespace-nowrap text-meta tabular-nums text-muted"
      title={
        running
          ? t("步骤已用时 {{value0}} 秒", { value0: seconds })
          : t("步骤耗时 {{value0}} 秒", { value0: seconds })
      }
    >
      {running
        ? t("已用时 {{value0}} 秒", { value0: seconds })
        : t("{{value0}} 秒", { value0: seconds })}
    </small>
  );
}
