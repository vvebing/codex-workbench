import type { CodexClient } from "../../lib/rpc";
import type { CommandExecParams } from "../../generated/v2/CommandExecParams";
import type { CommandExecResponse } from "../../generated/v2/CommandExecResponse";

export interface GitStatus {
  branch: string;
  changedFiles: number;
}

export type GitGroup = "staged" | "unstaged" | "untracked" | "conflict";
export type GitFileStatus = "M" | "A" | "D" | "R" | "C" | "T" | "U" | "?" | ".";
export interface GitFile {
  indexStatus?: GitFileStatus;
  worktreeStatus?: GitFileStatus;
  path: string;
  originalPath?: string;
  groups: GitGroup[];
}
export interface WorkspaceGitStatus extends GitStatus {
  repoRoot?: string;
  files: GitFile[];
}

/** Parse paths from NUL records so whitespace and rename sources remain intact. */
export function parseWorkspaceGitStatus(output: string): WorkspaceGitStatus {
  if (!output.endsWith("\0")) throw new Error("Incomplete Git status output.");
  const records = output.slice(0, -1).split("\0");
  let branch: string | undefined;
  const files: GitFile[] = [];
  const pathOf = (record: string, fields: number) => {
    let offset = 0;
    for (let field = 0; field < fields; field++) {
      const next = record.indexOf(" ", offset);
      if (next < offset || next === offset) return "";
      offset = next + 1;
    }
    return record.slice(offset);
  };
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record.startsWith("# branch.head ")) {
      const head = record.slice("# branch.head ".length);
      if (!head || /[\s\0]/.test(head))
        throw new Error("Invalid Git branch header.");
      branch = head === "(detached)" ? "HEAD" : head;
    } else if (record.startsWith("# ")) {
      continue; // Porcelain v2 allows additional headers.
    } else if (record.startsWith("1 ") && pathOf(record, 8)) {
      files.push({
        path: pathOf(record, 8),
        ...statusesOf(record),
        groups: groupsOf(record),
      });
    } else if (record.startsWith("2 ") && pathOf(record, 9)) {
      if (!records[++index]) throw new Error("Incomplete Git rename record.");
      files.push({
        path: pathOf(record, 9),
        originalPath: records[index],
        ...statusesOf(record),
        groups: groupsOf(record),
      });
    } else if (record.startsWith("u ") && pathOf(record, 10)) {
      files.push({
        path: pathOf(record, 10),
        ...statusesOf(record),
        groups: ["conflict"],
      });
    } else if (record.startsWith("? ") && record.length > 2) {
      files.push({
        path: record.slice(2),
        indexStatus: "?",
        worktreeStatus: "?",
        groups: ["untracked"],
      });
    } else if (record.startsWith("! ") && record.length > 2) {
      continue;
    } else {
      throw new Error("Invalid Git status record.");
    }
  }
  if (!branch) throw new Error("Git branch header is unavailable.");
  return { branch, changedFiles: files.length, files };
}

function statusesOf(
  record: string,
): Pick<GitFile, "indexStatus" | "worktreeStatus"> {
  const xy = record.split(" ")[1];
  if (!/^[.MADRCTU]{2}$/.test(xy)) throw new Error("Invalid Git file status.");
  return {
    indexStatus: xy[0] as GitFileStatus,
    worktreeStatus: xy[1] as GitFileStatus,
  };
}
function groupsOf(record: string): GitGroup[] {
  const xy = record.split(" ")[1];
  const groups: GitGroup[] = [];
  if (xy[0] !== ".") groups.push("staged");
  if (xy[1] !== ".") groups.push("unstaged");
  return groups;
}
export function parseGitStatus(output: string): GitStatus {
  const { branch, changedFiles } = parseWorkspaceGitStatus(output);
  return { branch, changedFiles };
}

export function gitStatusCommand(cwd: string): CommandExecParams {
  return {
    command: [
      "git",
      "--no-optional-locks",
      "status",
      "--porcelain=v2",
      "--branch",
      "-z",
      "--untracked-files=all",
    ],
    cwd,
    sandboxPolicy: { type: "readOnly", networkAccess: false },
    timeoutMs: 5000,
    disableOutputCap: true,
  };
}

// Keep commands on one client sequential while workspace changes discard old results.
const commands = new WeakMap<Pick<CodexClient, "request">, Promise<void>>();

export function readGitStatus(
  client: Pick<CodexClient, "request">,
  cwd: string,
  current: () => boolean = () => true,
): Promise<GitStatus | null> {
  const command = (commands.get(client) ?? Promise.resolve()).then(async () => {
    if (!current()) return null;
    const result = await client.request<CommandExecResponse>(
      "command/exec",
      gitStatusCommand(cwd),
    );
    if (!current()) return null;
    if (result.exitCode !== 0) throw new Error("Git status unavailable.");
    return parseGitStatus(result.stdout);
  });
  commands.set(
    client,
    command.then(
      () => {},
      () => {},
    ),
  );
  return command;
}

export function gitDiffCommand(
  cwd: string,
  file: GitFile,
  group: GitGroup,
): CommandExecParams {
  return {
    command: [
      "git",
      "--no-optional-locks",
      "--literal-pathspecs",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      ...(group === "staged" ? ["--cached"] : []),
      ...(group === "untracked"
        ? ["--no-index", "--", "/dev/null", file.path]
        : ["--", file.path, ...(file.originalPath ? [file.originalPath] : [])]),
    ],
    cwd,
    sandboxPolicy: { type: "readOnly", networkAccess: false },
    timeoutMs: 5000,
    outputBytesCap: 200_000,
  };
}
