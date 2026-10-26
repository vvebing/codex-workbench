import { t } from "../../lib/i18n";
import type { AskForApproval } from "../../generated/v2/AskForApproval";

/** Omission inherits the thread policy; null is not a reset instruction. */
export function approvalOptions(policy?: AskForApproval | "inherit"): {
  approvalPolicy?: AskForApproval;
} {
  return policy && policy !== "inherit" ? { approvalPolicy: policy } : {};
}

export function approvalLabel(policy?: AskForApproval): string {
  if (policy === undefined) return t("尚未获取");
  if (typeof policy === "object") return t("自定义审批");
  return (
    (
      {
        "on-request": t("按需审批"),
        untrusted: t("谨慎审批"),
        never: t("不请求审批"),
        "on-failure": t("失败时审批（已弃用）"),
      } as Record<string, string>
    )[policy] ?? policy
  );
}
