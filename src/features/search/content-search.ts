import { t } from "../../lib/i18n";
import { workspacePath } from "../shell/project-files";
import type { FileSearchClient } from "../composer/file-search";
import { filterIgnoredFiles } from "../composer/file-search";
import type { FuzzyFileSearchResult } from "../../generated/FuzzyFileSearchResult";
import type { CommandExecResponse } from "../../generated/v2/CommandExecResponse";
import type { FsReadDirectoryResponse } from "../../generated/v2/FsReadDirectoryResponse";
import type { FsReadFileResponse } from "../../generated/v2/FsReadFileResponse";

export type ContentMatch = {
  path: string;
  line: number;
  column: number;
  text: string;
  matchLength: number;
};
export type ContentSearchResult = {
  matches: ContentMatch[];
  truncated: boolean;
  warning?: string;
};
export type ContentSearchOptions = {
  caseSensitive?: boolean;
  signal?: AbortSignal;
  maxResults?: number;
  onProgress?: (result: ContentSearchResult) => void;
};
const OUTPUT_CAP = 2 * 1024 * 1024;
function candidate(
  root: string,
  path: string,
  directory = false,
): FuzzyFileSearchResult {
  return {
    root,
    path,
    match_type: directory ? "directory" : "file",
    file_name: path.split("/").at(-1)!,
    score: 0,
    indices: null,
  };
}
function check(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
}

