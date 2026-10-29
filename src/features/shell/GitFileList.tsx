import { t, useLocale } from "../../lib/i18n";
import { Fragment, useMemo, type ReactNode } from "react";
import { ChevronRight, Folder } from "lucide-react";
import type { GitFile } from "./git-status";

interface Directory {
  name: string;
  path: string;
  descendants: GitFile[];
  directories: Map<string, Directory>;
  files: GitFile[];
}

function buildTree(files: GitFile[]): Directory {
  const root: Directory = {
    name: "",
    path: "",
    descendants: [],
    directories: new Map(),
    files: [],
  };
  for (const file of files) {
    const parts = file.path.split("/");
    let directory = root;
    directory.descendants.push(file);
    for (const name of parts.slice(0, -1)) {
      if (!directory.directories.has(name)) {
        directory.directories.set(name, {
          name,
          path: directory.path ? `${directory.path}/${name}` : name,
          descendants: [],
          directories: new Map(),
          files: [],
        });
      }
      directory = directory.directories.get(name)!;
      directory.descendants.push(file);
    }
    directory.files.push(file);
  }
  return root;
}

export function GitFileList({
  files,
  treeView,
  renderFile,
  directoryOpen,
  directoryKey,
  onDirectoryChange,
}: {
  files: GitFile[];
  treeView: boolean;
  renderFile: (file: GitFile) => ReactNode;
  directoryOpen: Record<string, boolean>;
  directoryKey: string;
  onDirectoryChange: (key: string, open: boolean) => void;
}) {
  const i18nLocale = useLocale();
  void i18nLocale;

  const tree = useMemo(
    () => (void i18nLocale, buildTree(files)),
    [files, i18nLocale],
  );
  const renderDirectory = (directory: Directory): ReactNode => (
    <ul>
      {[...directory.directories.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((child) => (
          <li key={child.path}>
            <details
              className="git-folder"
              open={directoryOpen[`${directoryKey}:${child.path}`] ?? true}
            >
              <summary
                onClick={(event) => {
                  event.preventDefault();
                  const key = `${directoryKey}:${child.path}`;
                  onDirectoryChange(key, !(directoryOpen[key] ?? true));
                }}
                title={child.path}
                aria-label={t("目录 {{value0}}，{{value1}} 个更改文件", {
                  value0: child.path,
                  value1: child.descendants.length,
                })}
              >
                <ChevronRight size={12} className="git-folder-chevron" />
                <Folder size={14} className="text-muted" />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {child.name}
                </span>
                <span className="git-folder-count">
                  {child.descendants.length}
                </span>
              </summary>
              {renderDirectory(child)}
            </details>
          </li>
        ))}
      {[...directory.files]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((file) => (
          <Fragment key={file.path}>{renderFile(file)}</Fragment>
        ))}
    </ul>
  );
  return treeView ? (
    <div className="git-tree">{renderDirectory(tree)}</div>
  ) : (
    <ul>
      {files.map((file) => (
        <Fragment key={file.path}>{renderFile(file)}</Fragment>
      ))}
    </ul>
  );
}
