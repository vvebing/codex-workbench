export function absolutePath(path: string): boolean {
  return (
    path.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    /^\\\\[^\\]+\\[^\\]+/.test(path)
  );
}
export function separator(path: string): string {
  return path.includes("\\") ? "\\" : "/";
}
export function joinDirectory(path: string, name: string): string {
  return path.replace(/[\\/]+$/, "") + separator(path) + name;
}
export function parentDirectory(path: string): string {
  const sep = separator(path),
    trimmed = path.replace(/[\\/]+$/, "");
  if (/^[A-Za-z]:$/.test(trimmed)) return trimmed + sep;
  if (
    trimmed.startsWith("\\\\") &&
    trimmed.split(sep).filter(Boolean).length <= 2
  )
    return trimmed + sep;
  const index = trimmed.lastIndexOf(sep);
  return index < 0 ? path : trimmed.slice(0, index + 1) || sep;
}
export function completionDirectory(
  path: string,
): { parent: string; prefix: string } | null {
  if (!absolutePath(path)) return null;
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return { parent: path.slice(0, index + 1), prefix: path.slice(index + 1) };
}
