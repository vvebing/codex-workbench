// Shared pure helpers: no process, filesystem or network access.
const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
export function isVersion(value: unknown): value is string {
  return typeof value === "string" && value.length < 100 && VERSION.test(value);
}
export function appServerVersion(userAgent: unknown): string | null {
  if (typeof userAgent !== "string") return null;
  // This integration initializes as codex_web. The parenthesized client version
  // at the end identifies our UI, not the connected server.
  const value = /^(?:codex_web|codex_cli_rs)\/([^\s]+)/.exec(userAgent)?.[1];
  return isVersion(value) ? value : null;
}
export function hasStableUpdate(current: string, latest: string): boolean {
  const a = VERSION.exec(current),
    b = VERSION.exec(latest);
  if (!a || !b || b[4]) return false;
  for (let index = 1; index <= 3; index++) {
    const diff = BigInt(b[index]) - BigInt(a[index]);
    if (diff !== 0n) return diff > 0n;
  }
  return !!a[4];
}
export interface CodexRelease {
  version: string;
  url: string;
  checkedAt: number;
}

export function parseStableRelease(
  data: unknown,
  checkedAt = Date.now(),
): CodexRelease {
  const value = data as Record<string, unknown> | null;
  const tag = typeof value?.tag_name === "string" ? value.tag_name : "";
  const version = tag.replace(/^rust-v/, "");
  if (
    value?.draft !== false ||
    value?.prerelease !== false ||
    !tag.startsWith("rust-v") ||
    !isVersion(version) ||
    version.includes("-")
  )
    throw new Error("Invalid stable release");
  return {
    version,
    url: `https://github.com/openai/codex/releases/tag/${encodeURIComponent(tag)}`,
    checkedAt,
  };
}
