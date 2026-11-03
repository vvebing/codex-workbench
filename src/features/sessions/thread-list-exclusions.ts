// Thread IDs are UUIDs. Local draft IDs and legacy placeholders must not make the
// entire server request fail validation.
const threadIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A new traversal may exclude every known row only when they fit the protocol cap.
 * Otherwise retain its existing cursor instead of restarting over a large cache. */
export function threadListExclusions(ids: Iterable<string>): string[] {
  const valid = new Set<string>();
  for (const id of ids) {
    if (!threadIdPattern.test(id)) continue;
    valid.add(id);
    if (valid.size > 100) return [];
  }
  return [...valid];
}

export function exclusionsRejected(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const message =
    typeof candidate?.message === "string" ? candidate.message : "";
  // A rejected continuation is not evidence that this optional filter is absent.
  if (/cursor/i.test(message) && !/excluded_?thread_?ids/i.test(message))
    return false;
  if (candidate?.code === -32602) return true;
  return (
    candidate?.code !== -32601 &&
    typeof candidate?.message === "string" &&
    /excluded_?thread_?ids/i.test(candidate.message) &&
    /unknown|unexpected|unsupported|not supported|unrecognized|invalid|不支持|未知/i.test(
      candidate.message,
    )
  );
}
