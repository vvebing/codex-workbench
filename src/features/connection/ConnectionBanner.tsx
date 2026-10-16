import { useRef, useState } from "react";
import { Button } from "../../components/ui";
import type { Environment } from "./environments";
import { sameEndpoint, type ConnectionState } from "./store";

export function ConnectionBanner({
  environment,
  connection,
  onSettings,
}: {
  environment: Environment;
  connection: ConnectionState;
  onSettings: () => void;
}) {
  const { runtime } = environment;
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  if (connection.status === "connected") return null;
  const connecting = pending || connection.status === "connecting";
  async function reconnect() {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    try {
      if (sameEndpoint(connection.url, environment.url))
        await runtime.reconnect();
      else await runtime.connect(environment.url);
    } catch {
      // ConnectionStore exposes the error and preserves cached sessions.
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <div
      data-slot="connection-banner"
      role="status"
      className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-5 py-2 text-xs text-muted"
    >
      <div className="min-w-0 flex-1">
        <p>
          {connecting
            ? `正在连接「${environment.name}」…`
            : `「${environment.name}」未连接。已加载的会话仍可浏览，草稿可以继续编辑；重连后同步最新内容。`}
        </p>
        {connection.error && (
          <p className="mt-1 break-words text-danger">{connection.error}</p>
        )}
      </div>
      <Button size="sm" disabled={connecting} onClick={() => void reconnect()}>
        {connecting ? "连接中…" : "重新连接"}
      </Button>
      <Button size="sm" variant="secondary" onClick={onSettings}>
        连接设置
      </Button>
    </div>
  );
}
