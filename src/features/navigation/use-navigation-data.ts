import { useMemo, useSyncExternalStore } from "react";
import type { Environment } from "../connection/environments";
import type { Thread } from "../../generated/v2/Thread";
import type { SessionsState } from "../sessions/state";
import { environmentTasks } from "../task-center/model";
import { pendingAsyncQuestions } from "../conversation/async-questions";
import { sameSidebarSessions } from "./sidebar-state";
import {
  navigationEnvironmentKey,
  type NavigationEnvironment,
} from "./navigation-model";

const taskSignatures = new WeakMap<Thread, string>();
function threadTaskSignature(thread: Thread): string {
  let signature = taskSignatures.get(thread);
  if (signature !== undefined) return signature;
  const last = thread.turns.at(-1);
  signature = JSON.stringify([
    thread.status.type === "systemError",
    last?.status,
    last?.status === "failed" ? last.error?.message : null,
    pendingAsyncQuestions(thread).map((question) => [
      question.id,
      question.questions,
    ]),
  ]);
  taskSignatures.set(thread, signature);
  return signature;
}

/** Body tokens do not change navigation, but questions and task transitions do. */
export function sameNavigationSessions(
  a: SessionsState,
  b: SessionsState,
): boolean {
  if (a === b) return true;
  if (!sameSidebarSessions(a, b)) return false;
  if (a.threads === b.threads) return true;
  const ids = Object.keys(a.threads);
  return (
    ids.length === Object.keys(b.threads).length &&
    ids.every((id) => {
      const previous = a.threads[id],
        next = b.threads[id];
      return (
        !!next &&
        (previous === next ||
          threadTaskSignature(previous) === threadTaskSignature(next))
      );
    })
  );
}

/** Shared snapshot factory keeps subscription behavior independently testable. */
export function createNavigationDataSource(environments: Environment[]) {
  const read = (environment: Environment) => ({
    sessions: environment.runtime.sessions.getSnapshot(),
    connection: environment.runtime.connection.getSnapshot(),
    requests: environment.runtime.requests.getSnapshot(),
    queue: environment.runtime.queue.getSnapshot(),
    dismissals: environment.runtime.questionDismissals.getSnapshot(),
    messages: environment.runtime.submissions.messages.getSnapshot(),
  });
  const previous: ReturnType<typeof read>[] = [];
  let result: NavigationEnvironment[] = [];
  const snapshot = () => {
    let changed = false;
    const nextResult = environments.map((environment, index) => {
      const current = read(environment),
        last = previous[index];
      previous[index] = current;
      if (
        last &&
        sameNavigationSessions(last.sessions, current.sessions) &&
        last.connection === current.connection &&
        last.requests === current.requests &&
        last.queue === current.queue &&
        last.dismissals === current.dismissals &&
        last.messages === current.messages
      )
        return result[index];
      changed = true;
      return {
        environment,
        environmentKey: navigationEnvironmentKey(environment),
        sessions: current.sessions,
        messages: current.messages,
        connected: current.connection.status === "connected",
        tasks: environmentTasks(environment.runtime),
      };
    });
    if (changed) result = nextResult;
    return result;
  };
  const subscribe = (listener: () => void) => {
    const subscriptions = environments.flatMap(({ runtime }) =>
      [
        runtime.sessions,
        runtime.connection,
        runtime.requests,
        runtime.queue,
        runtime.questionDismissals,
        runtime.submissions.messages,
      ].map((store) => store.subscribe(listener)),
    );
    return () => subscriptions.forEach((stop) => stop());
  };
  return { snapshot, subscribe };
}

/** Subscribe to task transitions without repainting for every model token. */
export function useNavigationData(environments: Environment[]) {
  const source = useMemo(
    () => createNavigationDataSource(environments),
    [environments],
  );
  return useSyncExternalStore(source.subscribe, source.snapshot);
}
