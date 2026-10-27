import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Model } from "../../src/generated/v2/Model";
import {
  serviceTierLabel,
  serviceTierOptions,
} from "../../src/features/composer/service-tier";
import { approvalLabel } from "../../src/features/composer/approval-policy";
import { ContextUsage } from "../../src/features/composer/ContextUsage";
import { createRuntime } from "../../src/lib/runtime";

const model = {
  serviceTiers: [{ id: "priority", name: "优先", description: "目录说明" }],
  defaultServiceTier: "priority",
} as Model;

it("uses catalog tier names and only sends supported session-level overrides", () => {
  expect(serviceTierOptions(model, "priority")).toEqual({
    serviceTier: "priority",
  });
  expect(serviceTierOptions(model, "default")).toEqual({
    serviceTier: "default",
  });
  expect(serviceTierOptions(undefined, "default")).toEqual({});
  expect(serviceTierOptions(model)).toEqual({});
  expect(serviceTierOptions(model, "unsupported")).toEqual({});
  expect(serviceTierOptions(undefined, "priority")).toEqual({});
  expect(
    serviceTierOptions({ ...model, serviceTiers: [] }, "priority"),
  ).toEqual({});
  expect(serviceTierLabel(model, "priority")).toBe("优先");
  expect(serviceTierLabel(model, undefined)).toBe("尚未获取");
  expect(serviceTierLabel(model, null)).toBe("服务端默认");
  expect(serviceTierLabel(model, "future")).toContain("future");
});

it("reports unknown approval settings and renders context meaning explicitly", () => {
  expect(approvalLabel()).toBe("尚未获取");
  expect(approvalLabel("never")).toBe("不请求审批");
  expect(renderToStaticMarkup(createElement(ContextUsage))).toContain(
    "上下文：暂无数据",
  );
  expect(
    renderToStaticMarkup(
      createElement(ContextUsage, {
        usage: {
          last: { totalTokens: 25 },
          modelContextWindow: 100,
        } as never,
      }),
    ),
  ).toContain("上下文 25%");
});

it("passes serviceTier through normal submission without injecting a per-turn override", async () => {
  const runtime = createRuntime();
  const send = vi.spyOn(runtime.sessions, "send").mockResolvedValue("thread");
  try {
    runtime.drafts.setText("thread", "message");
    await runtime.sendDraft("thread", serviceTierOptions(model, "priority"));
    expect(send.mock.calls[0][2]).toMatchObject({ serviceTier: "priority" });
    expect(send.mock.calls[0][2]).not.toHaveProperty("serviceTierForTurn");
  } finally {
    send.mockRestore();
    runtime.connection.disconnect();
  }
});
