import { describe, expect, it } from "vitest";
import { createSnapshotSelector } from "../../src/components/hooks";
import { initialState } from "../../src/features/sessions/state";
import { placeholderThread } from "../../src/lib/state";
import { sameSidebarSessions } from "../../src/features/navigation/sidebar-state";
import { sameEnvironmentSessions } from "../../src/features/connection/environment-summary";
import type { Turn } from "../../src/generated/v2/Turn";

function fixture() {
  const state = initialState();
  state.threads.a = {
    ...placeholderThread("a"),
    turns: [{ id: "turn", status: "inProgress", items: [] } as unknown as Turn],
  };
  state.listIds = ["a"];
  return state;
}
describe("navigation subscriptions", () => {
  it("retains equal selections and observes later changes after skipped snapshots", () => {
    let state = { title: "a", tokens: 0 };
    const getSelection = createSnapshotSelector(
      () => state,
      (value) => ({ title: value.title }),
      (a, b) => a.title === b.title,
    );
    const first = getSelection();
    expect(getSelection()).toBe(first);
    state = { ...state, tokens: 1 };
    expect(getSelection()).toBe(first);
    state = { ...state, title: "b" };
    expect(getSelection()).toEqual({ title: "b" });
    expect(getSelection()).not.toBe(first);
  });
  it("ignores streamed bodies while preserving row and global state transitions", () => {
    const state = fixture();
    const streamed = {
      ...state,
      threads: {
        ...state.threads,
        a: {
          ...state.threads.a,
          turns: [
            {
              ...state.threads.a.turns[0],
              items: [
                {
                  type: "agentMessage",
                  id: "answer",
                  text: "new token",
                  phase: null,
                },
              ] as Turn["items"],
            },
          ],
        },
      },
    };
    expect(sameSidebarSessions(state, streamed)).toBe(true);
    expect(sameEnvironmentSessions(state, streamed)).toBe(true);
    for (const next of [
      { ...streamed, selectedId: "a" },
      { ...streamed, unreadCompleted: { a: "turn" } },
      { ...streamed, localDrafts: { ...streamed.localDrafts } },
      { ...streamed, subagentThreadIds: { a: true as const } },
      {
        ...streamed,
        threads: { a: { ...streamed.threads.a, name: "renamed" } },
      },
      {
        ...streamed,
        threads: {
          a: {
            ...streamed.threads.a,
            turns: [
              { ...streamed.threads.a.turns[0], status: "failed" as const },
            ],
          },
        },
      },
    ]) {
      expect(sameSidebarSessions(state, next)).toBe(false);
      expect(sameEnvironmentSessions(state, next)).toBe(false);
    }
  });
  it("publishes background thread status and metadata even outside the visible section", () => {
    const state = fixture();
    state.sectionFilter = "hidden";
    const changed = {
      ...state,
      threads: {
        a: { ...state.threads.a, status: { type: "systemError" as const } },
      },
    };
    expect(sameEnvironmentSessions(state, changed)).toBe(false);
    expect(
      sameEnvironmentSessions(state, {
        ...state,
        completionNotifications: [{ id: "notice", threadId: "a" }],
      }),
    ).toBe(false);
    expect(
      sameEnvironmentSessions(state, {
        ...state,
        threadAccess: { a: "editable" },
      }),
    ).toBe(false);
    expect(
      sameEnvironmentSessions(state, {
        ...state,
        tokenUsage: { ...state.tokenUsage },
      }),
    ).toBe(true);
  });
  it("publishes a task title resolved from loaded history without a metadata change", () => {
    const state = fixture();
    state.threads.a.preview = "回答问题：\n版本？\nv1.49.8";
    const resolved = {
      ...state,
      threads: {
        a: {
          ...state.threads.a,
          titleSource: { turnId: "turn", text: "排查 Session 请求与接口 401" },
        },
      },
    };
    expect(sameSidebarSessions(state, resolved)).toBe(false);
    expect(sameEnvironmentSessions(state, resolved)).toBe(false);
  });
});
