import { expect, it, vi } from "vitest";
import { DraftsStore } from "../../src/features/composer/drafts";
import { restoredMessage } from "../../src/features/composer/restore-message";
import { draftInput } from "../../src/features/composer/submission";
import { createRuntime } from "../../src/lib/runtime";
import { placeholderThread } from "../../src/lib/state";
import type { Turn } from "../../src/generated/v2/Turn";

it("restores text, skill references and images as an editable message", () => {
  const drafts = new DraftsStore();
  drafts.restoreMessage("a", [
    { type: "text", text: "请用 $review 检查\n保留换行", text_elements: [] },
    { type: "skill", name: "review", path: "/skills/review" },
    { type: "image", url: "data:image/png;base64,image" },
  ]);
  const draft = drafts.get("a");
  expect(draft.text).toBe("请用 $review 检查\n保留换行");
  expect(
    draft.document?.content?.[0].content?.some(
      (node) => node.type === "reference",
    ),
  ).toBe(true);
  expect(draftInput(draft)).toEqual([
    { type: "text", text: draft.text, text_elements: [] },
    { type: "skill", name: "review", path: "/skills/review" },
    { type: "image", url: "data:image/png;base64,image" },
  ]);
});
it("preserves edits and attachments already in the input instead of overwriting them", () => {
  const drafts = new DraftsStore();
  drafts.setText("a", "新的草稿");
  drafts.addImage("a", {
    id: "image",
    name: "draft.png",
    url: "data:image/png;base64,current",
  });
  drafts.restoreMessage("a", [
    { type: "text", text: "原消息", text_elements: [] },
  ]);
  expect(drafts.get("a").text).toBe("原消息\n\n新的草稿");
  expect(drafts.get("a").images[0].id).toBe("image");
  expect(drafts.get("a").restored?.preserved).toBe(true);
  drafts.setText("a", "修改后");
  expect(drafts.get("a").restored).toBeUndefined();
});
it("flags attachments that cannot be reopened in a browser", () => {
  expect(
    restoredMessage([
      { type: "image", fileId: "remote-file" },
      { type: "localImage", path: "/tmp/image.png" },
    ]).unavailableAttachments,
  ).toBe(true);
});
function source() {
  const turn: Turn = {
    id: "turn",
    rootTurnId: null,
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1000,
    items: [
      {
        type: "userMessage",
        id: "message",
        clientId: null,
        content: [{ type: "text", text: "原消息", text_elements: [] }],
      },
      {
        type: "userMessage",
        id: "steer",
        clientId: null,
        content: [{ type: "text", text: "补充说明", text_elements: [] }],
      },
    ],
  };
  return {
    ...placeholderThread("a"),
    historyMode: "paginated" as const,
    turns: [turn],
  };
}
it("restores the clicked message only after server acknowledgement, even if history refresh fails", async () => {
  const runtime = createRuntime();
  const original = source();
  let acknowledge!: (value: unknown) => void;
  const reply = new Promise((resolve) => {
    acknowledge = resolve;
  });
  const request = vi
    .spyOn(runtime.connection.client, "request")
    .mockResolvedValueOnce({ thread: original })
    .mockReturnValueOnce(reply as never)
    .mockRejectedValueOnce(new Error("read failed"));
  await runtime.sessions.activate("a");
  runtime.drafts.setText("a", "正在编辑");
  const reverting = runtime.revert("a", "turn", "steer");
  expect(runtime.drafts.get("a").text).toBe("正在编辑");
  runtime.drafts.setText("a", "回滚期间的新内容");
  acknowledge({ thread: { ...original, turns: [] } });
  await reverting;
  expect(runtime.drafts.get("a").text).toBe("补充说明\n\n回滚期间的新内容");
  expect(runtime.sessions.getSnapshot().threads.a.turns).toEqual([]);
  expect(runtime.sessions.getSnapshot().historySyncError).toContain(
    "回滚已完成",
  );
  expect(request).toHaveBeenCalledTimes(3);
});
it("leaves the draft and conversation intact when the server rejects revert", async () => {
  const runtime = createRuntime();
  const original = source();
  vi.spyOn(runtime.connection.client, "request")
    .mockResolvedValueOnce({ thread: original })
    .mockRejectedValueOnce(new Error("revert failed"));
  await runtime.sessions.activate("a");
  runtime.drafts.setText("a", "不要覆盖");
  await expect(runtime.revert("a", "turn", "message")).rejects.toThrow(
    "revert failed",
  );
  expect(runtime.drafts.get("a").text).toBe("不要覆盖");
  expect(runtime.sessions.getSnapshot().threads.a.turns).toEqual(
    original.turns,
  );
});
