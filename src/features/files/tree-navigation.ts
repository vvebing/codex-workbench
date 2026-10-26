import { absoluteFilePath } from "./store";

/** Return a project-relative file only when it is strictly inside this root. */
export function relativeWorkspaceFile(
  cwd: string,
  path: string,
): string | undefined {
  try {
    const root = absoluteFilePath(cwd).replace(/\/$/, "");
    const file = absoluteFilePath(path, cwd);
    const windows = /^[a-z]:\//i.test(root);
    const comparableRoot = windows ? root.toLowerCase() : root;
    const comparableFile = windows ? file.toLowerCase() : file;
    return comparableFile.startsWith(`${comparableRoot}/`)
      ? file.slice(root.length + 1) || undefined
      : undefined;
  } catch {
    return undefined;
  }
}
