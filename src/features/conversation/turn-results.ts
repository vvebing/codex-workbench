import type { Turn } from "../../generated/v2/Turn";
import { mergeFileChanges } from "./model";

/** Header lines are metadata, not added or removed source lines. */
export function diffLineKind(
  line: string,
): "added" | "removed" | "header" | "context" {
  if (
    /^(diff --git |--- |\+\+\+ |@@|index |new file |deleted file |rename )/.test(
      line,
    )
  )
    return "header";
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return "context";
}
export function diffLineCounts(diff: string) {
  let added = 0,
    removed = 0;
  for (const line of diff.split("\n")) {
    const kind = diffLineKind(line);
    if (kind === "added") added++;
    if (kind === "removed") removed++;
  }
  return { added, removed };
}

/** A server turn diff is authoritative, including an explicitly empty diff.
 * Without it, preserve completed patches as operation records, never as a net diff.
 */
export function turnFileResults(turn: Turn, diff?: string, cwd?: string) {
  const aggregate = diff !== undefined;
  const records = turn.items.flatMap((item) =>
    item.type === "fileChange" && item.status === "completed"
      ? item.changes
      : [],
  );
  const files = mergeFileChanges([], aggregate ? diff : "", cwd);
  if (!aggregate) {
    for (const record of records) {
      for (const [path, file] of mergeFileChanges([record], "", cwd)) {
        const previous = files.get(path);
        files.set(path, {
          ...file,
          diff: previous ? `${previous.diff}\n\n${file.diff}` : file.diff,
        });
      }
    }
  }
  return { files: [...files.values()], aggregate, rawDiff: diff ?? "" };
}
