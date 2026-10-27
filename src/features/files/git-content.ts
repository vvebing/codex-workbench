import { t } from "../../lib/i18n";
import type { CodexClient } from "../../lib/rpc";
import type { CommandExecResponse } from "../../generated/v2/CommandExecResponse";
import {
  DEFAULT_FILE_LIMITS,
  normalizeFileLimits,
  formatFileSize,
  type FileLimits,
} from "./file-limits";
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
type GitClient = Pick<CodexClient, "request"> &
  Partial<Pick<CodexClient, "onNotification">>;
const SAFE_BUFFERED_BYTES = 2 * 1024 * 1024;
function tooLarge(limit: number) {
  return new Error(
    t("Git 差异的每个版本最多 {{size}}。", { size: formatFileSize(limit) }),
  );
}
function text(value: string, limit: number) {
  if (new TextEncoder().encode(value).length > limit) throw tooLarge(limit);
  if (value.includes("\0")) throw new Error(t("仅支持 UTF-8 文本差异。"));
  return value;
}
/** Stream raw bytes so JSON escaping cannot exceed the bridge message limit. */
export async function readGitBlob(
  client: GitClient,
  cwd: string,
  oid: string,
  size: number,
  limit: number,
  assertCurrent: () => void,
) {
  const processId = `git-diff-${crypto.randomUUID()}`;
  let terminated = false;
  const terminate = () => {
    if (terminated) return;
    terminated = true;
    void client
      .request("command/exec/terminate", { processId })
      .catch(() => {});
  };
  let failure: unknown;
  let byteCount = 0;
  const chunks: string[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const streaming = !!client.onNotification;
  if (!streaming && size > SAFE_BUFFERED_BYTES)
    throw new Error(t("当前连接不支持大文件差异流式读取。"));
  const unsubscribe = client.onNotification?.((notification) => {
    if (
      notification.method !== "command/exec/outputDelta" ||
      notification.params.processId !== processId ||
      failure
    )
      return;
    try {
      assertCurrent();
      const { deltaBase64, stream, capReached } = notification.params;
      if (capReached) throw new Error(t("Git 差异输出不完整，请重新加载。"));
      if (stream !== "stdout") return;
      if (deltaBase64.length > Math.ceil((limit - byteCount) / 3) * 4 + 4)
        throw tooLarge(limit);
      const bytes = Uint8Array.from(atob(deltaBase64), (character) =>
        character.charCodeAt(0),
      );
      byteCount += bytes.byteLength;
      if (byteCount > limit) throw tooLarge(limit);
      if (byteCount > size)
        throw new Error(t("Git 差异输出不完整，请重新加载。"));
      try {
        chunks.push(decoder.decode(bytes, { stream: true }));
      } catch {
        throw new Error(t("仅支持 UTF-8 文本差异。"));
      }
    } catch (error) {
      failure = error;
      terminate();
    }
  });
  try {
    assertCurrent();
    const response = await client.request<CommandExecResponse>("command/exec", {
      command: ["git", "--no-optional-locks", "cat-file", "blob", oid],
      cwd,
      processId,
      streamStdoutStderr: streaming,
      outputBytesCap: limit + 1,
      timeoutMs: 5000,
      sandboxPolicy: { type: "readOnly", networkAccess: false },
    });
    assertCurrent();
    if (failure) throw failure;
    if (response.exitCode !== 0)
      throw new Error(t("无法读取 Git 版本，请刷新状态后重试。"));
    if (!streaming) {
      // Buffered strings cannot distinguish decoder replacement from literal U+FFFD.
      if (response.stdout.includes("\ufffd"))
        throw new Error(t("仅支持 UTF-8 文本差异。"));
      byteCount = new TextEncoder().encode(response.stdout).length;
      chunks.push(response.stdout);
    } else {
      if (response.stdout)
        throw new Error(t("Git 差异输出不完整，请重新加载。"));
      try {
        chunks.push(decoder.decode());
      } catch {
        throw new Error(t("仅支持 UTF-8 文本差异。"));
      }
    }
    if (byteCount !== size)
      throw new Error(t("Git 差异输出不完整，请重新加载。"));
    return text(chunks.join(""), limit);
  } catch (error) {
    terminate();
    throw failure ?? error;
  } finally {
    unsubscribe?.();
  }
}
function safePath(path: string) {
  if (
    !path ||
    path.startsWith("/") ||
    path.split("/").some((p) => p === ".." || p === ".") ||
    [...path].some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error(t("Git 文件路径无效。"));
  return path;
}
export async function readGitComparison(
  client: GitClient,
  request: GitComparisonRequest,
  assertCurrent: () => void = () => {},
  limits: FileLimits = DEFAULT_FILE_LIMITS,
) {
  const limit = normalizeFileLimits(limits).diffBytes;
  const exec = async (cwd: string, args: string[]) => {
    assertCurrent();
    const response = await client.request<CommandExecResponse>("command/exec", {
      command: ["git", "--no-optional-locks", ...args],
      cwd,
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      timeoutMs: 5000,
      outputBytesCap: 64 * 1024,
    });
    assertCurrent();
    if (response.exitCode !== 0)
      throw new Error(t("无法读取 Git 版本，请刷新状态后重试。"));
    return response.stdout;
  };
  const output = await exec(request.cwd, ["rev-parse", "--show-toplevel"]);
  if (!output.endsWith("\n")) throw new Error(t("无法确定仓库根目录。"));
  const root = output.slice(0, -1);
  const status = await client.request<CommandExecResponse>(
    "command/exec",
    gitStatusCommand(root),
  );
  assertCurrent();
  if (status.exitCode !== 0) throw new Error(t("无法读取 Git 状态。"));
  const file = parseWorkspaceGitStatus(status.stdout).files.find(
    (f) => f.path === request.path && f.groups.includes(request.group),
  );
  if (!file)
    throw new Error(t("此文件的 Git 状态已改变，请刷新 Git 列表后重试。"));
  if (request.group === "conflict")
    throw new Error(t("冲突文件尚不支持三方比较，请打开当前文件处理冲突。"));
  const path = `${root.replace(/\/$/, "")}/${safePath(file.path)}`;
  const blob = async (spec: string) => {
    // Pin the object before reading so staging/committing cannot mix size and content.
    const oid = (await exec(root, ["rev-parse", "--verify", spec])).trim();
    if (!/^[a-f0-9]{40,64}$/.test(oid)) throw new Error(t("Git 对象无效。"));
    const size = Number((await exec(root, ["cat-file", "-s", oid])).trim());
    if (!Number.isSafeInteger(size) || size < 0 || size > limit)
      throw tooLarge(limit);
    return readGitBlob(client, root, oid, size, limit, assertCurrent);
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
      if (result.dataBase64.length > Math.ceil(limit / 3) * 4)
        throw tooLarge(limit);
      modified = text(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          Uint8Array.from(atob(result.dataBase64), (c) => c.charCodeAt(0)),
        ),
        limit,
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
          ? t("空文件（未跟踪）")
          : t("暂存区"),
      modifiedLabel: staged ? t("暂存区") : t("磁盘文件"),
      canOpen:
        file.worktreeStatus !== "D" && !(staged && file.indexStatus === "D"),
    } satisfies GitComparison,
  };
}
