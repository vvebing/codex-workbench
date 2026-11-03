import type { ThreadItem } from "../../generated/v2/ThreadItem";

export function validItemTime(
  value: number | null | undefined,
): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Protocol item timestamps are milliseconds; turn timestamps are seconds. */
export function operationDurationMs(item: ThreadItem): number | null {
  if (
    "durationMs" in item &&
    typeof item.durationMs === "number" &&
    Number.isFinite(item.durationMs) &&
    item.durationMs >= 0
  )
    return item.durationMs;
  if (
    validItemTime(item.startedAtMs) &&
    validItemTime(item.completedAtMs) &&
    item.completedAtMs >= item.startedAtMs
  )
    return item.completedAtMs - item.startedAtMs;
  return null;
}

export function operationElapsedMs(
  item: ThreadItem,
  status: string,
  now: number,
): number | null {
  const recorded = operationDurationMs(item);
  if (recorded !== null) return recorded;
  if (
    ["inProgress", "in_progress", "waiting"].includes(status) &&
    validItemTime(item.startedAtMs) &&
    item.completedAtMs == null &&
    Number.isFinite(now) &&
    now >= item.startedAtMs
  )
    return now - item.startedAtMs;
  return null;
}
