import { t, getLocale } from "../../lib/i18n";
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
  get unknown() {
    return t("暂未提供");
  },
};
export function planLabel(plan: PlanType | null | undefined): string {
  return plan ? (planLabels[plan] ?? plan) : t("暂未提供");
}
export function quotaWindowLabel(
  minutes: number | null,
  index: number,
): string {
  if (minutes == null || minutes <= 0)
    return index === 0 ? t("主要用量窗口") : t("次要用量窗口");
  if (minutes % 10080 === 0)
    return t("{{value0}} 周额度", { value0: minutes / 10080 });
  if (minutes % 1440 === 0)
    return t("{{value0}} 天额度", { value0: minutes / 1440 });
  if (minutes % 60 === 0)
    return t("{{value0}} 小时额度", { value0: minutes / 60 });
  return t("{{value0}} 分钟额度", { value0: minutes });
}
export function accountTime(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return t("暂未提供");
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime())
    ? t("暂未提供")
    : date.toLocaleString(getLocale());
}
