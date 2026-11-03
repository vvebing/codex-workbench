import { t } from "./i18n";
import type { ModelProviderError } from "../generated/v2/ModelProviderError";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Only recognize the documented shapes; unknown provider errors keep the normal fallback. */
export function modelProviderError(value: unknown): ModelProviderError | null {
  const data = record(value);
  if (!data || typeof data.modelProvider !== "string") return null;
  switch (data.type) {
    case "modelProviderMismatch":
      return typeof data.currentModelProvider === "string"
        ? {
            type: data.type,
            modelProvider: data.modelProvider,
            currentModelProvider: data.currentModelProvider,
          }
        : null;
    case "modelProviderNotConfigured":
      return { type: data.type, modelProvider: data.modelProvider };
    case "modelProviderPolicyConflict":
      return typeof data.requiredModelProvider === "string"
        ? {
            type: data.type,
            modelProvider: data.modelProvider,
            requiredModelProvider: data.requiredModelProvider,
          }
        : null;
    default:
      return null;
  }
}

/** Guidance only: never changes a model, provider, queue or request automatically. */
export function errorRecovery(error: unknown): string | null {
  const source = record(error);
  const data = record(source?.data);
  const provider = modelProviderError(data ?? source);
  switch (provider?.type) {
    case "modelProviderMismatch":
      return t(
        "会话使用提供方 {{provider}}，当前环境使用 {{current}}。请连接匹配的环境，或检查提供方配置后重新打开会话。",
        {
          provider: provider.modelProvider,
          current: provider.currentModelProvider,
        },
      );
    case "modelProviderNotConfigured":
      return t(
        "当前环境未配置提供方 {{provider}}。请检查该环境的 Codex 配置后重新连接。",
        { provider: provider.modelProvider },
      );
    case "modelProviderPolicyConflict":
      return t(
        "提供方 {{provider}} 不符合受管策略，策略要求 {{required}}。请联系管理员核对环境配置。",
        {
          provider: provider.modelProvider,
          required: provider.requiredModelProvider,
        },
      );
  }
  const info = data?.codexErrorInfo ?? source?.codexErrorInfo;
  switch (info) {
    case "modelNotFound":
      return t(
        "所选模型不可用。请刷新模型列表并选择当前环境支持的模型后重试。",
      );
    case "policyCapacityUnavailable":
      return t(
        "当前策略下暂时没有可用容量。请稍后重试，或联系管理员核对可用模型与受管策略。",
      );
    default:
      return null;
  }
}

/** Preserve the server's message, including for errors this client does not recognize. */
export function errorMessageWithRecovery(error: unknown): string {
  const source = record(error);
  const message =
    error instanceof Error
      ? error.message
      : typeof source?.message === "string"
        ? source.message
        : String(error);
  const recovery = errorRecovery(error);
  return recovery ? `${message}\n${recovery}` : message;
}
