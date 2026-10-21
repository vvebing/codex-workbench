import { expect, test } from "vitest";
import {
  combineSearchResults,
  loadedMessageText,
  matchLoadedThread,
  recentSearchSuggestions,
  sessionIdQuery,
} from "../../src/features/navigation/search-results";
import { placeholderThread } from "../../src/lib/state";
import type { Thread } from "../../src/generated/v2/Thread";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";
import type { Turn } from "../../src/generated/v2/Turn";
import {
  navigationEnvironmentKey,
  navigationVisitKey,
} from "../../src/features/navigation/navigation-state";

const id = "01a157fd-bf5b-75b3-a7e0-4777be2812b0";
function thread(changes: Partial<Thread> = {}): Thread {
  return {
    ...placeholderThread(id),
    name: "检查当前 git status",
    preview: "先查看冗余修改",
    cwd: "/work/codex-workbench",
    turns: [
      {
        id: "turn",
        items: [
          {
            type: "userMessage",
            content: [{ type: "text", text: "请重新分析实际的左侧栏方案" }],
          },
          { type: "agentMessage", text: "建议统一会话导航与环境选择。" },
          { type: "reasoning", content: ["private-only"], summary: [] },
          { type: "commandExecution", aggregatedOutput: "tool-only" },
        ] as ThreadItem[],
      } as Turn,
    ],
    ...changes,
  };
}

test("recognizes complete Session and Thread UUIDs without treating partial IDs as exact", () => {
  for (const query of [
    id,
    ` ${id.toUpperCase()} `,
    `codex session ${id}`,
    `Session ID: ${id}`,
    `thread:${id}`,
  ])
    expect(sessionIdQuery(query)).toBe(id);
  for (const query of [
    id.slice(0, 20),
    `讨论 ${id}`,
    `session: ${id} 后续`,
    "session status",
  ])
    expect(sessionIdQuery(query)).toBeNull();
  expect(matchLoadedThread(thread(), id)?.sources).toEqual(["Session ID"]);
  expect(
    matchLoadedThread(thread({ id: "other", sessionId: id }), id)?.sources,
  ).toEqual(["Session ID"]);
  expect(
    matchLoadedThread(thread({ id: "other", sessionId: "other" }), id),
  ).toBeNull();
});

test("finds later loaded conversation topics independently of a stale title and labels the source", () => {
  const value = thread();
  expect(matchLoadedThread(value, "左侧栏")?.sources).toEqual(["已加载对话"]);
  expect(matchLoadedThread(value, "左侧栏")?.excerpt).toContain(
    "请重新分析实际",
  );
  expect(matchLoadedThread(value, "左侧栏")?.thread).toBe(value);
  expect(loadedMessageText(value)).toEqual([
    "请重新分析实际的左侧栏方案",
    "建议统一会话导航与环境选择。",
  ]);
  expect(matchLoadedThread(value, "private-only")).toBeNull();
  expect(matchLoadedThread(value, "tool-only")).toBeNull();
  expect(matchLoadedThread(thread({ turns: [] }), "左侧栏")).toBeNull();
});

test("normalizes local queries and supports terms across metadata fields with accurate source labels", () => {
  const match = matchLoadedThread(thread(), "  ＧＩＴ   CODEX-WORKBENCH  ");
  expect(match?.sources).toEqual(["标题", "工作区"]);
  expect(matchLoadedThread(thread(), "冗余修改")?.sources).toEqual(["摘要"]);
  expect(matchLoadedThread(thread(), "git 不存在")).toBeNull();
  expect(matchLoadedThread(thread(), "  ")).toBeNull();
});

test("merges title-search metadata with loaded message matches without dropping local turns", () => {
  const loaded = thread();
  const remote = thread({ turns: [] });
  const matches = combineSearchResults([loaded], [remote], "左侧栏");
  expect(matches).toHaveLength(1);
  expect(matches[0].thread).toBe(loaded);
  expect(matches[0].sources).toEqual(["已加载对话", "历史标题"]);
  expect(matches[0].excerpt).toContain("左侧栏");
  const titleOnly = combineSearchResults([], [remote], "status");
  expect(titleOnly[0].sources).toEqual(["历史标题"]);
  expect(combineSearchResults([], [remote], id)[0].sources).toEqual([
    "Session ID",
  ]);
});

test("ranks the requested title before newer conversations that mention the same topic", () => {
  const exact = thread({ id: "exact", name: "左侧栏", updatedAt: 1 });
  const partial = thread({ id: "partial", name: "左侧栏方案", updatedAt: 2 });
  const body = thread({ id: "body", updatedAt: 100 });
  expect(
    combineSearchResults([body, partial, exact], [], "左侧栏").map(
      (match) => match.thread.id,
    ),
  ).toEqual(["exact", "partial", "body"]);
});

test("suggests recently visited sessions before updated sessions while isolating environment visits", () => {
  const old = thread({ id: "old", updatedAt: 1 });
  const fresh = thread({ id: "fresh", updatedAt: 10 });
  const first = navigationEnvironmentKey({
    id: "local",
    url: "ws://127.0.0.1:4501",
  });
  const second = navigationEnvironmentKey({
    id: "local",
    url: "ws://127.0.0.1:4502",
  });
  const visits = { [navigationVisitKey(first, "old")]: 100 };
  expect(recentSearchSuggestions([fresh, old], visits, first)).toEqual([
    old,
    fresh,
  ]);
  expect(recentSearchSuggestions([fresh, old], visits, second)).toEqual([
    fresh,
    old,
  ]);
  expect(recentSearchSuggestions([fresh, old], visits, first, 1)).toEqual([
    old,
  ]);
});
