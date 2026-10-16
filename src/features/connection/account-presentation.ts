import type { PlanType } from "../../generated/PlanType";

const planLabels: Partial<Record<PlanType, string>> = {
  free: "Free",
  go: "Go",
  plus: "Plus",
  pro: "Pro",
  prolite: "Pro Lite",
  promax: "Pro Max",
  team: "Team",
  business: "Business",
  enterprise: "Enterprise",
  edu: "Edu",
  edu_plus: "Edu Plus",
  edu_pro: "Edu Pro",
  unknown: "暂未提供",
};
export function planLabel(plan: PlanType | null | undefined): string {
  return plan ? (planLabels[plan] ?? plan) : "暂未提供";
}
export function quotaWindowLabel(
  minutes: number | null,
  index: number,
): string {
  if (minutes == null || minutes <= 0)
    return index === 0 ? "主要用量窗口" : "次要用量窗口";
  if (minutes % 10080 === 0) return `${minutes / 10080} 周额度`;
  if (minutes % 1440 === 0) return `${minutes / 1440} 天额度`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时额度`;
  return `${minutes} 分钟额度`;
}
export function accountTime(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "暂未提供";
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? "暂未提供" : date.toLocaleString();
}
