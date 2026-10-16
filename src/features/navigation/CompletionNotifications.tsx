import { pendingAsyncQuestions } from "../conversation/async-questions";
import { requestThreadId } from "../requests/store";
import { isSubagentThread, shouldNotifyThread } from "../sessions/state";
import type { RpcRequest } from "../../lib/rpc";
import { useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, CircleHelp, X } from "lucide-react";
import { RuntimeContext, useRuntime } from "../../lib/runtime-context";
import { environments, type Environment } from "../connection/environments";
import { EnvironmentIcon } from "../connection/EnvironmentIcon";
import { titleOf, useStore } from "../../components/hooks";
import { IconButton } from "../../components/ui";
import { productIconUrl } from "../../components/ProductIcon";
function CompletionNotice({
  id,
  threadId,
  environment,
}: {
  id: string;
  threadId: string;
  environment: Environment;
}) {
  const runtime = useRuntime();
  const sessions = useStore(runtime.sessions);
  const title = titleOf(sessions.threads[threadId]);
  useEffect(() => {
    const timer = setTimeout(
      () => runtime.sessions.dismissCompletion(id),
      8000,
    );
    return () => clearTimeout(timer);
  }, [id, runtime]);
  return (
    <div
      data-slot="completion-notification"
      className="flex items-center gap-2 rounded-xl border border-border bg-elevated p-3 shadow-lg"
      role="status"
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        type="button"
        onClick={() => {
          environments.select(environment.id);
          void runtime.sessions.open(threadId).catch(() => {});
        }}
      >
        <CircleCheck size={20} className="text-success" />
        <span>
          <strong className="flex items-center gap-1.5 text-xs">
            <EnvironmentIcon environment={environment} focusable={false} />
            会话已完成
          </strong>
          <small className="mt-1 block max-w-[225px] truncate text-xs text-muted">
            {title}
          </small>
        </span>
      </button>
      <IconButton
        label="关闭完成通知"
        onClick={() => runtime.sessions.dismissCompletion(id)}
      >
        <X size={14} />
      </IconButton>
    </div>
  );
}
function EnvironmentNotifications({
  environment,
}: {
  environment: Environment;
}) {
  const runtime = useRuntime();
  const sessions = useStore(runtime.sessions);
  const requests = useStore(runtime.requests);
  const actionRequests = useMemo(
    () => [
      ...requests.pending.flatMap((request) => {
        const threadId = requestThreadId(request);
        return threadId
          ? [
              {
                key: JSON.stringify(request.id),
                threadId,
                title: requestNoticeTitle(request),
              },
            ]
          : [];
      }),
      ...Object.values(sessions.threads).flatMap((thread) =>
        pendingAsyncQuestions(thread).map((item) => ({
          key: JSON.stringify(["async-question", thread.id, item.id]),
          threadId: thread.id,
          title: "需要你回答问题",
        })),
      ),
    ],
    [requests.pending, sessions.threads],
  );
  const [dismissedRequests, setDismissedRequests] = useState<Set<string>>(
    new Set(),
  );
  const actionSent = useRef(new Set<string>());
  const actionNative = useRef(
    new Map<string, { threadId: string; notification: Notification }>(),
  );
  const notices = sessions.completionNotifications.filter((notice) =>
    shouldNotifyThread(sessions, notice.threadId),
  );
  const sent = useRef(new Set<string>());
  const native = useRef(
    new Map<string, { threadId: string; notification: Notification }>(),
  );
  const { scope, status } = useStore(runtime.connection);
  const metadataKey = JSON.stringify(
    [
      ...new Set([
        ...sessions.completionNotifications.map((notice) => notice.threadId),
        ...actionRequests.map((request) => request.threadId),
      ]),
    ]
      .filter(
        (id) =>
          !sessions.subagentThreadIds[id] &&
          !isSubagentThread(sessions.threads[id]) &&
          (!sessions.threads[id] || sessions.notificationMetadataPending[id]),
      )
      .sort(),
  );
  useEffect(() => {
    const ids = JSON.parse(metadataKey) as string[];
    if (status !== "connected" || !ids.length) return;
    const refresh = () => {
      for (const id of ids)
        void runtime.sessions.ensureNotificationMetadata(id);
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [runtime, metadataKey, status]);
  useEffect(() => {
    sent.current.clear();
    actionSent.current.clear();
    setDismissedRequests(new Set());
    for (const entry of actionNative.current.values())
      entry.notification.close();
    actionNative.current.clear();
    for (const entry of native.current.values()) entry.notification.close();
    native.current.clear();
  }, [scope]);
  useEffect(() => {
    for (const [id, entry] of native.current) {
      if (
        !shouldNotifyThread(sessions, entry.threadId) ||
        (!sessions.unreadCompleted[entry.threadId] &&
          !sessions.completionNotifications.some((notice) => notice.id === id))
      ) {
        entry.notification.close();
        native.current.delete(id);
      }
    }
    for (const notice of sessions.completionNotifications) {
      if (!shouldNotifyThread(sessions, notice.threadId)) continue;
      if (sent.current.has(notice.id)) continue;
      sent.current.add(notice.id);
      if (
        typeof Notification === "undefined" ||
        Notification.permission !== "granted"
      )
        continue;
      try {
        const notification = new Notification("会话已完成", {
          icon: productIconUrl,
          body: titleOf(sessions.threads[notice.threadId]),
          tag: `${environment.id}:${notice.threadId}`,
        });
        notification.onclick = () => {
          window.focus();
          environments.select(environment.id);
          void runtime.sessions.open(notice.threadId).catch(() => {});
          notification.close();
        };
        native.current.set(notice.id, {
          threadId: notice.threadId,
          notification,
        });
      } catch {
        /* In-app notices remain available when system notifications fail. */
      }
    }
  }, [sessions, runtime, environment.id]);
  useEffect(() => {
    const pendingKeys = new Set(actionRequests.map((request) => request.key));
    for (const [key, entry] of actionNative.current) {
      if (
        !pendingKeys.has(key) ||
        !shouldNotifyThread(sessions, entry.threadId)
      ) {
        entry.notification.close();
        actionNative.current.delete(key);
      }
    }
    for (const request of actionRequests) {
      const { threadId, key } = request;
      if (
        !threadId ||
        !shouldNotifyThread(sessions, threadId) ||
        actionSent.current.has(key)
      )
        continue;
      actionSent.current.add(key);
      if (
        typeof Notification === "undefined" ||
        Notification.permission !== "granted"
      )
        continue;
      try {
        const notification = new Notification(request.title, {
          icon: productIconUrl,
          body: titleOf(sessions.threads[threadId]),
          tag: `${environment.id}:request:${key}`,
        });
        notification.onclick = () => {
          window.focus();
          environments.select(environment.id);
          void runtime.sessions.open(threadId).catch(() => {});
          notification.close();
        };
        actionNative.current.set(key, { threadId, notification });
      } catch {
        /* The in-app request notice remains available. */
      }
    }
  }, [actionRequests, sessions, runtime, environment.id]);
  useEffect(() => {
    const actions = actionNative.current;
    return () => {
      for (const entry of actions.values()) entry.notification.close();
    };
  }, []);
  useEffect(() => {
    const notifications = native.current;
    return () => {
      for (const entry of notifications.values()) entry.notification.close();
    };
  }, []);
  return (
    <>
      {actionRequests
        .filter(
          (request) =>
            shouldNotifyThread(sessions, request.threadId) &&
            !dismissedRequests.has(request.key),
        )
        .map((request) => (
          <ActionNotice
            key={request.key}
            threadId={request.threadId}
            title={request.title}
            environment={environment}
            onDismiss={() => {
              const key = request.key;
              actionNative.current.get(key)?.notification.close();
              actionNative.current.delete(key);
              setDismissedRequests((value) => new Set([...value, key]));
            }}
          />
        ))}
      {notices.slice(-3).map((notice) => (
        <CompletionNotice
          key={notice.id}
          {...notice}
          environment={environment}
        />
      ))}
    </>
  );
}

export function CompletionNotifications() {
  const state = useStore(environments);
  return (
    <div className="fixed top-[68px] right-4 z-70 grid max-h-[calc(100dvh-84px)] w-[min(320px,calc(100vw-32px))] gap-2 overflow-y-auto">
      {state.entries.map((environment) => (
        <RuntimeContext.Provider
          key={environment.id}
          value={environment.runtime}
        >
          <EnvironmentNotifications environment={environment} />
        </RuntimeContext.Provider>
      ))}
    </div>
  );
}

function requestNoticeTitle(request: RpcRequest): string {
  return request.method === "item/tool/requestUserInput"
    ? "需要你回答问题"
    : request.method === "item/fileChange/requestApproval"
      ? "文件修改待审批"
      : "命令执行待审批";
}

function ActionNotice({
  threadId,
  title,
  environment,
  onDismiss,
}: {
  threadId: string;
  title: string;
  environment: Environment;
  onDismiss: () => void;
}) {
  const runtime = useRuntime();
  const sessions = useStore(runtime.sessions);
  return (
    <div
      data-slot="action-notification"
      role="status"
      className="flex items-center gap-2 rounded-xl border border-warning/40 bg-elevated p-3 shadow-lg"
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        onClick={() => {
          environments.select(environment.id);
          void runtime.sessions.open(threadId).catch(() => {});
        }}
      >
        <CircleHelp size={20} className="shrink-0 text-warning" />
        <span className="min-w-0">
          <strong className="flex items-center gap-1.5 text-xs">
            <EnvironmentIcon environment={environment} focusable={false} />
            {title}
          </strong>
          <small className="mt-1 block max-w-[225px] truncate text-xs text-muted">
            {titleOf(sessions.threads[threadId])}
          </small>
          <small className="mt-1 block text-[11px] text-muted">
            点击前往处理
          </small>
        </span>
      </button>
      <IconButton label="关闭待处理通知" onClick={onDismiss}>
        <X size={14} />
      </IconButton>
    </div>
  );
}
