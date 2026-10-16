import type { GitFile, WorkspaceGitStatus } from "./git-status";

export type TreeGitDecoration = {
  badge: string;
  label: string;
  className: string;
  count: number;
};
const names: Record<string, string> = {
  M: "已修改",
  A: "已添加",
  D: "已删除",
  R: "已重命名",
  C: "已复制",
  T: "类型已更改",
  U: "存在冲突",
  "?": "未跟踪",
};
const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/$/, "");
function fileDecoration(file: GitFile): TreeGitDecoration {
  const conflict = file.groups.includes("conflict");
  const codes = [
    ...new Set(
      [file.indexStatus, file.worktreeStatus].filter(
        (code) => code && code !== ".",
      ),
    ),
  ];
  const badge = conflict
    ? "U"
    : codes.join("") || (file.groups.includes("untracked") ? "?" : "M");
  const details = conflict
    ? "存在合并冲突"
    : [
        file.indexStatus && file.indexStatus !== "." && file.indexStatus !== "?"
          ? `暂存区：${names[file.indexStatus]}`
          : "",
        file.worktreeStatus && file.worktreeStatus !== "."
          ? `工作区：${names[file.worktreeStatus]}`
          : "",
      ]
        .filter(Boolean)
        .join("；") ||
      names[badge] ||
      "存在更改";
  return {
    badge,
    label: details,
    count: 1,
    className: conflict
      ? "text-danger"
      : badge.includes("D")
        ? "text-danger"
        : /[A?]/.test(badge)
          ? "text-success"
          : "text-warning",
  };
}
/** Git paths are repository-relative, while tree entries are relative to the session cwd. */
export function treeGitDecorations(
  status: WorkspaceGitStatus | undefined,
  cwd: string,
): Map<string, TreeGitDecoration> {
  const result = new Map<string, TreeGitDecoration>();
  if (!status?.repoRoot) return result;
  const root = normalize(status.repoRoot);
  const directory = normalize(cwd);
  if (directory !== root && !directory.startsWith(`${root}/`)) return result;
  const prefix =
    directory === root ? "" : `${directory.slice(root.length + 1)}/`;
  const folders = new Map<string, Map<string, GitFile>>();
  for (const file of status.files) {
    const paths = new Set([
      file.path,
      ...(file.originalPath ? [file.originalPath] : []),
    ]);
    for (const raw of paths) {
      const path = normalize(raw);
      if (!path.startsWith(prefix)) continue;
      const relative = path.slice(prefix.length);
      if (
        !relative ||
        relative.split("/").some((part) => part === ".." || part === ".")
      )
        continue;
      if (raw === file.path) result.set(relative, fileDecoration(file));
      const parts = relative.split("/");
      for (let i = 0; i < parts.length; i++) {
        const folder = parts.slice(0, i).join("/");
        if (!folders.has(folder)) folders.set(folder, new Map());
        folders.get(folder)!.set(file.path, file);
      }
    }
  }
  for (const [folder, files] of folders) {
    const conflict = [...files.values()].some((file) =>
      file.groups.includes("conflict"),
    );
    result.set(folder, {
      badge: conflict ? "U" : String(files.size),
      count: files.size,
      label: `子树有 ${files.size} 个更改文件${conflict ? "，存在合并冲突" : ""}`,
      className: conflict ? "text-danger" : "text-warning",
    });
  }
  return result;
}
