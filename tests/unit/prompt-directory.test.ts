import { describe, expect, it } from "vitest";
import { promptEntries } from "../../src/features/conversation/prompt-directory";
import type { Turn } from "../../src/generated/v2/Turn";

describe("prompt directory", () => {
  it("indexes every user message, including follow-ups in the same turn, and searches full text", () => {
    const turns: Turn[] = [
      {
        id: "turn",
        rootTurnId: null,
        itemsView: "full",
        startedAt: null,
        completedAt: null,
        durationMs: null,
        status: "completed",
        error: null,
        items: [
          {
            type: "userMessage",
            id: "first",
            clientId: null,
            content: [
              { type: "text", text: "分析登录\n\n处理错误", text_elements: [] },
            ],
          },
          {
            type: "agentMessage",
            id: "answer",
            text: "内部回答",
            phase: null,
            memoryCitation: null,
            delivery: null,
            questions: null,
          },
          {
            type: "userMessage",
            id: "second",
            clientId: null,
            content: [{ type: "localImage", path: "/tmp/界面.png" }],
          },
        ],
      },
    ];
    const entries = promptEntries(turns);
    expect(entries.map(({ id, turn, label }) => ({ id, turn, label }))).toEqual(
      [
        { id: "first", turn: 1, label: "分析登录 处理错误" },
        { id: "second", turn: 1, label: "图片：界面.png" },
      ],
    );
    expect(entries[0].text).toBe("分析登录\n\n处理错误");
  });
});
