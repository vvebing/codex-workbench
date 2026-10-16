import type { ConnectionStore } from "../connection/store";
import type { FsWatchParams } from "../../generated/v2/FsWatchParams";
import type { FsWatchResponse } from "../../generated/v2/FsWatchResponse";
import type { FsUnwatchParams } from "../../generated/v2/FsUnwatchParams";
import type { FsUnwatchResponse } from "../../generated/v2/FsUnwatchResponse";

/** Optional invalidation source. Callers retain polling for unsupported servers. */
export function watchWorkspace(
  connection: Pick<ConnectionStore, "client" | "getSnapshot">,
  path: string,
  onChanged: () => void,
  watchId: string = crypto.randomUUID(),
  debounceMs = 250,
): () => void {
  const { epoch, scope } = connection.getSnapshot();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sameConnection = () => {
    const current = connection.getSnapshot();
    return current.epoch === epoch && current.status === "connected";
  };
  const current = () =>
    !stopped && sameConnection() && connection.getSnapshot().scope === scope;
  const unwatch = () => {
    // Watch identifiers belong to the old socket; never send them on a new one.
    if (!sameConnection()) return;
    const params: FsUnwatchParams = { watchId };
    void connection.client
      .request<FsUnwatchResponse>("fs/unwatch", params)
      .catch(() => {});
  };
  const unsubscribe = connection.client.onNotification((event) => {
    if (
      !current() ||
      event.method !== "fs/changed" ||
      event.params.watchId !== watchId
    )
      return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (current()) onChanged();
    }, debounceMs);
  });
  const params: FsWatchParams = { watchId, path };
  if (sameConnection()) {
    void connection.client
      .request<FsWatchResponse>("fs/watch", params)
      .then(() => {
        // Cleanup may have raced asynchronous registration. Unwatch again after it finishes.
        if (!current()) unwatch();
      })
      .catch(() => {
        // A timeout has an uncertain outcome; release any watch that was accepted.
        unwatch();
      });
  }
  return () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    unsubscribe();
    unwatch();
    // Pending registrations are also released by their completion handler above.
  };
}
