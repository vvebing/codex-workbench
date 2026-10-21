import { afterEach, expect, it, vi } from "vitest";
import { createRuntime } from "../../src/lib/runtime";
import { placeholderThread } from "../../src/lib/state";
import { QueueStorage } from "../../src/features/composer/queue-storage";

const item = {
  type: "agentMessage" as const,
  id: "question",
  text: "Choose",
  phase: "commentary" as const,
  memoryCitation: null,
  delivery: null,
  questions: [{ title: "Preference", options: ["A", "B"] }],
};
afterEach(() => vi.restoreAllMocks());
function setup() {
  const runtime = createRuntime();
  const state = {
    ...runtime.sessions.getSnapshot(),
    threads: {
      a: {
        ...placeholderThread("a"),
        turns: [
          {
            id: "turn",
            rootTurnId: null,
            items: [item],
            itemsView: "full" as const,
            status: "completed" as const,
            error: null,
            startedAt: 1,
            completedAt: 2,
            durationMs: 1,
          },
        ],
      },
    },
  };
  vi.spyOn(runtime.sessions, "getSnapshot").mockImplementation(() => state);
  const write = vi.spyOn(QueueStorage.prototype, "write");
  return { runtime, state, write };
}
it("rejects a stale question form submission after the thread has been archived", async () => {
  const { runtime, state, write } = setup();
  state.archivedIds = { a: true };
  await expect(runtime.queue.addAnswer("a", item, ["B"])).rejects.toThrow(
    "已归档",
  );
  expect(runtime.queue.forThread("a").items).toEqual([]);
  expect(write).not.toHaveBeenCalled();
});
it("does not persist an answer when archiving occurs while the outbox storage lock is pending", async () => {
  const { runtime, state, write } = setup();
  let finishRead!: () => void;
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.spyOn(QueueStorage.prototype, "read").mockImplementationOnce(async () => {
    started();
    await new Promise<void>((resolve) => {
      finishRead = resolve;
    });
    return {};
  });
  const submission = runtime.queue.addAnswer("a", item, ["B"]);
  await reading;
  state.archivedIds = { a: true };
  finishRead();
  await expect(submission).rejects.toThrow("已归档");
  expect(runtime.queue.forThread("a").items).toEqual([]);
  expect(write).not.toHaveBeenCalled();
});
