import { emptyDraft } from "../../src/features/composer/drafts";
import { expect, it } from "vitest";
import { LocalMessagesStore } from "../../src/features/composer/local-messages";
import { Store } from "../../src/lib/store";
import type { SessionsStore } from "../../src/features/sessions/store";
import type { Thread } from "../../src/generated/v2/Thread";

it("retains both the parent turn and message identity after a server echo without a client ID", () => {
  class Sessions extends Store<{
    threads: Record<string, Thread>;
    localDrafts: Record<string, never>;
  }> {
    resolveId(id: string) {
      return id;
    }
    echo(content: unknown) {
      this.update({
        localDrafts: {},
        threads: {
          thread: {
            id: "thread",
            turns: [
              {
                id: "server-turn",
                items: [{ id: "server-message", type: "userMessage", content }],
              },
            ],
          } as Thread,
        },
      });
    }
  }
  const sessions = new Sessions({ threads: {}, localDrafts: {} });
  const messages = new LocalMessagesStore(sessions as unknown as SessionsStore);
  const input = [{ type: "text" as const, text: "hello", text_elements: [] }];
  const clientId = messages.add("thread", input);
  sessions.echo(input);
  expect(messages.getSnapshot()).toHaveLength(0);
  expect(messages.identity("server-turn")).toBe(clientId);
  expect(messages.identity("server-message")).toBe(clientId);
  messages.clear();
  expect(messages.identity("server-turn")).toBe("server-turn");
});

it("keeps a steering message inside the existing turn without changing its parent identity", () => {
  class Sessions extends Store<{
    threads: Record<string, Thread>;
    localDrafts: Record<string, never>;
  }> {
    resolveId(id: string) {
      return id;
    }
    echo(clientId: string) {
      const thread = this.state.threads.thread;
      this.update({
        ...this.state,
        threads: {
          thread: {
            ...thread,
            turns: [
              {
                ...thread.turns[0],
                items: [
                  ...thread.turns[0].items,
                  {
                    id: "steer-echo",
                    type: "userMessage",
                    clientId,
                    content: [],
                  },
                ],
              },
            ],
          },
        },
      });
    }
  }
  const sessions = new Sessions({
    localDrafts: {},
    threads: {
      thread: {
        id: "thread",
        turns: [{ id: "active", status: "inProgress", items: [] }],
      } as unknown as Thread,
    },
  });
  const messages = new LocalMessagesStore(sessions as unknown as SessionsStore);
  const id = messages.add("thread", [
    { type: "text", text: "steer", text_elements: [] },
  ]);
  expect(messages.getSnapshot()[0].turnId).toBe("active");
  sessions.echo(id);
  expect(messages.identity("active")).toBe("active");
  expect(messages.identity("steer-echo")).toBe(id);
});

it("keeps draft scope identity before server binding and after promotion", () => {
  class Sessions extends Store<{
    threads: Record<string, Thread>;
    localDrafts: Record<string, { serverId?: string }>;
    draftOrigins: Record<string, string>;
  }> {
    resolveId(id: string) {
      return id;
    }
    bind() {
      this.update({
        ...this.state,
        localDrafts: { draft: { serverId: "server" } },
      });
    }
    promote() {
      this.update({
        ...this.state,
        localDrafts: {},
        draftOrigins: { server: "draft" },
      });
    }
  }
  const sessions = new Sessions({
    threads: {},
    localDrafts: { draft: {} },
    draftOrigins: {},
  });
  const messages = new LocalMessagesStore(sessions as unknown as SessionsStore);
  expect(messages.threadIdentity("draft")).toBe("draft");
  sessions.bind();
  expect(messages.threadIdentity("server")).toBe("draft");
  sessions.promote();
  expect(messages.threadIdentity("server")).toBe("draft");
});

