import { afterEach, expect, it } from "vitest";
import i18n from "../../src/lib/i18n";
import { commands } from "../../src/features/composer/Completions";
import { serviceTierLabel } from "../../src/features/composer/service-tier";
import {
  threadStatus,
  type NavigationThread,
} from "../../src/features/navigation/navigation-model";
import { threadTitle } from "../../src/features/sessions/thread-title";

const originalLanguage = i18n.language;
afterEach(async () => {
  await i18n.changeLanguage(originalLanguage);
});

it("updates module-level command descriptions and helper labels without reloading modules", async () => {
  await i18n.changeLanguage("en");
  expect(commands[0].description).toBe("View input shortcuts");
  expect(serviceTierLabel(undefined, null)).toBe("Server default");
  await i18n.changeLanguage("zh-CN");
  expect(commands[0].description).toBe("查看输入快捷键");
  expect(serviceTierLabel(undefined, null)).toBe("服务端默认");
});

it("localizes pending status while preserving user titles and semantic verification state", async () => {
  const item = {
    thread: { id: "thread", name: "保留用户标题", turns: [] },
    source: {
      connected: true,
      tasks: [
        {
          threadId: "thread",
          category: "失败或待核实",
          uncertain: true,
          title: "消息发送结果待核实",
        },
      ],
    },
    waiting: "待审批",
    running: false,
    failed: false,
  } as unknown as NavigationThread;
  await i18n.changeLanguage("en");
  expect(threadStatus(item)).toBe("Awaiting approval");
  expect(threadTitle(item.thread)).toBe("保留用户标题");
  item.waiting = null;
  expect(threadStatus(item)).toBe("Needs verification");
  await i18n.changeLanguage("zh-CN");
  expect(threadStatus(item)).toBe("待核实");
  expect(threadTitle(item.thread)).toBe("保留用户标题");
});
