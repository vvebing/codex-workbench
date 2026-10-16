import { expect, it } from "vitest";
import {
  conversationCapabilities,
  conversationExecuting,
  draftCommand,
} from "../../src/features/composer/capabilities";
import { emptyDraft } from "../../src/features/composer/drafts";
import { placeholderThread } from "../../src/lib/state";
import type { Turn } from "../../src/generated/v2/Turn";

const thread = {
  ...placeholderThread("thread"),
  status: { type: "idle" as const },
};
const running = {
  ...thread,
  status: { type: "active" as const, activeFlags: [] },
  turns: [{ id: "turn", status: "inProgress" } as Turn],
};
const draft = { ...emptyDraft(), text: "继续说明" };
const ready = { thread, draft, connected: true, waiting: false };

it("keeps local and viewed drafts editable and allows the send to acquire access", () => {
  for (const access of ["viewing", "editable"] as const) {
    const state = conversationCapabilities({ ...ready, access });
    expect(state.editable).toBe(true);
    expect(state.canSend).toBe(true);
    expect(state.showStop).toBe(false);
  }
});

it("freezes an occupied draft but lets its existing content retry acquisition", () => {
  const state = conversationCapabilities({ ...ready, access: "occupied" });
  expect(state.editable).toBe(false);
  expect(state.canSend).toBe(true);
  expect(state.canCommand).toBe(false);
  expect(state.canStop).toBe(false);
});

it("blocks submitting during activation while allowing edits to survive it", () => {
  const state = conversationCapabilities({ ...ready, access: "activating" });
  expect(state.editable).toBe(true);
  expect(state.canSend).toBe(false);
  expect(state.canCommand).toBe(false);
});

it("shows stop while waiting for approval even when a supplemental draft exists", () => {
  const state = conversationCapabilities({
    ...ready,
    thread: running,
    access: "editable",
    waiting: true,
  });
  expect(state.showStop).toBe(true);
  expect(state.canStop).toBe(true);
  expect(state.canSend).toBe(false);
  expect(state.canCommand).toBe(false);
  expect(state.editable).toBe(true);
});

it("offers supplemental input for running turns and stop for empty drafts", () => {
  const state = { ...ready, thread: running, access: "editable" as const };
  expect(conversationCapabilities(state).canSend).toBe(true);
  expect(conversationCapabilities(state).showStop).toBe(false);
  const empty = conversationCapabilities({ ...state, draft: emptyDraft() });
  expect(empty.showStop).toBe(true);
  expect(empty.canStop).toBe(true);
  expect(empty.canSend).toBe(false);
});

it.each([{ connected: false }, { sending: true }, { stopping: true }])(
  "blocks simultaneous session actions while retaining draft editing: %j",
  (busy) => {
    const state = conversationCapabilities({
      ...ready,
      thread: running,
      access: "editable",
      ...busy,
    });
    expect(state.canSend).toBe(false);
    expect(state.canCommand).toBe(false);
    expect(state.canStop).toBe(false);
    expect(state.editable).toBe(true);
  },
);

it("attachment reading blocks submission without disabling interrupt", () => {
  const state = conversationCapabilities({
    ...ready,
    thread: running,
    access: "editable",
    reading: true,
  });
  expect(state.canSend).toBe(false);
  expect(state.canStop).toBe(true);
});

it("requires content but accepts an image without text", () => {
  expect(
    conversationCapabilities({ ...ready, draft: emptyDraft() }).canSend,
  ).toBe(false);
  expect(
    conversationCapabilities({
      ...ready,
      draft: {
        text: "  ",
        images: [{ id: "image", name: "图", url: "data:image/png;base64,abc" }],
      },
    }).canSend,
  ).toBe(true);
});

it("derives execution from the latest turn without requiring writer ownership", () => {
  const historical = { ...thread, turns: running.turns };
  expect(conversationExecuting(historical)).toBe(true);
  expect(
    conversationExecuting({ ...historical, status: { type: "notLoaded" } }),
  ).toBe(true);
  expect(conversationExecuting(running)).toBe(true);
});

it("recognizes only standalone slash commands and preserves selected file references", () => {
  expect(draftCommand({ ...draft, text: "/compact " })).toBe("compact");
  expect(draftCommand({ ...draft, text: "/help with this" })).toBeUndefined();
  expect(draftCommand({ ...draft, text: "/home/file.ts" })).toBeUndefined();
  expect(
    draftCommand({
      ...draft,
      text: "/src",
      document: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "reference" }] }],
      },
    }),
  ).toBeUndefined();
});

it.each(["viewing", "activating", "occupied"] as const)(
  "shows disabled stop while a running thread is %s",
  (access) => {
    const state = conversationCapabilities({
      ...ready,
      thread: running,
      draft: emptyDraft(),
      access,
    });
    expect(state.showStop).toBe(true);
    expect(state.canStop).toBe(false);
  },
);
