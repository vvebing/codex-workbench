import { describe, expect, it } from "vitest";
import { initialState } from "../../src/features/sessions/state";
import { placeholderThread } from "../../src/lib/state";
import {
  selectComposerSession,
  sameComposerSession,
} from "../../src/features/composer/session-selection";
import type { Turn } from "../../src/generated/v2/Turn";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";

function fixture() {
  const state = initialState();
  state.threads.a = {
    ...placeholderThread("a"),
    turns: [
      {
        id: "turn",
        status: "inProgress",
        items: [
          {
            type: "agentMessage",
            id: "message",
            text: "first",
            questions: null,
          },
        ],
      } as unknown as Turn,
    ],
  };
  return state;
}
describe("composer subscription", () => {
  it("ignores answer tokens and unrelated threads without hiding controls", () => {
    const state = fixture();
    const before = selectComposerSession(state, "a");
    const thread = state.threads.a;
    const streamed = {
      ...state,
      threads: {
        ...state.threads,
        a: {
          ...thread,
          turns: [
            {
              ...thread.turns[0],
              items: [
                {
                  ...thread.turns[0].items[0],
                  text: "first plus token",
                } as ThreadItem,
              ],
            },
          ],
        },
        b: placeholderThread("b"),
      },
    };
    expect(
      sameComposerSession(before, selectComposerSession(streamed, "a")),
    ).toBe(true);
    for (const next of [
      { ...state, historySyncError: "refresh failed" },
      { ...state, draftPersistenceWarning: "local storage unavailable" },
      { ...state, threadAccess: { a: "editable" as const } },
      { ...state, threads: { a: { ...thread, model: "new-model" } } },
      { ...state, threads: { a: { ...thread, cwd: "/other" } } },
      {
        ...state,
        threads: {
          a: { ...thread, turns: [{ ...thread.turns[0], id: "new-turn" }] },
        },
      },
      {
        ...state,
        threads: {
          a: {
            ...thread,
            turns: [{ ...thread.turns[0], status: "completed" as const }],
          },
        },
      },
      { ...state, tokenUsage: { a: {} as never } },
      { ...state, threadSettings: { a: {} as never } },
    ])
      expect(
        sameComposerSession(before, selectComposerSession(next, "a")),
      ).toBe(false);
  });
  it("observes replies that resolve a pending question without waiting for status changes", () => {
    const state = fixture();
    const thread = state.threads.a;
    const before = selectComposerSession(state, "a");
    const next = {
      ...state,
      threads: {
        a: {
          ...thread,
          turns: [
            {
              ...thread.turns[0],
              items: [
                ...thread.turns[0].items,
                {
                  type: "userMessage",
                  id: "reply",
                  clientId: null,
                  content: [
                    {
                      type: "text",
                      text: "回答问题：\n问题编号：message\n\n问题\n答案",
                      text_elements: [],
                    },
                  ],
                } as ThreadItem,
              ],
            },
          ],
        },
      },
    };
    expect(sameComposerSession(before, selectComposerSession(next, "a"))).toBe(
      false,
    );
  });
  it("observes question, subagent and local draft promotion changes", () => {
    const state = fixture();
    const before = selectComposerSession(state, "a");
    const thread = state.threads.a;
    for (const item of [
      {
        type: "agentMessage",
        id: "message",
        text: "question",
        questions: [{ id: "question" }],
      },
      {
        type: "subAgentActivity",
        id: "activity",
        agentThreadId: "child",
        kind: "started",
      },
    ] as unknown as ThreadItem[]) {
      const next = {
        ...state,
        threads: {
          a: { ...thread, turns: [{ ...thread.turns[0], items: [item] }] },
        },
      };
      expect(
        sameComposerSession(before, selectComposerSession(next, "a")),
      ).toBe(false);
    }
    const promoted = {
      ...state,
      draftOrigins: { server: "a" },
      threads: { server: placeholderThread("server") },
    };
    expect(
      sameComposerSession(before, selectComposerSession(promoted, "a")),
    ).toBe(false);
    expect(selectComposerSession(promoted, "a").values[0]).toBe("server");
  });
});
