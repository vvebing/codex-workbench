import { getLocale, t } from "../../lib/i18n";
import type { GitFile, WorkspaceGitStatus } from "./git-status";

export type TreeGitDecoration = {
  badge: string;
  label: string;
  className: string;
  count: number;
};
const names: Record<string, string> = {
  get M() {
    return t("已修改");
  },
  get A() {
    return t("已添加");
  },
  get D() {
    return t("已删除");
  },
  get R() {
    return t("已重命名");
  },
  get C() {
    return t("已复制");
  },
  get T() {
    return t("类型已更改");
  },
  get U() {
    return t("存在冲突");
  },
  get "?"() {
    return t("未跟踪");
  },
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
    ? t("存在合并冲突")
    : [
        file.indexStatus && file.indexStatus !== "." && file.indexStatus !== "?"
          ? t("暂存区：{{value0}}", { value0: names[file.indexStatus] })
          : "",
        file.worktreeStatus && file.worktreeStatus !== "."
          ? t("工作区：{{value0}}", { value0: names[file.worktreeStatus] })
          : "",
      ]
        .filter(Boolean)
        .join(getLocale() === "zh-CN" ? "；" : "; ") ||
      names[badge] ||
      t("存在更改");
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
      label: t("子树有 {{value0}} 个更改文件{{value1}}", {
        value0: files.size,
        value1: conflict ? t("，存在合并冲突") : "",
      }),
      className: conflict ? "text-danger" : "text-warning",
    });
  }
  return result;
}
