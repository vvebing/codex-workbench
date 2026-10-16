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
  return (
    <div
      className="flex flex-wrap gap-2 border-b border-border pb-4"
      aria-label="选择要管理的工作环境"
    >
      {entries.map((entry) => {
        const connected =
          entry.runtime.connection.getSnapshot().status === "connected";
        return (
          <button
            type="button"
            className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2 text-xs hover:bg-hover aria-pressed:border-accent/50 aria-pressed:bg-selected aria-pressed:text-accent max-[900px]:min-h-11"
            key={entry.id}
            aria-pressed={selectedId === entry.id}
            disabled={disabled}
            onClick={() => onSelect(entry)}
          >
            <EnvironmentIcon environment={entry} focusable={false} />
            <span className="[overflow-wrap:anywhere]">{entry.name}</span>
            <span
              className={`inline-block size-1.5 shrink-0 rounded-full ${connected ? "bg-success" : "bg-border"}`}
              aria-label={connected ? "已连接" : "未连接"}
            />
          </button>
        );
      })}
      {draft && (
        <span className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-accent/50 bg-selected px-3 py-2 text-xs text-accent">
          <Server size={15} />
          新开发机
        </span>
      )}
    </div>
  );
}
