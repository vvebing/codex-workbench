import { expect, test } from "vitest";
import {
  parseGrepMatches,
  searchWorkspaceContent,
} from "../../src/features/search/content-search";
import type { FileSearchClient } from "../../src/features/composer/file-search";

function client(
  handler: (method: string, params: Record<string, unknown>) => unknown,
): FileSearchClient {
  return {
    async request<T>(method: string, params?: unknown): Promise<T> {
      return (await handler(method, params as Record<string, unknown>)) as T;
    },
  };
}
const encoded = (text: string) => ({
  dataBase64: Buffer.from(text).toString("base64"),
});

test("parses filenames containing colons and newlines without confusing line numbers", () => {
  expect(
    parseGrepMatches(
      "./a:2\nb.ts\0" + "12:before:needle\n./other\0" + "3:partial",
    ),
  ).toEqual({
    rows: [{ path: "a:2\nb.ts", line: 12, text: "before:needle" }],
    incomplete: true,
  });
});

test("uses literal argv, filters ignored files and caps visible results", async () => {
  let command: unknown;
  const rpc = client((method, params) => {
    if (method === "command/exec") {
      if ((params.command as string[])[0] === "git")
        return { exitCode: 0, stdout: "a.ts\0b.ts\0", stderr: "" };
      command = params.command;
      return {
        exitCode: 0,
        stdout:
          "./ignored.ts\0" +
          "1:$(hello)\n./a.ts\0" +
          "2:x $(hello)\n./b.ts\0" +
          "3:$(hello)\n",
        stderr: "",
      };
    }
    if (params.path === "/project/.gitignore") return encoded("ignored.ts");
    throw Error("ENOENT");
  });
  const result = await searchWorkspaceContent(rpc, "/project", "$(hello)", {
    maxResults: 1,
  });
  expect(command).toContain("$(hello)");
  expect(command).toContain("--null");
  expect(result).toEqual({
    matches: [
      { path: "a.ts", line: 2, column: 3, text: "x $(hello)", matchLength: 8 },
    ],
    truncated: true,
  });
});

test("falls back without grep and skips ignored directories and binary files", async () => {
  const reads: string[] = [];
  const rpc = client((method, params) => {
    if (method === "command/exec") throw Error("grep unavailable");
    if (method === "fs/readDirectory")
      return {
        entries: [
          { fileName: "ignored", isDirectory: true, isFile: false },
          { fileName: "app.ts", isDirectory: false, isFile: true },
          { fileName: "image", isDirectory: false, isFile: true },
        ],
      };
    reads.push(String(params.path));
    if (params.path === "/project/.gitignore") return encoded("ignored/");
    if (params.path === "/project/app.ts") return encoded("hello\nHELLO again");
    if (params.path === "/project/image") return encoded("\0hello");
    throw Error("ENOENT");
  });
  const result = await searchWorkspaceContent(rpc, "/project", "hello");
  expect(result.matches.map((match) => match.line)).toEqual([1, 2]);
  expect(reads).not.toContain("/project/ignored/.gitignore");
  expect(result.truncated).toBe(false);
});

test("retries truncated grep output with ignore-first traversal instead of reporting zero matches", async () => {
  const reads: string[] = [];
  const rpc = client((method, params) => {
    if (method === "command/exec")
      return {
        exitCode: 0,
        stdout: "./dist/bundle.js\0" + "1:macos".repeat(100),
        stderr: "",
      };
    if (method === "fs/readDirectory")
      return {
        entries: [
          { fileName: "dist", isDirectory: true, isFile: false },
          { fileName: "README.md", isDirectory: false, isFile: true },
        ],
      };
    reads.push(String(params.path));
    if (params.path === "/project/.gitignore") return encoded("dist/");
    if (params.path === "/project/README.md")
      return encoded("Works on macOS.\n");
    throw Error("ENOENT");
  });
  const result = await searchWorkspaceContent(rpc, "/project", "macos");
  expect(result.matches).toEqual([
    {
      path: "README.md",
      line: 1,
      column: 10,
      text: "Works on macOS.",
      matchLength: 5,
    },
  ]);
  expect(result.truncated).toBe(false);
  expect(reads).not.toContain("/project/dist/.gitignore");
});

test("terminates a running command when cancelled and discards its results", async () => {
  const abort = new AbortController();
  let finish: (value: unknown) => void = () => {};
  let terminated = false;
  const rpc = client((method) => {
    if (method === "command/exec")
      return new Promise((resolve) => {
        finish = resolve;
      });
    if (method === "command/exec/terminate") {
      terminated = true;
      return {};
    }
    throw Error("unexpected read");
  });
  const pending = searchWorkspaceContent(rpc, "/project", "hello", {
    signal: abort.signal,
  });
  abort.abort();
  finish({ exitCode: 0, stdout: "", stderr: "" });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(terminated).toBe(true);
});

