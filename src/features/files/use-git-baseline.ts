import { useEffect, useRef, useState } from "react";
import { useRuntime } from "../../lib/runtime-context";
import { useStore } from "../../components/hooks";
import { useWorkspaceGitStatus } from "../shell/workspace-git";
import type { CommandExecResponse } from "../../generated/v2/CommandExecResponse";
import { gitWorkspacePath } from "../shell/git-workspace-path";
import type { FileDocument } from "./store";

/** Read index objects only on Git refresh, never on keystrokes. */
export function useGitBaseline(document: FileDocument | undefined) {
  const { connection } = useRuntime();
  const { epoch, scope } = useStore(connection);
  const git = useWorkspaceGitStatus(
    !document || document.gitComparison || document.readonly
      ? ""
      : (document.cwd ?? ""),
  );
  const [result, setResult] = useState<{
    key: string;
    text?: string;
    error?: string;
  }>();
  const cache = useRef(new Map<string, string>());
  const path = document?.path;
  const key = JSON.stringify([epoch, scope, document?.id]);
  const root = git.value?.repoRoot;
  const enabled = !!document && !document.gitComparison && !document.readonly;
  const relativePath = gitWorkspacePath(
    root,
    document?.cwd,
    git.workspacePrefix,
    path,
  );
  const indexSignature = relativePath
    ? (git.indexSignatures?.[relativePath] ?? "tracked")
    : undefined;
  const untracked = indexSignature === "untracked";
  useEffect(() => {
    let stopped = false;
    const valid = () =>
      !stopped &&
      connection.getSnapshot().epoch === epoch &&
      connection.getSnapshot().scope === scope &&
      connection.getSnapshot().status === "connected";
    if (!enabled || !git.connected || !root || !relativePath) return;
    const relative = relativePath;
    const exec = async (args: string[]) => {
      if (!valid()) throw new Error("连接已变化");
      const response = await connection.client.request<CommandExecResponse>(
        "command/exec",
        {
          command: [
            "git",
            "--no-optional-locks",
            "--literal-pathspecs",
            ...args,
          ],
          cwd: root,
          sandboxPolicy: { type: "readOnly", networkAccess: false },
          timeoutMs: 5000,
          disableOutputCap: true,
        },
      );
      if (!valid() || response.exitCode !== 0)
        throw new Error("Git 行标记暂不可用");
      return response.stdout;
    };
    void (async () => {
      const listing = await exec(["ls-files", "--stage", "-z", "--", relative]);
      if (!listing) {
        if (valid()) setResult({ key, text: untracked ? "" : undefined });
        return;
      }
      const records = listing.split("\0").filter(Boolean);
      const match = /^(\d+) ([a-f0-9]{40,64}) 0\t/.exec(records[0]);
      if (records.length !== 1 || !match || match[1] === "160000")
        throw new Error("冲突或子模块暂不显示 Git 行标记");
      const oid = match[2];
      const cacheKey = JSON.stringify([epoch, scope, oid]);
      let text = cache.current.get(cacheKey);
      if (text === undefined) {
        const size = Number((await exec(["cat-file", "-s", oid])).trim());
        if (!Number.isSafeInteger(size) || size < 0 || size > 256 * 1024)
          throw new Error("Git 基线超过 256 KB");
        text = await exec(["cat-file", "blob", oid]);
        if (
          text.includes("\0") ||
          text.includes("\ufffd") ||
          new TextEncoder().encode(text).length > 256 * 1024
        )
          throw new Error("Git 基线不是可预览的 UTF-8 文本");
        if (cache.current.size >= 16) cache.current.clear();
        cache.current.set(cacheKey, text);
      }
      if (valid()) setResult({ key, text });
    })().catch((error: unknown) => {
      if (valid()) setResult({ key, error: String(error) });
    });
    return () => {
      stopped = true;
    };
  }, [
    connection,
    enabled,
    epoch,
    scope,
    git.connected,
    indexSignature,
    git.head,
    untracked,
    root,
    relativePath,
    path,
    key,
  ]);
  return enabled && git.connected && root && result?.key === key
    ? result
    : undefined;
}
