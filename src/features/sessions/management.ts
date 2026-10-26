import { t } from "../../lib/i18n";
import type { Thread } from "../../generated/v2/Thread";
import { RpcError } from "../../lib/rpc";

/** Read-only compatibility for cached metadata; the current protocol has no pin write API. */
export type ManagedThread = Thread & { isPinned?: boolean };
export const pinnedOf = (thread: Thread): boolean =>
  (thread as ManagedThread).isPinned === true;
export function managementError(error: unknown): Error {
  return error instanceof RpcError && error.code === -32601
    ? new Error(t("当前服务端不支持此会话管理功能，请升级服务端后重试。"))
    : error instanceof Error
      ? error
      : new Error(String(error));
}