it("joins an empty started turn before execution arrives and keeps the prompt first through a late echo", () => {
  class Sessions extends Store<{
    threads: Record<string, Thread>;
    localDrafts: Record<string, never>;
  }> {
    resolveId(id: string) {
      return id;
    }
    publish(items: Thread["turns"][number]["items"]) {
      this.update({
        localDrafts: {},
        threads: {
          thread: {
            id: "thread",
            turns: [{ id: "server-turn", status: "inProgress", items }],
          } as Thread,
        },
      });
    }
  }
  const sessions = new Sessions({ threads: {}, localDrafts: {} });
  const messages = new LocalMessagesStore(sessions as unknown as SessionsStore);
  const input = [{ type: "text" as const, text: "first", text_elements: [] }];
  const clientId = messages.add("thread", input);
  sessions.publish([]);
  expect(messages.identity("server-turn")).toBe(clientId);
  expect(messages.getSnapshot()[0].turnId).toBe("server-turn");
  expect(
    messages
      .presentationTurns(sessions.getSnapshot().threads.thread)
      .map((turn) => turn.items.map((item) => item.id)),
  ).toEqual([[clientId]]);
  const progress = {
    type: "reasoning" as const,
    id: "progress",
    summary: ["running"],
    content: [],
  };
  sessions.publish([progress]);
  expect(
    messages
      .presentationTurns(sessions.getSnapshot().threads.thread)[0]
      .items.map((item) => item.id),
  ).toEqual([clientId, "progress"]);
  sessions.publish([
    progress,
    { type: "userMessage", id: "echo", clientId, content: input },
  ]);
  expect(messages.getSnapshot()).toHaveLength(0);
  expect(
    messages
      .presentationTurns(sessions.getSnapshot().threads.thread)[0]
      .items.map((item) => item.id),
  ).toEqual(["echo", "progress"]);
  expect(messages.identity("server-turn")).toBe(clientId);
  expect(messages.identity("echo")).toBe(clientId);
});

it("projects saved answers once and hands off their identity to the server echo", () => {
  class Sessions extends Store<{
    threads: Record<string, Thread>;
    localDrafts: Record<string, never>;
  }> {
    resolveId(id: string) {
      return id;
    }
    echo(clientId: string, content: unknown) {
      this.update({
        localDrafts: {},
        threads: {
          thread: {
            id: "thread",
            turns: [
              {
                id: "server-turn",
                status: "completed",
                items: [
                  {
                    id: "server-answer",
                    type: "userMessage",
                    clientId,
                    content,
                  },
                ],
              },
            ],
          } as Thread,
        },
      });
    }
  }
  const sessions = new Sessions({ threads: {}, localDrafts: {} });
  const messages = new LocalMessagesStore(sessions as unknown as SessionsStore);
  const task = {
    id: "delivery",
    draft: { ...emptyDraft(), text: "回答问题：\n布局\n侧栏" },
    input: [
      { type: "text", text: "回答问题：\n布局\n侧栏", text_elements: [] },
    ],
    options: {},
    status: "queued",
    question: { itemId: "question", answers: ["侧栏"] },
  } as import("../../src/features/composer/queue").QueuedTask;
  const queue = {
    items: [task],
    paused: null,
  } as import("../../src/features/composer/queue").TaskQueue;
  messages.syncQuestionQueue({ thread: queue });
  messages.syncQuestionQueue({ thread: queue });
  expect(messages.getSnapshot()).toHaveLength(1);
  const local = messages.getSnapshot()[0];
  expect(local.id).toBe("codex-question:question:delivery");
  expect(local.status).toBe("queued");
  sessions.echo(local.id, task.input);
  messages.syncQuestionQueue({ thread: queue });
  expect(messages.getSnapshot()).toHaveLength(0);
  expect(messages.identity("server-answer")).toBe(local.id);
  expect(messages.identity("server-turn")).toBe(local.id);
});

it("restores accepted answers awaiting their echo and removes explicitly cancelled answers", () => {
  class Sessions extends Store<{
    threads: Record<string, Thread>;
    localDrafts: Record<string, never>;
  }> {
    resolveId(id: string) {
      return id;
    }
  }
  const sessions = new Sessions({ threads: {}, localDrafts: {} });
  const messages = new LocalMessagesStore(sessions as unknown as SessionsStore);
  const task = {
    id: "delivery",
    draft: emptyDraft(),
    options: {},
    input: [{ type: "text", text: "回答问题", text_elements: [] }],
    status: "sending",
    question: { itemId: "question", answers: ["侧栏"] },
  } as import("../../src/features/composer/queue").QueuedTask;
  messages.syncQuestionQueue({
    thread: {
      items: [],
      paused: null,
      sentAnswers: { question: ["侧栏"] },
      sentAnswerTasks: { question: task },
    },
  });
  expect(messages.getSnapshot()).toHaveLength(1);
  expect(messages.getSnapshot()[0].status).toBe("accepted");
  messages.syncQuestionQueue({ thread: { items: [], paused: null } });
  expect(messages.getSnapshot()).toHaveLength(0);
});
