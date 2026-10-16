import { expect, test } from "vitest";
import {
  filterIgnoredFiles,
  searchWorkspaceFiles,
  type FileSearchClient,
} from "../../src/features/composer/file-search";
import type { FuzzyFileSearchResult } from "../../src/generated/FuzzyFileSearchResult";

function file(path: string, root = "/remote/project"): FuzzyFileSearchResult {
  return {
    root,
    path,
    file_name: path.split("/").at(-1)!,
    match_type: "file",
    score: 100,
    indices: null,
  };
}
function client(
  rules: Record<string, string>,
  files: FuzzyFileSearchResult[] = [],
) {
  const reads: string[] = [];
  const rpc: FileSearchClient = {
    async request<T>(method: string, params: unknown): Promise<T> {
      if (method === "fuzzyFileSearch") return { files } as T;
      const { path } = params as { path: string };
      reads.push(path);
      if (!(path in rules))
        throw Error("No such file or directory (os error 2)");
      return { dataBase64: Buffer.from(rules[path]).toString("base64") } as T;
    },
  };
  return { rpc, reads };
}

test("excludes gitignored files and prunes ignored directories before reading their rules", async () => {
  const { rpc, reads } = client({
    "/remote/project/.gitignore": "node_modules/\ndist/\n*.log\n!keep.log\n",
  });
  const files = [
    "src/app.ts",
    "node_modules/app.ts",
    "dist/app.ts",
    "debug.log",
    "keep.log",
    ".git/config",
  ].map((path) => file(path));
  expect((await filterIgnoredFiles(files, rpc)).map((f) => f.path)).toEqual([
    "src/app.ts",
    "keep.log",
  ]);
  expect(reads.filter((p) => p === "/remote/project/.gitignore")).toHaveLength(
    1,
  );
  expect(reads).not.toContain("/remote/project/node_modules/.gitignore");
  expect(reads).not.toContain("/remote/project/dist/.gitignore");
});

test("nested gitignore overrides parent patterns, respecting anchored paths and Unicode", async () => {
  const { rpc } = client({
    "/remote/project/.gitignore": "*.log\n/root-only.txt\n秘密.txt\n",
    "/remote/project/src/.gitignore": "!keep.log\ngenerated/\n",
  });
  const files = [
    "src/keep.log",
    "src/debug.log",
    "src/root-only.txt",
    "root-only.txt",
    "src/generated/app.ts",
    "src/秘密.txt",
    "src/visible.ts",
  ].map((path) => file(path));
  expect((await filterIgnoredFiles(files, rpc)).map((f) => f.path)).toEqual([
    "src/keep.log",
    "src/root-only.txt",
    "src/visible.ts",
  ]);
});

test("filters before limiting suggestions, and re-reads rules on the next search", async () => {
  const rules = { "/remote/project/.gitignore": "ignored/\n" };
  const files = [
    ...Array.from({ length: 50 }, (_, index) => file(`ignored/${index}.ts`)),
    file("app.ts"),
  ];
  const { rpc } = client(rules, files);
  expect(
    (await searchWorkspaceFiles(rpc, "/remote/project", "app")).map(
      (f) => f.path,
    ),
  ).toEqual(["app.ts"]);
  rules["/remote/project/.gitignore"] = "app.ts\n";
  expect(
    (await searchWorkspaceFiles(rpc, "/remote/project", "app")).some(
      (f) => f.path === "app.ts",
    ),
  ).toBe(false);
});

test("directories without gitignore remain searchable, but read failures are surfaced", async () => {
  expect(
    await filterIgnoredFiles([file("src/app.ts")], client({}).rpc),
  ).toHaveLength(1);
  const rpc: FileSearchClient = {
    async request() {
      throw Error("Permission denied");
    },
  };
  await expect(filterIgnoredFiles([file("app.ts")], rpc)).rejects.toThrow(
    "Permission denied",
  );
});
