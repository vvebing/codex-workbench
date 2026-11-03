import { describe, expect, it } from "vitest";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";
import {
  operationDurationMs,
  operationElapsedMs,
} from "../../src/features/conversation/operation-timing";

const item: ThreadItem = { type: "imageView", id: "image", path: "/image.png" };
describe("operation timing", () => {
  it("calculates elapsed time from millisecond timestamps, including zero", () => {
    expect(
      operationDurationMs({ ...item, startedAtMs: 0, completedAtMs: 1250 }),
    ).toBe(1250);
    expect(
      operationDurationMs({ ...item, startedAtMs: 100, completedAtMs: 100 }),
    ).toBe(0);
  });
  it("prefers a recorded duration for tools that already provide it", () => {
    const command: ThreadItem = {
      type: "dynamicToolCall",
      id: "tool",
      namespace: null,
      tool: "test",
      arguments: {},
      status: "completed",
      contentItems: null,
      success: true,
      durationMs: 500,
      startedAtMs: 0,
      completedAtMs: 1000,
    };
    expect(operationDurationMs(command)).toBe(500);
  });
  it("does not invent durations for old or invalid lifecycle records", () => {
    for (const timing of [
      {},
      { startedAtMs: 1000 },
      { startedAtMs: null, completedAtMs: null },
      { startedAtMs: 10, completedAtMs: 5 },
      { startedAtMs: -1, completedAtMs: 50 },
      { startedAtMs: 0, completedAtMs: Number.NaN },
    ])
      expect(operationDurationMs({ ...item, ...timing })).toBeNull();
  });
  it("only ticks genuinely active steps and never extends a finished step", () => {
    const running = { ...item, startedAtMs: 1000, completedAtMs: null };
    expect(operationElapsedMs(running, "inProgress", 2500)).toBe(1500);
    expect(operationElapsedMs(running, "waiting", 2500)).toBe(1500);
    expect(operationElapsedMs(running, "completed", 2500)).toBeNull();
    expect(operationElapsedMs(running, "interrupted", 2500)).toBeNull();
    expect(operationElapsedMs(running, "inProgress", 500)).toBeNull();
    expect(
      operationElapsedMs(
        { ...running, completedAtMs: 2000 },
        "completed",
        5000,
      ),
    ).toBe(1000);
  });
});