/** GNU and BSD grep --null terminate the filename with NUL, including unusual filenames. */
export function parseGrepMatches(output: string): {
  rows: { path: string; line: number; text: string }[];
  incomplete: boolean;
} {
  const rows: { path: string; line: number; text: string }[] = [];
  let offset = 0;
  while (offset < output.length) {
    const separator = output.indexOf("\0", offset);
    if (separator < 0) return { rows, incomplete: true };
    const end = output.indexOf("\n", separator + 1);
    if (end < 0) return { rows, incomplete: true };
    const match = /^(\d+):(.*)$/s.exec(output.slice(separator + 1, end));
    if (!match) return { rows, incomplete: true };
    rows.push({
      path: output.slice(offset, separator).replace(/^\.\//, ""),
      line: Number(match[1]),
      text: match[2].replace(/\r$/, ""),
    });
    offset = end + 1;
  }
  return { rows, incomplete: false };
}

export async function searchWorkspaceContent(
  client: FileSearchClient,
  cwd: string,
  query: string,
  options: ContentSearchOptions = {},
): Promise<ContentSearchResult> {
  check(options.signal);
  if (!query) return { matches: [], truncated: false };
  if (/[\r\n\0]/.test(query)) throw new Error(t("请输入单行文本进行搜索。"));
  const limit = Math.max(1, Math.min(options.maxResults ?? 500, 2000));
  const needle = options.caseSensitive ? query : query.toLowerCase();
  const makeMatch = (
    path: string,
    line: number,
    text: string,
  ): ContentMatch | undefined => {
    const column = (options.caseSensitive ? text : text.toLowerCase()).indexOf(
      needle,
    );
    return column < 0
      ? undefined
      : { path, line, column: column + 1, text, matchLength: query.length };
  };
  const matches: ContentMatch[] = [];
  let truncated = false;
  let skipped = false;
  const snapshot = (): ContentSearchResult => ({
    matches: matches.slice(0, limit),
    truncated: truncated || matches.length > limit,
    ...(skipped
      ? { warning: t("已跳过部分无法读取、过大或层级过深的文件。") }
      : {}),
  });
  const publish = () => {
    check(options.signal);
    options.onProgress?.(snapshot());
  };
  const run = async (
    command: string[],
  ): Promise<CommandExecResponse | undefined> => {
    check(options.signal);
    const processId = `search-${crypto.randomUUID()}`;
    const terminate = () => {
      void client
        .request("command/exec/terminate", { processId })
        .catch(() => {});
    };
    options.signal?.addEventListener("abort", terminate, { once: true });
    try {
      return await client.request<CommandExecResponse>("command/exec", {
        command,
        processId,
        cwd,
        timeoutMs: 15000,
        outputBytesCap: OUTPUT_CAP,
        sandboxPolicy: { type: "readOnly", networkAccess: false },
      });
    } catch {
      check(options.signal);
      return undefined;
    } finally {
      options.signal?.removeEventListener("abort", terminate);
    }
  };
  function validPath(path: string): boolean {
    if (path.split(/[\\/]/).includes(".git")) return false;
    try {
      workspacePath(cwd, path);
      return true;
    } catch {
      return false;
    }
  }
  function* batches(paths: string[]): Generator<string[]> {
    let batch: string[] = [];
    let bytes = 0;
    for (const path of paths) {
      const size = new TextEncoder().encode(path).length + 3;
      if (batch.length && (batch.length >= 64 || bytes + size > 16000)) {
        yield batch;
        batch = [];
        bytes = 0;
      }
      batch.push(path);
      bytes += size;
    }
    if (batch.length) yield batch;
  }
  async function* candidates(): AsyncGenerator<string[]> {
    const listing = await run([
      "git",
      "--no-optional-locks",
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
    ]);
    check(options.signal);
    // NUL framing preserves spaces, colons and newlines in filenames. A partial
    // enumeration must not silently omit files: use bounded traversal instead.
    if (
      listing?.exitCode === 0 &&
      (!listing.stdout || listing.stdout.endsWith("\0")) &&
      new TextEncoder().encode(listing.stdout).length < OUTPUT_CAP
    ) {
      const paths = [...new Set(listing.stdout.split("\0").filter(Boolean))];
      if (paths.every(validPath)) {
        if (paths.length > 10000) truncated = true;
        yield* batches(paths.slice(0, 10000));
        return;
      }
    }
    const pending = [""];
    let visited = 0;
    // Reuse ancestor .gitignore reads throughout this search.
    const rules = new Map();
    while (pending.length && visited < 10000) {
      check(options.signal);
      const directory = pending.shift()!;
      let response: FsReadDirectoryResponse;
      try {
        response = await client.request<FsReadDirectoryResponse>(
          "fs/readDirectory",
          {
            path: directory ? workspacePath(cwd, directory) : cwd,
          },
        );
      } catch (error) {
        check(options.signal);
        if (!directory) throw error;
        skipped = true;
        continue;
      }
      check(options.signal);
      const entries = response.entries.filter(
        (entry) =>
          entry.fileName !== ".git" &&
          entry.fileName !== "." &&
          entry.fileName !== ".." &&
          !/[\\/\0]/.test(entry.fileName),
      );
      const remaining = 10000 - visited;
      if (entries.length > remaining) truncated = true;
      const selected = entries.slice(0, remaining);
      visited += selected.length;
      const visible = new Set(
        (
          await filterIgnoredFiles(
            selected.map((entry) =>
              candidate(
                cwd,
                directory ? `${directory}/${entry.fileName}` : entry.fileName,
                entry.isDirectory,
              ),
            ),
            client,
            rules,
          )
        ).map((file) => file.path),
      );
      check(options.signal);
      const paths: string[] = [];
      for (const entry of selected) {
        const path = directory
          ? `${directory}/${entry.fileName}`
          : entry.fileName;
        if (!visible.has(path)) continue;
        if (entry.isDirectory) {
          if (path.split("/").length < 32) pending.push(path);
          else skipped = true;
        } else if (entry.isFile) paths.push(path);
      }
      yield* batches(paths);
    }
    if (pending.length) truncated = true;
  }
  const readMatches = async (path: string): Promise<ContentMatch[]> => {
    check(options.signal);
    let data: FsReadFileResponse;
    try {
      data = await client.request<FsReadFileResponse>("fs/readFile", {
        path: workspacePath(cwd, path),
      });
    } catch {
      check(options.signal);
      skipped = true;
      return [];
    }
    check(options.signal);
    if (data.dataBase64.length > 1400000) {
      skipped = true;
      return [];
    }
    const bytes = Uint8Array.from(atob(data.dataBase64), (char) =>
      char.charCodeAt(0),
    );
    if (bytes.includes(0)) return [];
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return [];
    }
    const found: ContentMatch[] = [];
    const lines = text.split(/\r?\n/);
    for (let line = 0; line < lines.length; line++) {
      const match = makeMatch(path, line + 1, lines[line]);
      if (match) found.push(match);
      if (found.length > limit) break;
    }
    return found;
  };
  let grepAvailable = true;
  for await (const batch of candidates()) {
    check(options.signal);
    let completed = false;
    if (grepAvailable) {
      const response = await run([
        "grep",
        "-n",
        "-H",
        "-I",
        "-m",
        String(limit + 1),
        "--null",
        "-F",
        ...(options.caseSensitive ? [] : ["-i"]),
        "-e",
        query,
        "--",
        ...batch.map((path) => `./${path}`),
      ]);
      check(options.signal);
      if (response && (response.exitCode === 0 || response.exitCode === 1)) {
        const parsed = parseGrepMatches(response.stdout);
        if (
          !parsed.incomplete &&
          new TextEncoder().encode(response.stdout).length < OUTPUT_CAP
        ) {
          const allowed = new Set(batch);
          for (const row of parsed.rows) {
            if (!allowed.has(row.path)) continue;
            const match = makeMatch(row.path, row.line, row.text);
            if (match) matches.push(match);
            if (matches.length > limit) break;
          }
          completed = true;
        }
        // A large match must only retry this batch, never rescan the project.
      } else if (
        !response ||
        response.exitCode === 126 ||
        response.exitCode === 127 ||
        /unrecognized option|unknown option|illegal option|invalid option/i.test(
          response.stderr,
        )
      ) {
        grepAvailable = false;
      }
    }
    if (!completed) {
      // Bound remote reads and publish partial results without waiting for the
      // entire project; future batches never probe a missing grep again.
      for (let offset = 0; offset < batch.length; offset += 8) {
        const results = await Promise.all(
          batch.slice(offset, offset + 8).map(readMatches),
        );
        check(options.signal);
        for (const found of results) {
          matches.push(
            ...found.slice(0, Math.max(0, limit + 1 - matches.length)),
          );
        }
        publish();
        if (matches.length > limit) break;
      }
    }
    publish();
    if (matches.length > limit) break;
  }
  check(options.signal);
  return snapshot();
}
