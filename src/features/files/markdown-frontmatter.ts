import { parse, stringify } from "yaml";

export function splitFrontmatter(text: string) {
  const match =
    /^\uFEFF?---[\t ]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[\t ]*(?:\r?\n|$)/.exec(
      text,
    );
  if (!match) return { body: text, rows: [] };
  try {
    const metadata: unknown = parse(match[1], { maxAliasCount: 50 });
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
      return { body: text, rows: [] };
    const rows = Object.entries(metadata).map(([key, value]) => ({
      key,
      value:
        value !== null && typeof value === "object"
          ? stringify(value).trimEnd()
          : String(value ?? "null"),
    }));
    return { body: text.slice(match[0].length), rows };
  } catch {
    // Invalid metadata must remain visible and must not break file preview.
    return { body: text, rows: [] };
  }
}
