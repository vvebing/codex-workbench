import { useEffect, useRef, useState } from "react";
import type { AppServerOutput } from "../../../server/app-server";
import { SettingsSection } from "./settings-ui";
import { ScrollArea } from "../../components/ui";

const labels: Record<AppServerOutput["status"], string> = {
  starting: "正在启动",
  running: "进程运行中",
  external: "使用已有服务",
  unavailable: "输出不可用",
  exited: "进程已退出",
  stopped: "进程已停止",
};

export function AppServerTerminal() {
  const [snapshot, setSnapshot] = useState<AppServerOutput>();
  const [error, setError] = useState("");
  const [follow, setFollow] = useState(true);
  const output = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch("/app-server-output", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as AppServerOutput;
        if (!(data.status in labels) || typeof data.output !== "string")
          throw new Error("服务未提供终端输出接口，请更新并重启网页服务。");
        setSnapshot(data);
        setError("");
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 1000);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (follow && output.current)
      output.current.scrollTop = output.current.scrollHeight;
  }, [snapshot?.output, follow]);
  return (
    <SettingsSection
      title="本机 app-server 终端输出"
      description="显示当前网页服务启动的 Codex 进程的标准输出与标准错误，保留最近 128 KiB。原始输出也会继续显示在 npm start 所在的终端。"
    >
      {import.meta.env.DEV ? (
        <p className="text-sm text-muted">
          开发模式不启动 app-server，请在手动启动它的终端查看输出。
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
            <span>{snapshot ? labels[snapshot.status] : "正在读取输出…"}</span>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={follow}
                onChange={(event) => setFollow(event.target.checked)}
              />
              跟随最新输出
            </label>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              读取失败：{error}
            </p>
          )}
          <ScrollArea
            viewportRef={output}
            viewportProps={{
              "aria-label": "app-server 终端输出",
              tabIndex: 0,
              className: "p-3",
            }}
            className="h-80 rounded-lg border border-border bg-surface"
          >
            <pre className="m-0 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all select-text">
              {snapshot?.output || "暂无终端输出。"}
            </pre>
          </ScrollArea>
        </>
      )}
    </SettingsSection>
  );
}
