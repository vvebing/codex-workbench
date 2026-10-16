import { ScrollArea, Button, Modal } from "../../components/ui";
import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";

import { titleOf, useStore, folderOf } from "../../components/hooks";
import { useRuntime } from "../../lib/runtime-context";
import type { Thread } from "../../generated/v2/Thread";
export function HistoryDialog({
  open,
  onOpenChange,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onRestored: () => void;
}) {
  const runtime = useRuntime();
  const connection = useStore(runtime.connection);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const lock = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    setThreads([]);
    setCursor(null);
    setError("");
    lock.current = false;
    setBusy(false);
    if (!open || connection.status !== "connected") return;
    setBusy(true);
    lock.current = true;
    void runtime.connection.client
      .request<{ data: Thread[]; nextCursor: string | null }>("thread/list", {
        archived: true,
        limit: 30,
        sortKey: "updated_at",
      })
      .then((page) => {
        if (generation.current === current) {
          setThreads(page.data);
          setCursor(page.nextCursor);
        }
      })
      .catch((e: unknown) => {
        if (generation.current === current)
          setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (generation.current === current) {
          lock.current = false;
          setBusy(false);
        }
      });
    return () => {
      generation.current = current + 1;
    };
  }, [open, runtime, connection.epoch, connection.status]);
  async function action(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const current = generation.current;
    try {
      await task();
    } catch (e) {
      if (generation.current === current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (generation.current === current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="历史会话"
      description="当前环境中已归档的会话；恢复后可继续对话。"
    >
      {connection.status !== "connected" && <p>请先连接此环境。</p>}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <ScrollArea className="max-h-[50vh]">
        <div>
          {threads.map((thread) => (
            <button
              type="button"
              className="flex w-full items-center gap-3 border-b border-border bg-elevated p-3 text-left hover:bg-surface"
              key={thread.id}
              disabled={busy || connection.status !== "connected"}
              onClick={() =>
                void action(async () => {
                  const epoch = runtime.connection.getSnapshot().epoch;
                  await runtime.connection.client.request("thread/unarchive", {
                    threadId: thread.id,
                  });
                  if (runtime.connection.getSnapshot().epoch !== epoch) return;
                  await runtime.sessions.refresh();
                  await runtime.sessions.open(thread.id);
                  onRestored();
                  onOpenChange(false);
                })
              }
            >
              <RotateCcw size={16} />
              <span className="min-w-0">
                <strong className="block truncate">{titleOf(thread)}</strong>
                <small className="mt-1 block truncate text-muted">
                  {folderOf(thread.cwd)}
                </small>
              </span>
            </button>
          ))}
        </div>
      </ScrollArea>
      {!threads.length && !busy && connection.status === "connected" && (
        <p className="text-muted">暂无归档会话。</p>
      )}
      {busy && <p role="status">正在加载…</p>}
      {cursor && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              const current = generation.current;
              const page = await runtime.connection.client.request<{
                data: Thread[];
                nextCursor: string | null;
              }>("thread/list", {
                archived: true,
                limit: 30,
                sortKey: "updated_at",
                cursor,
              });
              if (generation.current !== current) return;
              setThreads((old) => [...old, ...page.data]);
              setCursor(page.nextCursor);
            })
          }
        >
          加载更多历史
        </Button>
      )}
    </Modal>
  );
}
