import { useCallback, useSyncExternalStore } from "react";
import { useRuntime } from "../../lib/runtime-context";
import { useStore } from "../../components/hooks";
import { getAgentObserver } from "./agent-observer";
export function useAgentObservation(id: string, enabled = true) {
  const { connection } = useRuntime();
  useStore(connection);
  const observer = getAgentObserver(connection, id);
  const subscribe = useCallback(
    (listener: () => void) =>
      enabled ? observer.subscribe(listener) : () => {},
    [observer, enabled],
  );
  const state = useSyncExternalStore(subscribe, observer.getSnapshot);
  return { ...state, refresh: observer.refresh };
}