test("unreadable child directories preserve sibling results and invalid UTF-8 is skipped", async () => {
  const rpc = client((method, params) => {
    if (method === "command/exec") throw Error("grep unavailable");
    if (method === "fs/readDirectory") {
      if (params.path !== "/project") throw Error("Permission denied");
      return {
        entries: [
          { fileName: "private", isDirectory: true, isFile: false },
          { fileName: "good.txt", isDirectory: false, isFile: true },
          { fileName: "invalid.bin", isDirectory: false, isFile: true },
        ],
      };
    }
    if (params.path === "/project/good.txt") return encoded("hello");
    if (params.path === "/project/invalid.bin")
      return {
        dataBase64: Buffer.from([104, 101, 108, 108, 111, 255]).toString(
          "base64",
        ),
      };
    throw Error("ENOENT");
  });
  const result = await searchWorkspaceContent(rpc, "/project", "hello");
  expect(result.matches.map((match) => match.path)).toEqual(["good.txt"]);
  expect(result.warning).toContain("无法读取");
});

test("unreadable workspace roots fail visibly", async () => {
  const rpc = client((method) => {
    if (method === "command/exec") throw Error("grep unavailable");
    throw Error("Workspace permission denied");
  });
  await expect(
    searchWorkspaceContent(rpc, "/project", "hello"),
  ).rejects.toThrow("Workspace permission denied");
});

test("enumerates Git files once, searches bounded explicit batches and publishes early results", async () => {
  const paths = Array.from({ length: 130 }, (_, i) => `src/file-${i}.ts`);
  const commands: string[][] = [];
  const snapshots: number[] = [];
  const rpc = client((method, params) => {
    if (method !== "command/exec")
      throw Error("Git search must not read files over RPC");
    const argv = params.command as string[];
    commands.push(argv);
    if (argv[0] === "git")
      return { exitCode: 0, stdout: paths.join("\0") + "\0", stderr: "" };
    expect(argv).not.toContain("-r");
    expect(argv).not.toContain(".");
    expect(argv.slice(argv.indexOf("--") + 1).length).toBeLessThanOrEqual(64);
    const path = argv[argv.indexOf("--") + 1];
    return { exitCode: 0, stdout: `${path}\0` + "1:hello\n", stderr: "" };
  });
  const result = await searchWorkspaceContent(rpc, "/project", "hello", {
    onProgress: (value) => snapshots.push(value.matches.length),
  });
  expect(commands[0]).toContain("--exclude-standard");
  expect(commands).toHaveLength(4);
  expect(result.matches).toHaveLength(3);
  expect(snapshots).toEqual([1, 2, 3]);
});

test("missing grep is probed once and file reads have bounded concurrency", async () => {
  const paths = Array.from({ length: 70 }, (_, i) => `file-${i}.txt`);
  let probes = 0;
  let active = 0;
  let peak = 0;
  const rpc = client(async (method, params) => {
    if (method === "command/exec") {
      if ((params.command as string[])[0] === "git")
        return { exitCode: 0, stdout: paths.join("\0") + "\0", stderr: "" };
      probes++;
      return { exitCode: 127, stdout: "", stderr: "not found" };
    }
    if (method === "fs/readFile") {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return encoded("hello");
    }
    throw Error("unexpected directory enumeration");
  });
  const result = await searchWorkspaceContent(rpc, "/project", "hello");
  expect(probes).toBe(1);
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(8);
  expect(result.matches).toHaveLength(70);
});

test("result limit stops subsequent grep batches", async () => {
  const paths = Array.from({ length: 130 }, (_, i) => `file-${i}.txt`);
  let probes = 0;
  const rpc = client((method, params) => {
    if (method !== "command/exec") throw Error("unexpected RPC");
    if ((params.command as string[])[0] === "git")
      return { exitCode: 0, stdout: paths.join("\0") + "\0", stderr: "" };
    probes++;
    return {
      exitCode: 0,
      stdout: "./file-0.txt\0" + "1:hello\n./file-0.txt\0" + "2:hello\n",
      stderr: "",
    };
  });
  const result = await searchWorkspaceContent(rpc, "/project", "hello", {
    maxResults: 1,
  });
  expect(result.matches).toHaveLength(1);
  expect(result.truncated).toBe(true);
  expect(probes).toBe(1);
});
