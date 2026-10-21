import { expect, it, vi } from "vitest";
import {
  questionDraftKey,
  readQuestionDraft,
  writeQuestionDraft,
} from "../../src/features/conversation/question-drafts";
it("persists ordinary answers across reloads and excludes secrets in both fields", () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  try {
    const key = questionDraftKey("server", "thread", "item");
    writeQuestionDraft(
      key,
      {
        values: { public: "__custom__", secret: "password" },
        custom: { public: "long\nanswer", secret: "password" },
      },
      ["secret"],
    );
    expect(readQuestionDraft(key)).toEqual({
      values: { public: "__custom__" },
      custom: { public: "long\nanswer" },
    });
    expect(
      readQuestionDraft(questionDraftKey("other", "thread", "item")),
    ).toEqual({ values: {}, custom: {} });
    expect([...storage.values()].join()).not.toContain("password");
  } finally {
    vi.unstubAllGlobals();
  }
});
