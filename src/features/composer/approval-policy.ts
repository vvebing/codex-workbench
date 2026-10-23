import type { AskForApproval } from "../../generated/v2/AskForApproval";

/** Omission inherits the thread policy; null is not a reset instruction. */
export function approvalOptions(policy?: AskForApproval | "inherit"): {
  approvalPolicy?: AskForApproval;
} {
  return policy && policy !== "inherit" ? { approvalPolicy: policy } : {};
}

export function approvalLabel(policy?: AskForApproval): string {
  if (policy === undefined) return "尚未获取";
  if (typeof policy === "object") return "自定义审批";
  return (
    (
      {
        "on-request": "按需审批",
        untrusted: "谨慎审批",
        never: "不请求审批",
        "on-failure": "失败时审批（已弃用）",
      } as Record<string, string>
    )[policy] ?? policy
  );
}
