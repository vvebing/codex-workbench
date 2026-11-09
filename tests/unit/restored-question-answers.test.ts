import { expect, it } from "vitest";
import { LocalMessagesStore } from "../../src/features/composer/local-messages";
import { emptyDraft } from "../../src/features/composer/drafts";
import { asyncAnswerClientId } from "../../src/features/conversation/async-questions";
import type { QueuedTask, TaskQueue } from "../../src/features/composer/queue";
import type { SessionsStore } from "../../src/features/sessions/store";
import { Store } from "../../src/lib/store";
import { placeholderThread } from "../../src/lib/state";
import type { Thread } from "../../src/generated/v2/Thread";
import type { Turn } from "../../src/generated/v2/Turn";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";

const input = [
  {
    type: "text" as const,
    text: "回答问题：\n请粘贴报错\n旧的报错输出",
    text_elements: [],
  },
];
const task: QueuedTask = {
  id: "delivery",
  draft: { ...emptyDraft(), text: input[0].text },
  input,
  options: {},
  status: "sending",
  question: { itemId: "question", answers: ["旧的报错输出"] },
};
const queue: TaskQueue = {
  items: [],
  paused: null,
  sentAnswers: { question: ["旧的报错输出"] },
  sentAnswerTasks: { question: task },
};
const clientId = asyncAnswerClientId("question", "delivery");
const message = (id: string): ThreadItem => ({
  type: "agentMessage",
  id,
  text: id,
  phase: null,
  memoryCitation: null,
  delivery: null,
  questions: null,
});
const echo = (id: string, clientId: string | null = null): ThreadItem => ({
  type: "userMessage",
  id,
  clientId,
  content: input,
});
const turn = (
  id: string,
  items: ThreadItem[],
  status: Turn["status"] = "completed",
): Turn => ({
  id,
  rootTurnId: null,
  items,
  itemsView: "full",
  status,
  error: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
});
class Sessions extends Store<{
  threads: Record<string, Thread>;
  localDrafts: Record<string, never>;
}> {
  resolveId(id: string) {
    return id;
  }
  load(turns: Turn[]) {
    this.update({
      localDrafts: {},
      threads: { thread: { ...placeholderThread("thread"), turns } },
    });
  }
}
function setup(turns: Turn[]) {
  const sessions = new Sessions({ threads: {}, localDrafts: {} });
  sessions.load(turns);
  const messages = new LocalMessagesStore(sessions as unknown as SessionsStore);
  return {
    sessions,
    messages,
    presented: () =>
      messages.presentationTurns(sessions.getSnapshot().threads.thread),
  };
}

it("restores an accepted answer after its original question before subsequent work, never in the current turn", () => {
  const f = setup([
    turn("old", [message("question"), message("old-work")]),
    turn("current", [message("new-work")], "inProgress"),
  ]);
  f.messages.syncQuestionQueue({ thread: queue });
  expect(f.messages.getSnapshot()[0]).toMatchObject({
    turnId: "old",
    startsTurn: false,
    status: "accepted",
  });
  expect(f.presented().map((t) => t.items.map((i) => i.id))).toEqual([
    ["question", clientId, "old-work"],
    ["new-work"],
  ]);
});

it("keeps an unanchored answer durable but hidden until paginated history loads its original question", () => {
  const current = turn("current", [message("new-work")], "inProgress");
  const f = setup([current]);
  f.messages.syncQuestionQueue({ thread: queue });
  expect(f.messages.getSnapshot()).toHaveLength(1);
  expect(f.presented()).toEqual([current]);
  f.sessions.load([
    turn("old", [message("question"), message("old-work")]),
    current,
  ]);
  expect(f.presented().map((t) => t.items.map((i) => i.id))).toEqual([
    ["question", clientId, "old-work"],
    ["new-work"],
  ]);
  // A later partial snapshot must not move that answer to the active turn.
  f.sessions.load([current]);
  expect(f.presented()).toEqual([current]);
  expect(f.messages.getSnapshot()).toHaveLength(1);
});

it("deduplicates restored legacy echoes already present in the initial history snapshot", () => {
  const f = setup([
    turn("old", [
      message("question"),
      echo("historical-echo"),
      message("work"),
    ]),
    turn("current", [], "inProgress"),
  ]);
  f.messages.syncQuestionQueue({ thread: queue });
  expect(f.messages.getSnapshot()).toHaveLength(0);
  expect(f.messages.identity("historical-echo")).toBe(clientId);
  f.messages.syncQuestionQueue({ thread: queue });
  expect(f.messages.getSnapshot()).toHaveLength(0);
  expect(
    f.presented()[0].items.filter((i) => i.type === "userMessage"),
  ).toHaveLength(1);
});

it("does not mistake an identical message before the question for its answer", () => {
  const f = setup([
    turn("old", [
      echo("older-identical"),
      message("question"),
      message("work"),
    ]),
  ]);
  f.messages.syncQuestionQueue({ thread: queue });
  expect(f.messages.getSnapshot()).toHaveLength(1);
  expect(f.presented()[0].items.map((i) => i.id)).toEqual([
    "older-identical",
    "question",
    clientId,
    "work",
  ]);
});

it("matches an identified echo without requiring the original question to be loaded and preserves its association", () => {
  const serverEcho = echo("server-echo", clientId);
  const f = setup([turn("answer-turn", [serverEcho])]);
  f.messages.syncQuestionQueue({ thread: queue });
  expect(f.messages.getSnapshot()).toHaveLength(0);
  expect(f.messages.presentationItem(serverEcho)).toBe(serverEcho);
});

it("replaces a restored answer when its identified echo arrives in a later turn", () => {
  const original = turn("old", [message("question"), message("work")]);
  const f = setup([original]);
  f.messages.syncQuestionQueue({ thread: queue });
  f.sessions.load([
    original,
    turn("answer-turn", [echo("server-echo", clientId)]),
  ]);
  expect(f.messages.getSnapshot()).toHaveLength(0);
  expect(
    f
      .presented()
      .flatMap((t) => t.items)
      .filter((i) => i.type === "userMessage"),
  ).toHaveLength(1);
});

it("keeps a newly submitted answer at its delivery position when it becomes accepted", () => {
  const f = setup([
    turn("old", [message("question")]),
    turn("current", [message("new-work")], "inProgress"),
  ]);
  f.messages.syncQuestionQueue({
    thread: { items: [{ ...task, status: "queued" }], paused: null },
  });
  expect(f.messages.getSnapshot()[0]).toMatchObject({
    turnId: "current",
    startsTurn: false,
    restoredAnswer: false,
  });
  f.messages.syncQuestionQueue({ thread: queue });
  expect(f.presented().map((t) => t.items.map((i) => i.id))).toEqual([
    ["question"],
    ["new-work", clientId],
  ]);
});
