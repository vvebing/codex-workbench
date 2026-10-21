/** Translate a lexical workspace path through Git's physically resolved cwd prefix. */
export function gitWorkspacePath(
  root: string | undefined,
  cwd: string | undefined,
  prefix: string | undefined,
  path: string | undefined,
): string | undefined {
  if (!root || !path) return;
  const normalize = (value: string) =>
    value.replace(/\\/g, "/").replace(/\/$/, "");
  const physicalRoot = normalize(root);
  const target = normalize(path);
  if (target.startsWith(`${physicalRoot}/`))
    return target.slice(physicalRoot.length + 1);
  if (cwd && prefix !== undefined) {
    const directory = normalize(cwd);
    if (target.startsWith(`${directory}/`))
      return `${prefix}${target.slice(directory.length + 1)}`;
  }
}
