import { describe, expect, it, vi } from "vitest";
import {
  readHistory,
  type HydratedThread,
} from "../../src/features/sessions/history";
import {
  emptyState,
  mergeThread,
  operationKey,
  placeholderThread,
} from "../../src/lib/state";
import type { CodexClient } from "../../src/lib/rpc";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";
import type { Turn } from "../../src/generated/v2/Turn";

const reasoning = (id: string): ThreadItem => ({
  type: "reasoning",
  id,
  summary: [],
  content: [],
});
const image: ThreadItem = {
  type: "imageView",
  id: "image",
  path: "/tmp/image.png",
};
const turn = (
  status: Turn["status"] = "inProgress",
  itemsView: Turn["itemsView"] = "full",
): Turn => ({
  id: "turn",
  rootTurnId: null,
  items: [reasoning("finished"), image, reasoning("live")],
  itemsView,
  status,
  error: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
});
const metadata = () => ({
  ...placeholderThread("thread"),
  historyMode: "paginated" as const,
  status: { type: "active" as const, activeFlags: [] },
});
describe("authoritative item lifecycle hydration", () => {
  it("reads item timing for active full turns and independently marks completed thought/image", async () => {
    const current = turn();
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: [current], nextCursor: null })
      .mockResolvedValueOnce({
        data: current.items.map((item, index) => ({
          turnId: "turn",
          item,
          startedAtMs: 10 + index,
          completedAtMs: index < 2 ? 20 + index : null,
        })),
        nextCursor: null,
      });
    const hydrated = await readHistory(
      { request } as unknown as CodexClient,
      "thread",
      undefined,
      () => true,
      false,
      metadata(),
    );
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      "thread/turns/list",
      "thread/items/list",
    ]);
    const state = mergeThread(emptyState(), hydrated);
    expect(state.threads.thread.turns[0].status).toBe("inProgress");
    for (const id of ["finished", "image"])
      expect(state.completedItems[operationKey("thread", "turn", id)]).toBe(
        true,
      );
    expect(state.startedItems[operationKey("thread", "turn", "live")]).toBe(
      true,
    );
    expect(
      state.completedItems[operationKey("thread", "turn", "live")],
    ).toBeUndefined();
  });
  it("hydrates partial summaries without reordering full snapshots and avoids finished full reads", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: [turn("completed")], nextCursor: null });
    await readHistory(
      { request } as unknown as CodexClient,
      "thread",
      undefined,
      () => true,
      false,
      metadata(),
    );
    expect(request).toHaveBeenCalledTimes(1);
    request
      .mockReset()
      .mockResolvedValueOnce({
        data: [turn("completed", "summary")],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        data: [
          { turnId: "turn", item: image, startedAtMs: 0, completedAtMs: 0 },
        ],
        nextCursor: null,
      });
    const partial = await readHistory(
      { request } as unknown as CodexClient,
      "thread",
      undefined,
      () => true,
      false,
      metadata(),
    );
    expect(partial.turns[0].items).toEqual([image]);
    expect(
      mergeThread(emptyState(), partial).completedItems[
        operationKey("thread", "turn", "image")
      ],
    ).toBe(true);
  });
  it("null and missing history times do not revoke live terminal markers", () => {
    const key = operationKey("thread", "turn", "finished");
    const state = { ...emptyState(), completedItems: { [key]: true } };
    const hydrated: HydratedThread = {
      ...metadata(),
      turns: [turn()],
      itemLifecycles: { [key]: { startedAtMs: null, completedAtMs: null } },
    };
    const merged = mergeThread(state, hydrated);
    expect(merged.completedItems[key]).toBe(true);
    expect(merged.startedItems[key]).toBeUndefined();
    expect(
      merged.startedItems[operationKey("thread", "turn", "live")],
    ).toBeUndefined();
  });
});
