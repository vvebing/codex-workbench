import { t } from "../../lib/i18n";
import type { CodexClient } from "../../lib/rpc";
import type { FsReadDirectoryResponse } from "../../generated/v2/FsReadDirectoryResponse";
import { workspacePath } from "../shell/project-files";

// Leave room for base64 and JSON within the bridge's 16 MB message limit.
export const MAX_TRANSFER_BYTES = 8 * 1024 * 1024;
export type ConflictChoice = "replace" | "keep" | "cancel";
export function transferName(name: string) {
  if (
    !name ||
    /[\\/\0]/.test(name) ||
    name === "." ||
    name === ".." ||
    name === ".git"
  )
    throw new Error(t("无效的文件名。"));
  return name;
}
export function availableName(name: string, occupied: Set<string>) {
  if (!occupied.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let index = 1; ; index++) {
    const candidate = `${stem} (${index})${extension}`;
    if (!occupied.has(candidate)) return candidate;
  }
}
export async function encodeFile(file: File) {
  if (file.size > MAX_TRANSFER_BYTES)
    throw new Error(
      t("{{value0}}：每个文件最多 8 MB。", { value0: file.name }),
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 32768)
    binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
  return btoa(binary);
}
export async function uploadProjectFile(
  client: Pick<CodexClient, "request">,
  cwd: string,
  directory: string,
  file: File,
  conflict: (path: string, directory: boolean) => Promise<ConflictChoice>,
  check: () => void,
) {
  let name = transferName(file.name);
  const dataBase64 = await encodeFile(file);
  check();
  const listing = await client.request<FsReadDirectoryResponse>(
    "fs/readDirectory",
    {
      path: directory ? workspacePath(cwd, directory) : cwd,
    },
  );
  check();
  const existing = listing.entries.find((entry) => entry.fileName === name);
  if (existing) {
    const choice = await conflict(
      directory ? `${directory}/${name}` : name,
      existing.isDirectory || !existing.isFile,
    );
    check();
    if (choice === "cancel") return;
    if (choice === "keep")
      name = availableName(
        name,
        new Set(listing.entries.map((entry) => entry.fileName)),
      );
    else if (!existing.isFile || existing.isDirectory)
      throw new Error(t("不能用文件替换目录或特殊文件。"));
  }
  const relative = directory ? `${directory}/${name}` : name;
  await client.request("fs/writeFile", {
    path: workspacePath(cwd, relative),
    dataBase64,
  });
  check();
  return relative;
}
export function saveDownload(dataBase64: string, name: string) {
  if (dataBase64.length > Math.ceil(MAX_TRANSFER_BYTES / 3) * 4)
    throw new Error(t("当前支持下载最多 8 MB 的文件。"));
  const bytes = Uint8Array.from(atob(dataBase64), (character) =>
    character.charCodeAt(0),
  );
  const url = URL.createObjectURL(new Blob([bytes]));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
