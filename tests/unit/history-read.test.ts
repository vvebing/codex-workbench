import { describe, expect, it, vi } from "vitest";
import { readHistory } from "../../src/features/sessions/history";
import { placeholderThread } from "../../src/lib/state";
import type { CodexClient } from "../../src/lib/rpc";
import type { Turn } from "../../src/generated/v2/Turn";

const turn: Turn = {
  id: "turn",
  rootTurnId: null,
  items: [],
  itemsView: "summary",
  status: "completed",
  error: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
};
describe("metadata-first history reads", () => {
  it.each([undefined, placeholderThread("thread")])(
    "never hydrates a paginated thread in thread/read, even with stale legacy cache",
    async (cached) => {
      const metadata = {
        ...placeholderThread("thread"),
        historyMode: "paginated" as const,
      };
      const item = {
        type: "agentMessage",
        id: "answer",
        text: "Complete",
        phase: null,
      };
      const request = vi
        .fn()
        .mockResolvedValueOnce({ thread: metadata })
        .mockResolvedValueOnce({ data: [turn], nextCursor: "page-2" })
        .mockResolvedValueOnce({ data: [], nextCursor: null })
        .mockResolvedValueOnce({
          data: [
            { item, turnId: turn.id, startedAtMs: null, completedAtMs: null },
          ],
          nextCursor: null,
        });
      const result = await readHistory(
        { request } as unknown as CodexClient,
        "thread",
        cached,
        () => true,
      );
      expect(request.mock.calls.map(([method]) => method)).toEqual([
        "thread/read",
        "thread/turns/list",
        "thread/turns/list",
        "thread/items/list",
      ]);
      expect(request).toHaveBeenNthCalledWith(1, "thread/read", {
        threadId: "thread",
        includeTurns: false,
      });
      expect(request.mock.calls[2][1]).toMatchObject({ cursor: "page-2" });
      expect(result.turns[0].items).toEqual([item]);
    },
  );
  it("uses full hydration only after confirming legacy metadata", async () => {
    const metadata = placeholderThread("thread");
    const request = vi
      .fn()
      .mockResolvedValueOnce({ thread: metadata })
      .mockResolvedValueOnce({ thread: { ...metadata, turns: [turn] } });
    const result = await readHistory(
      { request } as unknown as CodexClient,
      "thread",
      undefined,
      () => true,
    );
    expect(request.mock.calls).toEqual([
      ["thread/read", { threadId: "thread", includeTurns: false }],
      ["thread/read", { threadId: "thread", includeTurns: true }],
    ]);
    expect(result.turns).toEqual([turn]);
  });
  it("does not continue paging or legacy hydration after an environment change", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ thread: placeholderThread("thread") });
    await expect(
      readHistory(
        { request } as unknown as CodexClient,
        "thread",
        undefined,
        () => false,
      ),
    ).rejects.toThrow("连接已改变");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
