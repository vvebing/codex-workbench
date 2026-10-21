import type { createRuntime } from "./runtime";

type Runtime = ReturnType<typeof createRuntime>;

export function hasTransientData(runtimes: Runtime[]): boolean {
  return runtimes.some(
    (runtime) =>
      runtime.drafts.hasContent() ||
      runtime.files?.hasDirty() ||
      runtime.submissions.messages
        .getSnapshot()
        .some((message) => message.status !== "accepted") ||
      Object.values(runtime.submissions.getSnapshot()).some(Boolean) ||
      Object.values(runtime.queue.getSnapshot().threads).some(
        (queue) => queue.items.length > 0,
      ),
  );
}

/** Register only while needed; an empty page should leave without a prompt. */
export function protectPageExit(
  getRuntimes: () => Runtime[],
  subscribeEnvironments: (listener: () => void) => () => void,
  target: Pick<Window, "addEventListener" | "removeEventListener"> = window,
): () => void {
  let attached = false;
  let unsubscribeStores: (() => void)[] = [];
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!hasTransientData(getRuntimes())) return;
    event.preventDefault();
    event.returnValue = "";
  };
  const update = () => {
    const needed = hasTransientData(getRuntimes());
    if (needed === attached) return;
    attached = needed;
    if (needed) target.addEventListener("beforeunload", beforeUnload);
    else target.removeEventListener("beforeunload", beforeUnload);
  };
  let previous: Runtime[] = [];
  const observe = () => {
    const runtimes = getRuntimes();
    if (
      runtimes.length === previous.length &&
      runtimes.every((runtime, index) => runtime === previous[index])
    ) {
      update();
      return;
    }
    unsubscribeStores.forEach((unsubscribe) => unsubscribe());
    previous = runtimes;
    unsubscribeStores = runtimes.flatMap((runtime) =>
      [
        runtime.drafts,
        runtime.submissions,
        runtime.submissions.messages,
        runtime.queue,
        runtime.files,
      ]
        .filter(Boolean)
        .map((store) => store.subscribe(update)),
    );
    update();
  };
  const unsubscribeEnvironments = subscribeEnvironments(observe);
  observe();
  return () => {
    unsubscribeEnvironments();
    unsubscribeStores.forEach((unsubscribe) => unsubscribe());
    if (attached) target.removeEventListener("beforeunload", beforeUnload);
  };
}
