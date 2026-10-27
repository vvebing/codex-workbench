import { t } from "../../lib/i18n";
import type { Model } from "../../generated/v2/Model";

/** Priority-capable models can explicitly return to standard speed. */
export function serviceTierOptions(
  model: Model | undefined,
  choice?: string,
): {
  serviceTier?: string;
} {
  const tiers = model?.serviceTiers;
  const supported =
    tiers?.some((tier) => tier.id === choice) ||
    (choice === "default" && tiers?.some((tier) => tier.id === "priority"));
  return choice && supported ? { serviceTier: choice } : {};
}

export function serviceTierLabel(
  model: Model | undefined,
  tier: string | null | undefined,
) {
  if (tier === undefined) return t("尚未获取");
  if (tier === null) return t("服务端默认");
  return (
    model?.serviceTiers?.find((item) => item.id === tier)?.name ??
    t("{{value0}}（目录未声明）", { value0: tier })
  );
}
