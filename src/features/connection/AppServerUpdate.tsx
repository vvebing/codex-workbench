import { useEffect, useState } from "react";
import { useStore } from "../../components/hooks";
import { Button } from "../../components/ui";
import { environments, type Environment } from "./environments";
import { releaseCheck } from "./release-check";
import { hasStableUpdate } from "../../../server/codex-version";

function CheckOnConnect({ environment }: { environment: Environment }) {
  const { status, epoch } = useStore(environment.runtime.connection);
  useEffect(() => {
    if (status === "connected") void releaseCheck.check();
  }, [status, epoch]);
  return null;
}
export function AppServerReleaseChecks() {
  const { entries } = useStore(environments);
  return entries.map((environment) => (
    <CheckOnConnect key={environment.id} environment={environment} />
  ));
}
export function AppServerUpdateNotice({
  environment,
}: {
  environment: Environment;
}) {
  const connection = useStore(environment.runtime.connection);
  const release = useStore(releaseCheck);
  const [dismissed, setDismissed] = useState("");
  const key = `${environment.id}:${connection.epoch}:${connection.serverVersion}:${release.latest}`;
  if (
    connection.status !== "connected" ||
    !connection.serverVersion ||
    release.status !== "ready" ||
    !release.latest ||
    !hasStableUpdate(connection.serverVersion, release.latest) ||
    dismissed === key
  )
    return null;
  return (
    <div
      data-slot="app-server-update"
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-2 text-xs"
    >
      <p className="min-w-0 flex-1 break-words">
        {environment.name} 的 Codex 有更新：{connection.serverVersion} →{" "}
        {release.latest}。更新该设备并重启 app-server 后重新连接。
      </p>
      <a
        className="text-accent underline"
        href={`https://github.com/openai/codex/releases/tag/rust-v${encodeURIComponent(release.latest)}`}
        target="_blank"
        rel="noreferrer"
      >
        查看发布说明
      </a>
      <Button
        size="sm"
        variant="quiet"
        aria-label="关闭更新提示"
        onClick={() => setDismissed(key)}
      >
        关闭
      </Button>
    </div>
  );
}
