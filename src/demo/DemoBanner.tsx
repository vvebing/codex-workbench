import { Button } from "../components/ui";
import { t, useLocale } from "../lib/i18n";
import { DEMO_FIRST_THREAD } from "./data";

export function DemoBanner() {
  useLocale();
  return (
    <div
      data-slot="demo-banner"
      className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-3 py-2 text-xs text-muted"
      role="note"
    >
      <p className="min-w-0 flex-1">
        {t(
          "演示模式：当前为真实工作台界面，数据与回复均为模拟，不连接本机或调用模型。刷新可恢复示例数据。",
        )}
      </p>
      <Button
        size="sm"
        variant="quiet"
        onClick={() => {
          const url = new URL(window.location.href);
          url.search = new URLSearchParams({
            env: "local",
            session: DEMO_FIRST_THREAD,
          }).toString();
          window.location.replace(url);
        }}
      >
        {t("重置演示")}
      </Button>
    </div>
  );
}
