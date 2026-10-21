import { expect, it, vi } from "vitest";
import { HistoryLoadingScheduler } from "../../src/features/navigation/history-loading";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let turn = 0; turn < 12; turn++) await Promise.resolve();
}
function occupy(scheduler: HistoryLoadingScheduler) {
  const first = deferred();
  const second = deferred();
  scheduler.enqueue("first:1:all", () => first.promise);
  scheduler.enqueue("second:1:all", () => second.promise);
  return { first, second };
}

it("limits simultaneous summary traversals to two and starts queued environments as slots free", async () => {
  const scheduler = new HistoryLoadingScheduler();
  const gates = Array.from({ length: 5 }, deferred);
  const started: number[] = [];
  let active = 0;
  let peak = 0;
  gates.forEach((gate, index) =>
    scheduler.enqueue(`environment-${index}:1:all`, async () => {
      started.push(index);
      peak = Math.max(peak, ++active);
      await gate.promise;
      active--;
    }),
  );
  await flush();
  expect(started).toEqual([0, 1]);
  gates[1].resolve();
  await flush();
  expect(started).toEqual([0, 1, 2]);
  gates[0].resolve();
  await flush();
  expect(started).toEqual([0, 1, 2, 3]);
  gates[2].resolve();
  await flush();
  expect(started).toEqual([0, 1, 2, 3, 4]);
  gates[3].resolve();
  gates[4].resolve();
  await flush();
  expect(active).toBe(0);
  expect(peak).toBe(2);
});

it("shares a queued key between owners, so canceling one does not cancel the other's work", async () => {
  const scheduler = new HistoryLoadingScheduler();
  const occupied = occupy(scheduler);
  const shared = deferred();
  const task = vi.fn(() => shared.promise);
  const duplicate = vi.fn(async () => {});
  const cancelFirst = scheduler.enqueue("shared:1:all", task);
  scheduler.enqueue("shared:1:all", duplicate);
  cancelFirst();
  occupied.first.resolve();
  await flush();
  expect(task).toHaveBeenCalledOnce();
  expect(duplicate).not.toHaveBeenCalled();
  shared.resolve();
  occupied.second.resolve();
  await flush();
});

it("removes unstarted work when all owners leave and allows a fresh job with the same key", async () => {
  const scheduler = new HistoryLoadingScheduler();
  const occupied = occupy(scheduler);
  const stale = vi.fn(async () => {});
  const current = vi.fn(async () => {});
  const cancelFirst = scheduler.enqueue("environment:1:all", stale);
  const cancelSecond = scheduler.enqueue("environment:1:all", stale);
  cancelFirst();
  cancelSecond();
  scheduler.enqueue("environment:1:all", current);
  // An old cleanup may run again after the replacement was registered.
  cancelFirst();
  cancelSecond();
  occupied.first.resolve();
  await flush();
  expect(stale).not.toHaveBeenCalled();
  expect(current).toHaveBeenCalledOnce();
  occupied.second.resolve();
  await flush();
});

it("keeps canceled running work counted and shares it with a returning owner", async () => {
  const scheduler = new HistoryLoadingScheduler();
  const first = deferred();
  const second = deferred();
  const firstTask = vi.fn(() => first.promise);
  const returningTask = vi.fn(async () => {});
  const queued = vi.fn(async () => {});
  const cancel = scheduler.enqueue("environment:1:all", firstTask);
  scheduler.enqueue("other:1:all", () => second.promise);
  await flush();
  cancel();
  scheduler.enqueue("environment:1:all", returningTask);
  scheduler.enqueue("third:1:all", queued);
  await flush();
  expect(firstTask).toHaveBeenCalledOnce();
  expect(returningTask).not.toHaveBeenCalled();
  expect(queued).not.toHaveBeenCalled();
  first.resolve();
  await flush();
  expect(queued).toHaveBeenCalledOnce();
  second.resolve();
  await flush();
});

it("releases rejected work without an unhandled rejection and permits explicit retry", async () => {
  const scheduler = new HistoryLoadingScheduler();
  const failed = deferred();
  const occupied = deferred();
  const next = vi.fn(async () => {});
  scheduler.enqueue("environment:1:all", () => failed.promise);
  scheduler.enqueue("other:1:all", () => occupied.promise);
  scheduler.enqueue("next:1:all", next);
  await flush();
  failed.reject(new Error("offline"));
  await flush();
  expect(next).toHaveBeenCalledOnce();
  const retry = vi.fn(async () => {});
  scheduler.enqueue("environment:1:all", retry);
  await flush();
  expect(retry).toHaveBeenCalledOnce();
  occupied.resolve();
  await flush();
});

it("handles synchronous task errors and treats each connection/filter key independently", async () => {
  const scheduler = new HistoryLoadingScheduler();
  const started: string[] = [];
  scheduler.enqueue("environment:1:all", () => {
    throw new Error("failed before request");
  });
  for (const key of ["environment:2:all", "environment:2:section"])
    scheduler.enqueue(key, async () => {
      started.push(key);
    });
  await flush();
  expect(started).toEqual(["environment:2:all", "environment:2:section"]);
});
