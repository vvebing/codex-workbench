import { expect, test, vi } from "vitest";
import {
  matchesNavigationStatus,
  navigationProjects,
  navigationThreads,
  navigationActivityAt,
  threadStatus,
  type NavigationEnvironment,
} from "../../src/features/navigation/navigation-model";
import { navigationEnvironmentKey } from "../../src/features/navigation/navigation-state";
import {
  createNavigationDataSource,
  sameNavigationSessions,
} from "../../src/features/navigation/use-navigation-data";
import {
  initialState,
  type SessionsState,
} from "../../src/features/sessions/state";
import type { Environment } from "../../src/features/connection/environments";
import type { Thread } from "../../src/generated/v2/Thread";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";
import type { Turn } from "../../src/generated/v2/Turn";
import { placeholderThread } from "../../src/lib/state";
import { Store } from "../../src/lib/store";

const turn = (items: ThreadItem[] = [], changes: Partial<Turn> = {}): Turn =>
  ({ id: "turn", status: "completed", items, ...changes }) as Turn;
const message = (
  text: string,
  questions: { title: string; options: string[] }[] | null = null,
): ThreadItem =>
  ({ type: "agentMessage", id: "question", text, questions }) as ThreadItem;
function stateWith(...threads: Thread[]): SessionsState {
  return {
    ...initialState(),
    listIds: threads.map((thread) => thread.id),
    threads: Object.fromEntries(threads.map((thread) => [thread.id, thread])),
  };
}
function source(sessions: SessionsState, id = "local"): NavigationEnvironment {
  const environment = { id, name: id, url: `ws://${id}:4501` } as Environment;
  return {
    environment,
    environmentKey: navigationEnvironmentKey(environment),
    sessions,
    tasks: [],
    connected: true,
  };
}
class MutableStore<T> extends Store<T> {
  set(value: T) {
    this.update(value);
  }
}
function runtimeFixture(sessions: SessionsState) {
  const stores = {
    sessions: new MutableStore(sessions),
    connection: new MutableStore({ status: "connected", epoch: 1 }),
    requests: new MutableStore({ pending: [], submittedAnswers: [] }),
    queue: new MutableStore({ threads: {} }),
    questionDismissals: new MutableStore<Record<string, true>>({}),
    messages: new MutableStore([]),
  };
  const environment = {
    id: "local",
    name: "本机",
    url: "ws://127.0.0.1:4501",
    runtime: { ...stores, submissions: { messages: stores.messages } },
  } as unknown as Environment;
  return { stores, environment };
}

test("canonical project IDs group distinct worktrees while same directory names and environments remain separate", () => {
  const threads = [
    { ...placeholderThread("a"), cwd: "/a/work", projectId: "canonical" },
    { ...placeholderThread("b"), cwd: "/b/work", projectId: "canonical" },
    { ...placeholderThread("c"), cwd: "/a/work", projectId: null },
    { ...placeholderThread("d"), cwd: "/b/work", projectId: null },
  ];
  const local = source(stateWith(...threads));
  const projects = navigationProjects(navigationThreads([local], {}));
  expect(projects).toHaveLength(3);
  expect(
    projects
      .find((project) => project.id === "project:canonical")
      ?.threads.map((item) => item.thread.id),
  ).toEqual(["a", "b"]);
  const reversed = navigationProjects(
    navigationThreads([source(stateWith(...threads.toReversed()))], {}),
  );
  expect(
    reversed.map((project) => [project.key, project.name, project.cwd]),
  ).toEqual(
    projects.map((project) => [project.key, project.name, project.cwd]),
  );
  expect(
    navigationProjects(
      navigationThreads([local, source(stateWith(...threads), "remote")], {}),
    ),
  ).toHaveLength(6);
});

test("projects follow the latest session update across worktrees and use names only for equal times", () => {
  const older = {
    ...placeholderThread("old"),
    cwd: "/work/alpha",
    updatedAt: 10,
  };
  const latest = {
    ...placeholderThread("latest"),
    cwd: "/work/zeta",
    projectId: "shared",
    updatedAt: 30,
  };
  const worktree = {
    ...placeholderThread("worktree"),
    cwd: "/work/another-tree",
    projectId: "shared",
    updatedAt: 20,
  };
  const peer = {
    ...placeholderThread("peer"),
    cwd: "/work/beta",
    updatedAt: 10,
  };
  const local = source(stateWith(older, latest, worktree, peer));
  const projectList = () => navigationProjects(navigationThreads([local], {}));
  expect(projectList().map((project) => project.latestActivityAt)).toEqual([
    30, 10, 10,
  ]);
  expect(projectList().map((project) => project.name)).toEqual([
    "another-tree",
    "alpha",
    "beta",
  ]);
  local.sessions = stateWith(
    { ...older, updatedAt: 40 },
    latest,
    worktree,
    peer,
  );
  expect(projectList()[0].name).toBe("alpha");
  // Discovery order and local visits do not replace actual conversation activity.
  const visits = { [JSON.stringify([local.environmentKey, "peer"])]: 100000 };
  expect(navigationProjects(navigationThreads([local], visits))[0].name).toBe(
    "alpha",
  );
});

