import { afterEach, describe, expect, it, vi } from "vitest";
import { relativeTime } from "../../src/components/hooks";
import {
  groupThreadsByRecency,
  updatedTimeAttributes,
} from "../../src/features/navigation/model";

afterEach(() => vi.useRealTimers());

describe("sidebar time and order", () => {
  it("orders projects by their latest thread and threads by update time", () => {
    const threads = [
      { id: "old", cwd: "/a", updatedAt: 10 },
      { id: "other", cwd: "/b", updatedAt: 20 },
      { id: "new", cwd: "/a", updatedAt: 30 },
    ];
    const groups = groupThreadsByRecency(threads);
    expect([...groups.keys()]).toEqual(["/a", "/b"]);
    expect(groups.get("/a")?.map((thread) => thread.id)).toEqual([
      "new",
      "old",
    ]);
    expect(threads.map((thread) => thread.id)).toEqual(["old", "other", "new"]);
  });

  it("uses thread ids to keep equal timestamps in a deterministic order", () => {
    const threads = [
      { id: "z", cwd: "/b", updatedAt: 20 },
      { id: "a", cwd: "/a", updatedAt: 20 },
      { id: "b", cwd: "/a", updatedAt: 20 },
    ];
    expect([...groupThreadsByRecency(threads)]).toEqual([
      ["/a", [threads[1], threads[2]]],
      ["/b", [threads[0]]],
    ]);
    expect([...groupThreadsByRecency([...threads].reverse())]).toEqual([
      ...groupThreadsByRecency(threads),
    ]);
  });

  it("formats server seconds as an ISO datetime and local absolute tooltip", () => {
    const date = new Date(2026, 9, 14, 9, 5, 7);
    expect(updatedTimeAttributes(date.getTime() / 1000)).toEqual({
      dateTime: date.toISOString(),
      title: "最近更新：2026/10/14 09:05:07",
    });
  });

  it("updates relative labels with the clock and clamps future timestamps", () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-14T01:00:00Z").getTime();
    vi.setSystemTime(now);
    const timestamp = now / 1000;
    expect(relativeTime(timestamp)).toBe("刚刚");
    vi.advanceTimersByTime(60_000);
    expect(relativeTime(timestamp)).toBe("1 分钟");
    expect(relativeTime(timestamp, now + 3_600_000)).toBe("1 小时");
    expect(relativeTime(timestamp, now + 86_400_000)).toBe("1 天");
    expect(relativeTime(timestamp + 120, now)).toBe("刚刚");
  });
});
