import { t } from "./i18n";
import { Store } from "./store";
import type { RpcMethod } from "./rpc";

export type CapabilityState =
  | "supported"
  | "unsupported"
  | "authentication"
  | "policy"
  | "invalid-request"
  | "temporary";
export interface CapabilityEvidence {
  state: CapabilityState;
  code?: number;
  checkedAt: number;
}
export const capabilityLabels: Record<CapabilityState, string> = {
  get supported() {
    return t("已成功调用");
  },
  get unsupported() {
    return t("服务端未提供此接口");
  },
  get authentication() {
    return t("需要登录或重新认证");
  },
  get policy() {
    return t("权限或受管策略限制");
  },
  get "invalid-request"() {
    return t("请求参数被拒绝，支持情况待核实");
  },
  get temporary() {
    return t("调用失败，支持情况待核实");
  },
};
/** Observations from real calls, never a guessed minimum-version table. */
export class CapabilityStore extends Store<
  Partial<Record<RpcMethod, CapabilityEvidence>>
> {
  constructor() {
    super({});
  }
  reset() {
    this.update({});
  }
  forget(method: RpcMethod) {
    const next = { ...this.state };
    delete next[method];
    this.update(next);
  }
  record(method: RpcMethod, error?: unknown) {
    let state: CapabilityState = "supported";
    const candidate = error as
      | {
          code?: number;
          data?: { httpStatusCode?: number; codexErrorInfo?: unknown };
        }
      | undefined;
    const code =
      typeof candidate?.code === "number" ? candidate.code : undefined;
    let http = candidate?.data?.httpStatusCode;
    const info = candidate?.data?.codexErrorInfo;
    if (info && typeof info === "object") {
      for (const variant of Object.values(info)) {
        if (
          variant &&
          typeof variant === "object" &&
          "httpStatusCode" in variant &&
          typeof variant.httpStatusCode === "number"
        )
          http = variant.httpStatusCode;
      }
    }
    const kind = typeof info === "string" ? info.toLowerCase() : "";
    if (error !== undefined) {
      if (code === -32601) state = "unsupported";
      else if (code === 401 || http === 401 || kind === "unauthorized")
        state = "authentication";
      else if (
        code === 403 ||
        http === 403 ||
        ["sandboxerror", "cyberpolicy", "misalignmentpolicyviolation"].includes(
          kind,
        )
      )
        state = "policy";
      else if (code === -32602) state = "invalid-request";
      else state = "temporary";
    }
    this.update({
      ...this.state,
      [method]: { state, code, checkedAt: Date.now() },
    });
  }
}
