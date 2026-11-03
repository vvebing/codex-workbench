import { describe, expect, it } from "vitest";
import { RpcError } from "../../src/lib/rpc";
import {
  errorMessageWithRecovery,
  errorRecovery,
  modelProviderError,
} from "../../src/lib/error-recovery";
import { CapabilityStore } from "../../src/lib/capabilities";

describe("structured error recovery", () => {
  it("keeps raw RPC errors and adds a concrete model recovery", () => {
    const error = new RpcError("Model missing: unavailable", -32000, {
      codexErrorInfo: "modelNotFound",
    });
    expect(errorMessageWithRecovery(error)).toBe(
      "Model missing: unavailable\n所选模型不可用。请刷新模型列表并选择当前环境支持的模型后重试。",
    );
    expect(error.message).toBe("Model missing: unavailable");
  });

  it("also accepts turn errors without an RPC wrapper", () => {
    expect(
      errorRecovery({
        message: "Capacity unavailable",
        codexErrorInfo: "policyCapacityUnavailable",
      }),
    ).toContain("受管策略");
  });

  it.each([
    [
      {
        type: "modelProviderMismatch",
        modelProvider: "bedrock",
        currentModelProvider: "openai",
      },
      "会话使用提供方 bedrock，当前环境使用 openai。",
    ],
    [
      { type: "modelProviderNotConfigured", modelProvider: "custom-provider" },
      "当前环境未配置提供方 custom-provider。",
    ],
    [
      {
        type: "modelProviderPolicyConflict",
        modelProvider: "openai",
        requiredModelProvider: "managed-provider",
      },
      "提供方 openai 不符合受管策略，策略要求 managed-provider。",
    ],
  ])(
    "explains provider recovery without mutating the error",
    (data, expected) => {
      const error = new RpcError("Server detail", -32600, data);
      expect(errorRecovery(error)).toContain(expected);
      expect(errorMessageWithRecovery(error)).toMatch(/^Server detail\n/);
      expect(error.data).toEqual(data);
    },
  );

  it("keeps unknown and malformed errors on their normal fallback", () => {
    for (const value of [
      undefined,
      null,
      [],
      { type: "modelProviderMismatch", modelProvider: "openai" },
      { type: "futureProviderError", modelProvider: "openai" },
    ]) {
      expect(modelProviderError(value)).toBeNull();
      expect(
        errorRecovery(new RpcError("Unrecognized detail", -32000, value)),
      ).toBeNull();
    }
    expect(errorMessageWithRecovery(new Error("Original detail"))).toBe(
      "Original detail",
    );
    expect(errorMessageWithRecovery("Disconnected")).toBe("Disconnected");
    expect(errorMessageWithRecovery({ message: "Original detail" })).toBe(
      "Original detail",
    );
  });

  it("distinguishes provider configuration and policy errors from unsupported methods", () => {
    const store = new CapabilityStore();
    store.record(
      "thread/resume",
      new RpcError("Provider mismatch", -32600, {
        type: "modelProviderMismatch",
        modelProvider: "custom",
        currentModelProvider: "openai",
      }),
    );
    expect(store.getSnapshot()["thread/resume"]?.state).toBe("invalid-request");
    store.record(
      "model/list",
      new RpcError("Managed provider", -32600, {
        type: "modelProviderPolicyConflict",
        modelProvider: "openai",
        requiredModelProvider: "custom",
      }),
    );
    expect(store.getSnapshot()["model/list"]?.state).toBe("policy");
    store.record(
      "turn/start",
      new RpcError("Capacity", -32000, {
        codexErrorInfo: "policyCapacityUnavailable",
      }),
    );
    expect(store.getSnapshot()["turn/start"]?.state).toBe("policy");
  });
});