test("navigation uses current creation, update, and recency metadata for activity", () => {
  const thread = {
    ...placeholderThread("activity"),
    createdAt: 10,
    updatedAt: 20,
    recencyAt: 15,
  };
  expect(navigationActivityAt(thread)).toBe(20);
  expect(navigationActivityAt({ ...thread, recencyAt: 30 })).toBe(30);
  expect(
    navigationActivityAt({ ...thread, updatedAt: 0, recencyAt: null }),
  ).toBe(10);
});

test("navigation publishes recency-only changes without requiring a reload or another metadata event", () => {
  const original = {
    ...placeholderThread("activity"),
    createdAt: 1,
    updatedAt: 10,
    recencyAt: 10,
  };
  const { stores, environment } = runtimeFixture(stateWith(original));
  const data = createNavigationDataSource([environment]);
  const before = data.snapshot();
  stores.sessions.set(stateWith({ ...original, recencyAt: 30 }));
  const changed = data.snapshot();
  expect(changed).not.toBe(before);
  expect(
    navigationProjects(navigationThreads(changed, {}))[0].latestActivityAt,
  ).toBe(30);
});

test("initialization follows the first message through draft promotion and stops on execution or failure", () => {
  const thread = placeholderThread("draft");
  const environment = source(stateWith(thread));
  environment.sessions.localDrafts.draft = { options: {} };
  environment.sessions.threadAccess.draft = "activating";
  environment.messages = [{ threadId: "draft", status: "creating" }];
  const item = () => navigationThreads([environment], {})[0];
  expect(item().initializing).toBe("正在创建会话");
  environment.sessions = {
    ...stateWith({ ...thread, id: "server" }),
    draftOrigins: { server: "draft" },
  };
  environment.messages = [{ threadId: "draft", status: "sending" }];
  expect(item().thread.id).toBe("server");
  expect(item().initializing).toBe("正在发送");
  environment.sessions.threadAccess.server = "activating";
  expect(item().initializing).toBe("正在初始化");
  environment.sessions.threadAccess.server = "editable";
  environment.sessions.threads.server = {
    ...environment.sessions.threads.server,
    status: { type: "active", activeFlags: [] },
  };
  expect(item().initializing).toBeNull();
  expect(item().running).toBe(true);
  environment.sessions.threads.server = {
    ...environment.sessions.threads.server,
    status: { type: "idle" },
  };
  environment.messages = [{ threadId: "draft", status: "failed" }];
  expect(item().initializing).toBeNull();
  environment.messages = [{ threadId: "draft", status: "uncertain" }];
  expect(item().initializing).toBeNull();
  environment.messages = [{ threadId: "draft", status: "sending" }];
  environment.connected = false;
  expect(item().initializing).toBeNull();
});

test("navigation publishes initialization access changes without waiting for another metadata update", () => {
  const { stores, environment } = runtimeFixture(
    stateWith(placeholderThread("initializing")),
  );
  const data = createNavigationDataSource([environment]);
  const before = data.snapshot();
  stores.sessions.set({
    ...stores.sessions.getSnapshot(),
    threadAccess: { initializing: "activating" },
  });
  const changed = data.snapshot();
  expect(changed).not.toBe(before);
  expect(navigationThreads(changed, {})[0].initializing).toBe("正在初始化");
  stores.sessions.set({
    ...stores.sessions.getSnapshot(),
    threadAccess: { initializing: "editable" },
  });
  expect(navigationThreads(data.snapshot(), {})[0].initializing).toBeNull();
});

