import { expect, test } from "vitest";
import {
  navigationSubtitle,
  navigationTitle,
} from "../../src/features/navigation/navigation-title";
import { firstTaskTitle } from "../../src/features/sessions/thread-title";
import { placeholderThread } from "../../src/lib/state";
import type { ThreadItem } from "../../src/generated/v2/ThreadItem";
import type { Turn } from "../../src/generated/v2/Turn";

const user = (text: string, clientId: string | null = null): ThreadItem => ({
  type: "userMessage",
  id: text,
  clientId,
  content: [{ type: "text", text, text_elements: [] }],
});
const turns = (...messages: ThreadItem[]): Turn[] => [
  { id: "first", items: messages } as Turn,
];

test("preserves custom names and makes only preview-derived titles concise", () => {
  expect(
    navigationTitle({ name: "请检查 `git status`", preview: "other" }),
  ).toBe("请检查 `git status`");
  expect(
    navigationTitle({
      name: null,
      preview: "\n  请检查 `git status`，确认冗余修改。\n详细约束另见下文",
    }),
  ).toBe("检查 git status，确认冗余修改。");
  expect(
    navigationTitle({
      name: "",
      preview: "使用 $kimi-webbridge 访问实际左侧栏",
    }),
  ).toBe("访问实际左侧栏");
  expect(navigationTitle({ name: null, preview: "## 请分析会话导航" })).toBe(
    "分析会话导航",
  );
  expect(navigationTitle({ name: null, preview: "请求参数验证" })).toBe(
    "请求参数验证",
  );
  expect(navigationTitle({ name: null, preview: "请问为什么失败？" })).toBe(
    "请问为什么失败？",
  );
  expect(navigationTitle({ name: null, preview: "\n " })).toBe("新会话");
});

test("subtitle keeps full preview context only when it supplements a custom title", () => {
  expect(
    navigationSubtitle({ name: "导航重构", preview: "请检查\n左侧栏交互" }),
  ).toBe("请检查 左侧栏交互");
  expect(navigationSubtitle({ name: "标题", preview: " 标题 " })).toBe("");
  expect(navigationSubtitle({ name: " ", preview: "摘要" })).toBe("");
});

test("uses the original task instead of answer wrappers or a later diagnostic preview", () => {
  for (const preview of [
    "回答问题：\n旧 websocket-server 的镜像 tag 是什么？\nv1.49.8",
    "[ crs-example | DB0 ] # EXISTS sess:example\n1\n[ crs-example | DB0 ] # TTL sess:example\n85451",
  ]) {
    const thread = {
      ...placeholderThread("task"),
      preview,
      turns: turns(
        user("请排查 Session 频繁请求与接口 401"),
        user(preview),
        user("再检查前端登录顺序"),
      ),
    };
    expect(navigationTitle(thread)).toBe("排查 Session 频繁请求与接口 401");
    expect(navigationTitle({ ...thread, name: "登录鉴权排查" })).toBe(
      "登录鉴权排查",
    );
  }
});

test("skips answers, images, fenced code, JSON, logs and acknowledgements when identifying a task", () => {
  const history = turns(
    user("回答问题：\n当前版本？\nv1.49.8"),
    user("选择发布版本", "codex-question:item:answer"),
    {
      type: "userMessage",
      id: "image",
      clientId: null,
      content: [{ type: "image", url: "data:image/png;base64,example" }],
    } as ThreadItem,
    user('```json\n{"session":null}\n```'),
    user('{\n  "session": null,\n  "uid": null\n}'),
    user("[ crs-example | DB0 ] # TTL sess:example\n85451"),
    user("2026-10-16T10:00:00 ERROR request failed"),
    user("是的"),
    user("## 问题描述\n\n请分析登录鉴权失败\n后续说明"),
  );
  expect(firstTaskTitle({ turns: history })).toEqual({
    turnId: "first",
    text: "分析登录鉴权失败",
  });
  expect(
    navigationTitle({
      name: null,
      preview: "日志：\n```sh\nredis-cli GET session\n```\n请分析登录失败原因",
    }),
  ).toBe("分析登录失败原因");
});

test("does not present submitted answers or Redis commands as titles before history is loaded", () => {
  expect(
    navigationTitle({ name: null, preview: "回答问题：\n当前版本？\nv1.49.8" }),
  ).toBe("未命名会话");
  const createdAt = new Date(2026, 9, 16, 12).getTime() / 1000;
  expect(
    navigationTitle({
      name: null,
      preview: "[ crs-example | DB0 ] # TTL sess:example\n85451",
      createdAt,
    }),
  ).toBe("未命名会话 · 10月16日");
  expect(navigationTitle({ name: "回答问题：", preview: "ignored" })).toBe(
    "回答问题：",
  );
});
