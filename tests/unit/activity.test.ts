import { expect, it } from "vitest";
import {
  conversationExecuting,
  turnStatusLabel,
  turnTiming,
  formatCompletionTime,
  formatWorkDuration,
} from "../../src/features/conversation/activity";
import { placeholderThread } from "../../src/lib/state";
import type { Turn } from "../../src/generated/v2/Turn";

const partial: Turn = {
  id: "turn",
  rootTurnId: null,
  items: [],
  itemsView: "full",
  status: "interrupted",
  error: null,
  startedAt: 100,
  completedAt: null,
  durationMs: null,
};
const thread = { ...placeholderThread("external"), turns: [partial] };

it("shows externally active work consistently despite incomplete interrupted history", () => {
  const active = {
    ...thread,
    status: { type: "active" as const, activeFlags: [] },
  };
  expect(conversationExecuting(active)).toBe(true);
  expect(turnStatusLabel(active, partial)).toBe("正在执行…");
  expect(turnStatusLabel(active, partial, true)).toBe("已中断");
  const stopped = { ...partial, completedAt: 200 };
  expect(turnStatusLabel({ ...active, turns: [stopped] }, stopped)).toBe(
    "已中断",
  );
});

it("does not invent an interruption or running process from an unloaded partial snapshot", () => {
  const unloaded = { ...thread, status: { type: "notLoaded" as const } };
  expect(turnStatusLabel(unloaded, partial)).toBe("执行状态待确认");
  expect(conversationExecuting(unloaded)).toBe(false);
  const active = { ...partial, status: "inProgress" as const };
  expect(conversationExecuting({ ...unloaded, turns: [active] })).toBe(true);
  const done = { ...partial, id: "done", status: "completed" as const };
  expect(conversationExecuting({ ...unloaded, turns: [active, done] })).toBe(
    false,
  );
});

it("keeps actual interruption labels when the runtime is idle or an error confirms it", () => {
  expect(turnStatusLabel(thread, partial)).toBe("已中断");
  const stopped = {
    ...partial,
    error: {
      message: "cancelled",
      codexErrorInfo: null,
      additionalDetails: null,
      misalignment: null,
    },
  };
  expect(
    turnStatusLabel(
      { ...thread, status: { type: "notLoaded" }, turns: [stopped] },
      stopped,
    ),
  ).toBe("已中断");
});

it("formats elapsed work and uses the authoritative completion duration", () => {
  expect(turnTiming(partial, true, 113000)).toBe("已用时 13 秒");
  expect(
    turnTiming(
      { ...partial, durationMs: 548000, completedAt: 700 },
      false,
      999000,
    ),
  ).toBe("耗时 9 分 8 秒");
  expect(turnTiming({ ...partial, completedAt: 160 }, false, 999000)).toBe(
    "耗时 1 分 0 秒",
  );
  expect(turnTiming({ ...partial, startedAt: null }, true, 113000)).toBeNull();
  expect(formatWorkDuration(-1000)).toBe("0 秒");
  expect(formatWorkDuration(3661000)).toBe("1 小时 1 分 1 秒");
});

it("formats completion timestamps by local day and year, including midnight and year boundaries", () => {
  const now = new Date(2026, 9, 14, 12, 0).getTime();
  expect(formatCompletionTime(new Date(2026, 9, 14, 9, 5), now)).toBe("09:05");
  expect(formatCompletionTime(new Date(2026, 9, 14, 0, 0), now)).toBe("00:00");
  expect(formatCompletionTime(new Date(2026, 9, 13, 9, 5), now)).toBe(
    "10-13 09:05",
  );
  expect(formatCompletionTime(new Date(2025, 11, 31, 23, 59), now)).toBe(
    "2025-12-31 23:59",
  );
  expect(formatCompletionTime(new Date(2024, 0, 2, 3, 4), now)).toBe(
    "2024-01-02 03:04",
  );
  const completed = new Date(2026, 11, 31, 23, 59);
  expect(
    formatCompletionTime(completed, new Date(2026, 11, 31, 23, 59).getTime()),
  ).toBe("23:59");
  expect(
    formatCompletionTime(completed, new Date(2027, 0, 1, 0, 0).getTime()),
  ).toBe("2026-12-31 23:59");
});
