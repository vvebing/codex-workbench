import { t } from "../../lib/i18n";
import type { ReviewTarget } from "../../generated/v2/ReviewTarget";
import type { ThreadGoalSetParams } from "../../generated/v2/ThreadGoalSetParams";
import type { ThreadAttachmentAddParams } from "../../generated/v2/ThreadAttachmentAddParams";
import type { ThreadAttachment } from "../../generated/v2/ThreadAttachment";

export const referenceAttachmentType = "codex-workbench/reference";
export function reviewTarget(
  type: ReviewTarget["type"],
  value: string,
): ReviewTarget {
  const text = value.trim();
  if (type === "uncommittedChanges") return { type };
  if (!text) throw new Error(t("请填写审查目标。"));
  if (type === "baseBranch") return { type, branch: text };
  if (type === "commit") return { type, sha: text, title: null };
  return { type, instructions: text };
}
export function goalParams(
  threadId: string,
  objective: string,
  status: ThreadGoalSetParams["status"],
  budget: string,
): ThreadGoalSetParams {
  const text = objective.trim();
  if (!text || Array.from(text).length > 4000)
    throw new Error(t("目标需为 1 至 4000 个字符。"));
  const tokenBudget = budget.trim() ? Number(budget) : null;
  if (
    tokenBudget !== null &&
    (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0)
  )
    throw new Error(t("Token 预算必须为正整数，或留空表示不限。"));
  return { threadId, origin: "user", objective: text, status, tokenBudget };
}
export function referenceParams(
  threadId: string,
  label: string,
  location: string,
): ThreadAttachmentAddParams {
  const identityKey = location.trim();
  if (!identityKey) throw new Error(t("请填写链接或文件路径。"));
  return {
    threadId,
    attachmentType: referenceAttachmentType,
    identityKey,
    payload: { label: label.trim() || identityKey, location: identityKey },
  };
}
export function attachmentLabel(attachment: ThreadAttachment): string {
  const payload = attachment.payload;
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    typeof payload.label === "string"
  )
    return payload.label;
  return attachment.identityKey;
}
