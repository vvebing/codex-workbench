import type { CodexClient } from "../../lib/rpc";
import type { CommandExecResponse } from "../../generated/v2/CommandExecResponse";
import type { FsReadFileResponse } from "../../generated/v2/FsReadFileResponse";
import {
  gitStatusCommand,
  parseWorkspaceGitStatus,
  type GitGroup,
} from "../shell/git-status";

export interface GitComparisonRequest {
  cwd: string;
  path: string;
  group: GitGroup;
  threadId?: string;
}
export interface GitComparison {
  request: GitComparisonRequest;
  original: string;
  originalLabel: string;
  modifiedLabel: string;
  canOpen: boolean;
}
const LIMIT = 256 * 1024;
function text(value: string) {
  if (
    new TextEncoder().encode(value).length > LIMIT ||
    value.includes("\0") ||
    value.includes("\ufffd")
  )
    throw new Error("仅支持 256 KB 以内的 UTF-8 文本差异。");
  return value;
}
function safePath(path: string) {
  if (
    !path ||
    path.startsWith("/") ||
    path.split("/").some((p) => p === ".." || p === ".") ||
    [...path].some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error("Git 文件路径无效。");
  return path;
}
export async function readGitComparison(
  client: Pick<CodexClient, "request">,
  request: GitComparisonRequest,
  assertCurrent: () => void = () => {},
) {
  const exec = async (cwd: string, args: string[]) => {
    assertCurrent();
    const response = await client.request<CommandExecResponse>("command/exec", {
      command: ["git", "--no-optional-locks", ...args],
      cwd,
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      timeoutMs: 5000,
      disableOutputCap: true,
    });
    assertCurrent();
    if (response.exitCode !== 0)
      throw new Error("无法读取 Git 版本，请刷新状态后重试。");
    return response.stdout;
  };
  const output = await exec(request.cwd, ["rev-parse", "--show-toplevel"]);
  if (!output.endsWith("\n")) throw new Error("无法确定仓库根目录。");
  const root = output.slice(0, -1);
  const status = await client.request<CommandExecResponse>(
    "command/exec",
    gitStatusCommand(root),
  );
  assertCurrent();
  if (status.exitCode !== 0) throw new Error("无法读取 Git 状态。");
  const file = parseWorkspaceGitStatus(status.stdout).files.find(
    (f) => f.path === request.path && f.groups.includes(request.group),
  );
  if (!file)
    throw new Error("此文件的 Git 状态已改变，请刷新 Git 列表后重试。");
  if (request.group === "conflict")
    throw new Error("冲突文件尚不支持三方比较，请打开当前文件处理冲突。");
  const path = `${root.replace(/\/$/, "")}/${safePath(file.path)}`;
  const blob = async (spec: string) => {
    // Pin the object before reading so staging/committing cannot mix size and content.
    const oid = (await exec(root, ["rev-parse", "--verify", spec])).trim();
    if (!/^[a-f0-9]{40,64}$/.test(oid)) throw new Error("Git 对象无效。");
    const size = Number((await exec(root, ["cat-file", "-s", oid])).trim());
    if (!Number.isSafeInteger(size) || size < 0 || size > LIMIT)
      throw new Error("文件超过 256 KB，无法展示差异。");
    return text(await exec(root, ["cat-file", "blob", oid]));
  };
  const staged = request.group === "staged";
  const deleted = (staged ? file.indexStatus : file.worktreeStatus) === "D";
  const emptyOriginal = staged
    ? file.indexStatus === "A"
    : request.group === "untracked";
  const originalPath =
    staged && file.originalPath ? safePath(file.originalPath) : file.path;
  const original = emptyOriginal
    ? ""
    : await blob(staged ? `HEAD:${originalPath}` : `:${file.path}`);
  let modified = "";
  if (!deleted) {
    if (staged) modified = await blob(`:${file.path}`);
    else {
      const result = await client.request<FsReadFileResponse>("fs/readFile", {
        path,
      });
      assertCurrent();
      if (result.dataBase64.length > Math.ceil(LIMIT / 3) * 4)
        throw new Error("文件超过 256 KB，无法展示差异。");
      modified = text(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          Uint8Array.from(atob(result.dataBase64), (c) => c.charCodeAt(0)),
        ),
      );
    }
  }
  return {
    path,
    modified,
    comparison: {
      request,
      original,
      originalLabel: staged
        ? "HEAD"
        : request.group === "untracked"
          ? "空文件（未跟踪）"
          : "暂存区",
      modifiedLabel: staged ? "暂存区" : "磁盘文件",
      canOpen:
        file.worktreeStatus !== "D" && !(staged && file.indexStatus === "D"),
    } satisfies GitComparison,
  };
}
