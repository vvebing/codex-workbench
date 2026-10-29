import { t, useLocale } from "../../lib/i18n";
import { useStore } from "../../components/hooks";
import { releaseCheck } from "../connection/release-check";
import { Button, ErrorNotice } from "../../components/ui";
import { hasStableUpdate } from "../../../server/codex-version";

export function AppServerVersion({ version }: { version: string | null }) {
  useLocale();
  const { latest, status, error } = useStore(releaseCheck);
  return (
    <div
      className="space-y-2 border-b border-border pb-4"
      data-slot="app-server-version"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm">
          {t("App-server：")}
          {version ?? t("版本未知")}
        </span>
        <Button
          type="button"
          size="sm"
          disabled={status === "loading"}
          onClick={() => void releaseCheck.check(true)}
        >
          {status === "loading" ? t("正在检查…") : t("检查更新")}
        </Button>
      </div>
      {status === "error" && (
        <ErrorNotice>
          {t("检查更新失败：")}
          {error} {t("当前连接不受影响。")}
        </ErrorNotice>
      )}
      <div role="status" className="text-xs leading-relaxed text-muted">
        {status === "ready" && latest && (
          <>
            {version
              ? hasStableUpdate(version, latest)
                ? t("发现新版本 {{v0}}。", { v0: latest })
                : t("未发现更新的稳定版本（最新发布：{{v0}}）。", {
                    v0: latest,
                  })
              : t("最新稳定版本为 {{v0}}；当前服务版本无法识别。", {
                  v0: latest,
                })}{" "}
            <a
              className="text-accent underline"
              href={`https://github.com/openai/codex/releases/tag/rust-v${encodeURIComponent(latest)}`}
              target="_blank"
              rel="noreferrer"
            >
              {t("查看发布说明")}
            </a>
            {version && hasStableUpdate(version, latest) && (
              <p className="mt-2">
                {t(
                  "请在该连接对应的设备上更新 Codex，重启 app-server 后重新连接。",
                )}
              </p>
            )}
          </>
        )}
        {status === "idle" && !version && t("该服务未返回可识别的版本标识。")}
      </div>
    </div>
  );
}