test("status filters keep waiting, failure, execution, and unread dimensions independent", () => {
  const thread = {
    ...placeholderThread("a"),
    status: { type: "active", activeFlags: [] } as Thread["status"],
    turns: [turn([], { status: "failed" })],
  };
  const value = source({
    ...stateWith(thread),
    unreadCompleted: { a: "turn" },
  });
  value.tasks = [
    { id: "request", threadId: "a", category: "待回答", title: "请回答" },
  ];
  const item = navigationThreads([value], {})[0];
  expect(item).toMatchObject({
    waiting: "待回答",
    running: true,
    failed: true,
    unread: true,
  });
  for (const status of ["all", "attention", "running", "unread"] as const)
    expect(matchesNavigationStatus(item, status)).toBe(true);
  expect(threadStatus(item)).toBe("待回答");
  expect(
    matchesNavigationStatus(
      { ...item, source: { ...value, connected: false } },
      "running",
    ),
  ).toBe(false);
  expect(
    threadStatus({ ...item, source: { ...value, connected: false } }),
  ).toBe("状态待同步");
  value.tasks = [
    { id: "queue", threadId: "a", category: "暂停队列", title: "队列暂停" },
  ];
  expect(navigationThreads([value], {})[0].waiting).toBe("队列已暂停");
});

test("child thread identity stays excluded even if stale discovery metadata lists a child", () => {
  const sessions = stateWith(
    placeholderThread("root"),
    { ...placeholderThread("child"), parentThreadId: "root" },
    placeholderThread("known-child"),
  );
  sessions.subagentThreadIds = { "known-child": true };
  expect(
    navigationThreads([source(sessions)], {}).map((item) => item.thread.id),
  ).toEqual(["root"]);
});

test("uncertain delivery is actionable without claiming the execution failed", () => {
  const value = source(stateWith(placeholderThread("a")));
  value.tasks = [
    {
      id: "uncertain",
      threadId: "a",
      category: "失败或待核实",
      title: "消息发送结果待核实",
    },
  ];
  const item = navigationThreads([value], {})[0];
  expect(matchesNavigationStatus(item, "attention")).toBe(true);
  expect(threadStatus(item)).toBe("待核实");
});

test("navigation snapshots ignore token-only changes and publish questions, answers, dismissals, and hidden failures", () => {
  const first = {
    ...placeholderThread("a"),
    turns: [turn([message("initial")])],
  };
  const { stores, environment } = runtimeFixture(stateWith(first));
  const data = createNavigationDataSource([environment]);
  const listener = vi.fn();
  const unsubscribe = data.subscribe(listener);
  const baseline = data.snapshot();
  const update = (thread: Thread) =>
    stores.sessions.set({
      ...stores.sessions.getSnapshot(),
      threads: { [thread.id]: thread },
    });
  const streamed = { ...first, turns: [turn([message("another token")])] };
  update(streamed);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(data.snapshot()).toBe(baseline);
  const comparable = stateWith(first);
  expect(
    sameNavigationSessions(comparable, {
      ...comparable,
      threads: { a: streamed },
    }),
  ).toBe(true);

  const asked = {
    ...streamed,
    turns: [
      turn([
        message("another token", [
          { title: "采用哪种导航？", options: ["项目", "最近"] },
        ]),
      ]),
    ],
  };
  update(asked);
  const questions = data.snapshot();
  expect(questions).not.toBe(baseline);
  expect(questions[0].tasks).toMatchObject([
    { threadId: "a", category: "待回答" },
  ]);
  expect(navigationThreads(questions, {})[0].waiting).toBe("待回答");
  stores.questionDismissals.set({ '["a","question"]': true });
  expect(data.snapshot()[0].tasks).toEqual([]);
  stores.questionDismissals.set({});
  expect(data.snapshot()[0].tasks).toHaveLength(1);
  const answered = {
    ...asked,
    turns: [
      turn([
        ...asked.turns[0].items,
        {
          type: "userMessage",
          id: "answer",
          clientId: "codex-question:question:delivery",
          content: [
            {
              type: "text",
              text: "回答问题：\n采用哪种导航？\n项目",
              text_elements: [],
            },
          ],
        },
      ]),
    ],
  } as Thread;
  update(answered);
  expect(data.snapshot()[0].tasks).toEqual([]);

  stores.sessions.set({
    ...stores.sessions.getSnapshot(),
    sectionFilter: "hidden",
  });
  const hidden = data.snapshot();
  update({
    ...answered,
    turns: [
      turn([], {
        status: "failed",
        error: { message: "hidden failure" } as Turn["error"],
      }),
    ],
  });
  const failed = data.snapshot();
  expect(failed).not.toBe(hidden);
  expect(failed[0].tasks).toMatchObject([
    { category: "失败或待核实", detail: "hidden failure" },
  ]);
  const beforeUnsubscribe = listener.mock.calls.length;
  unsubscribe();
  stores.connection.set({ status: "disconnected", epoch: 2 });
  expect(data.snapshot()[0].connected).toBe(false);
  expect(listener).toHaveBeenCalledTimes(beforeUnsubscribe);
});
