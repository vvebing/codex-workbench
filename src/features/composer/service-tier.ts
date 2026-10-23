import type { Model } from "../../generated/v2/Model";

/** Only catalog-supported choices may override the thread tier. */
export function serviceTierOptions(
  model: Model | undefined,
  choice?: string,
): {
  serviceTier?: string;
} {
  return choice && model?.serviceTiers?.some((tier) => tier.id === choice)
    ? { serviceTier: choice }
    : {};
}

export function serviceTierLabel(
  model: Model | undefined,
  tier: string | null | undefined,
) {
  if (tier === undefined) return "尚未获取";
  if (tier === null) return "服务端默认";
  return (
    model?.serviceTiers?.find((item) => item.id === tier)?.name ??
    `${tier}（目录未声明）`
  );
}
