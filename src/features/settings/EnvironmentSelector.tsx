import { t, useLocale } from "../../lib/i18n";
import { Server } from "lucide-react";
import type { Environment } from "../connection/environments";
import { EnvironmentIcon } from "../connection/EnvironmentIcon";

export function EnvironmentSelector({
  entries,
  selectedId,
  onSelect,
  disabled = false,
  draft = false,
}: {
  entries: Environment[];
  selectedId: string;
  onSelect: (entry: Environment) => void;
  disabled?: boolean;
  draft?: boolean;
}) {
  useLocale();
  return (
    <div
      className="flex flex-wrap gap-1.5 border-b border-border pb-4"
      aria-label={t("选择要管理的工作环境")}
    >
      {entries.map((entry) => {
        const connected =
          entry.runtime.connection.getSnapshot().status === "connected";
        return (
          <button
            type="button"
            className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-md border border-transparent px-3 py-2 text-control text-muted hover:bg-hover aria-pressed:border-border aria-pressed:bg-elevated aria-pressed:font-medium aria-pressed:text-foreground max-[900px]:min-h-11"
            key={entry.id}
            aria-pressed={selectedId === entry.id}
            disabled={disabled}
            onClick={() => onSelect(entry)}
          >
            <EnvironmentIcon environment={entry} focusable={false} />
            <span className="[overflow-wrap:anywhere]">{entry.name}</span>
            <span
              className={`inline-block size-1.5 shrink-0 rounded-full ${connected ? "bg-success" : "bg-border"}`}
              aria-label={connected ? t("已连接") : t("未连接")}
            />
          </button>
        );
      })}
      {draft && (
        <span className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border bg-elevated px-3 py-2 text-control">
          <Server size={15} />
          {t("新开发机")}
        </span>
      )}
    </div>
  );
}
