import type { CodexClient } from "../../lib/rpc";
import ignore, { type Ignore } from "ignore";
import type { FuzzyFileSearchResponse } from "../../generated/FuzzyFileSearchResponse";
import type { FuzzyFileSearchResult } from "../../generated/FuzzyFileSearchResult";
import type { FsReadFileResponse } from "../../generated/v2/FsReadFileResponse";

export type FileSearchClient = Pick<CodexClient, "request">;

// Each search reads fresh rules from the connected host, shared across candidates.
// An excluded directory cannot be re-included by a .gitignore inside that directory.
export async function filterIgnoredFiles(
  files: FuzzyFileSearchResult[],
  client: FileSearchClient,
): Promise<FuzzyFileSearchResult[]> {
  const rules = new Map<string, Promise<Ignore>>();
  function load(root: string, directory: string): Promise<Ignore> {
    const path = `${root.replace(/[\\/]$/, "")}/${directory}.gitignore`;
    let pending = rules.get(path);
    if (!pending) {
      pending = client
        .request<FsReadFileResponse>("fs/readFile", { path })
        .then((response) => {
          const bytes = Uint8Array.from(atob(response.dataBase64), (c) =>
            c.charCodeAt(0),
          );
          return ignore({ ignorecase: false }).add(
            new TextDecoder().decode(bytes),
          );
        })
        .catch((error: unknown) => {
          if (
            /ENOENT|no such file|os error 2\b|cannot find the (?:file|path)|file not found/i.test(
              String(error),
            )
          )
            return ignore({ ignorecase: false });
          throw error;
        });
      rules.set(path, pending);
    }
    return pending;
  }
  const visible = await Promise.all(
    files.map(async (file) => {
      const path = file.path.replace(/\\/g, "/").replace(/^\.\//, "");
      const parts = path.split("/");
      if (
        !path ||
        parts.some((part) => !part || part === ".." || part === ".git") ||
        !ignore.isPathValid(path)
      )
        return false;
      const active: { directory: string; matcher: Ignore }[] = [];
      for (let depth = 0; depth < parts.length; depth++) {
        const directory = depth ? parts.slice(0, depth).join("/") + "/" : "";
        active.push({ directory, matcher: await load(file.root, directory) });
        const candidate =
          parts.slice(0, depth + 1).join("/") +
          (depth < parts.length - 1 || file.match_type === "directory"
            ? "/"
            : "");
        let excluded = false;
        for (const { directory: base, matcher } of active) {
          const result = matcher.test(candidate.slice(base.length));
          if (result.ignored) excluded = true;
          else if (result.unignored) excluded = false;
        }
        if (excluded) return false;
      }
      return true;
    }),
  );
  return files.filter((_, index) => visible[index]);
}

export async function searchWorkspaceFiles(
  client: FileSearchClient,
  cwd: string,
  query: string,
): Promise<FuzzyFileSearchResult[]> {
  const response = await client.request<FuzzyFileSearchResponse>(
    "fuzzyFileSearch",
    { query, roots: [cwd], cancellationToken: null },
  );
  return (await filterIgnoredFiles(response.files, client)).slice(0, 50);
}
