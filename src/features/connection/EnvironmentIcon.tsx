import { useState } from "react";
import { LoaderCircle, Monitor, Server } from "lucide-react";
import { Tooltip } from "radix-ui";
import type { ConnectionState } from "./store";
import type { Environment } from "./environments";
export function EnvironmentIcon({
  environment,
  cwd,
  connection,
  size = 15,
  focusable = true,
  tooltipSide = "right",
}: {
  environment: Pick<Environment, "name" | "kind">;
  cwd?: string;
  connection?: Pick<ConnectionState, "status" | "error">;
  size?: number;
  focusable?: boolean;
  tooltipSide?: "top" | "right" | "bottom" | "left";
}) {
  const [open, setOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const Icon = environment.kind === "local" ? Monitor : Server;
  const label = `${environment.name}${cwd ? ` · ${cwd}` : ""}`;
  const tooltip = connection?.error ? `${label} · ${connection.error}` : label;
  const statusLabel =
    connection?.status === "connected"
      ? "已连接"
      : connection?.status === "connecting"
        ? "连接中"
        : connection?.error
          ? "连接失败"
          : "未连接";
  return (
    <Tooltip.Provider delayDuration={250}>
      <Tooltip.Root open={open || focusOpen} onOpenChange={setOpen}>
        <Tooltip.Trigger asChild>
          <span
            data-slot="environment-icon"
            className="inline-flex shrink-0 items-center rounded text-muted focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent"
            tabIndex={focusable ? 0 : undefined}
            aria-label={label}
            role="img"
            onFocus={() => setFocusOpen(true)}
            onBlur={() => setFocusOpen(false)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setFocusOpen(false);
                setOpen(false);
              }
            }}
          >
            <Icon size={size} aria-hidden="true" />
            {connection && (
              <span
                role="img"
                aria-label={statusLabel}
                data-slot="environment-status"
                data-status={connection.status}
                className="ml-1 inline-flex items-center"
              >
                {connection.status === "connecting" ? (
                  <LoaderCircle
                    size={10}
                    className="animate-spin text-accent"
                    aria-hidden="true"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className={`size-1.5 rounded-full ${connection.status === "connected" ? "bg-success" : connection.error ? "bg-danger" : "bg-subtle"}`}
                  />
                )}
              </span>
            )}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="z-[100] max-w-[min(420px,90vw)] rounded-md bg-elevated px-3 py-2 text-xs text-foreground shadow-lg [overflow-wrap:anywhere]"
            side={tooltipSide}
            sideOffset={8}
            collisionPadding={8}
          >
            {tooltip}
            <Tooltip.Arrow className="fill-elevated" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
