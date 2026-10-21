import { expect, test } from "vitest";
import {
  navigationSubtitle,
  navigationTitle,
} from "../../src/features/navigation/navigation-title";

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
