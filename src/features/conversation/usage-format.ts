import { getLocale, t } from "../../lib/i18n";

/** JSON transports numbers, while generated i64 fields are typed bigint. */
export function usageInteger(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

export function formatUsageCount(value: unknown): string {
  const integer = usageInteger(value);
  return integer == null
    ? t("暂未提供")
    : new Intl.NumberFormat(getLocale()).format(integer);
}

/** Keep micro-unit precision; never round an unknown/unsafe wire value to zero. */
export function formatUsageMicros(value: unknown, usd = false): string {
  const integer = usageInteger(value);
  if (integer == null) return t("暂未提供");
  const fraction = (integer % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  const whole = new Intl.NumberFormat(getLocale()).format(integer / 1_000_000n);
  return `${usd ? "USD " : ""}${whole}.${fraction}`;
}
