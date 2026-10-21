import type { AskForApproval } from "../../generated/v2/AskForApproval";

/** Omission inherits the thread policy; null is not a reset instruction. */
export function approvalOptions(policy?: AskForApproval | "inherit"): {
  approvalPolicy?: AskForApproval;
} {
  return policy && policy !== "inherit" ? { approvalPolicy: policy } : {};
}
