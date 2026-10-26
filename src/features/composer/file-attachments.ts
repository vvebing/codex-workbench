import type { CodexClient } from "../../lib/rpc";
import { workspacePath } from "../shell/project-files";

export const PROJECT_FILE_DRAG_TYPE = "application/x-codex-workbench-file";
export const ATTACHMENT_DIRECTORY = ".codex-workbench/attachments";
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export function attachmentPath(cwd: string, name: string, id: string) {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    /[\\/:]/.test(name) ||
    Array.from(name).some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error("附件文件名无效。");
  return workspacePath(cwd, `${ATTACHMENT_DIRECTORY}/${id}/${name}`);
}

export function projectFileDrop(raw: string, cwd: string) {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("文件引用无效。");
  const item = value as Record<string, unknown>;
  if (item.cwd !== cwd || typeof item.relative !== "string")
    throw new Error("只能拖入当前项目的文件引用。");
  const path = workspacePath(cwd, item.relative);
  if (path !== item.path) throw new Error("文件引用路径无效。");
  return { path, relative: item.relative };
}

export async function saveAttachment(
  client: Pick<CodexClient, "request">,
  cwd: string,
  file: File,
  current: () => boolean,
) {
  if (file.size > MAX_ATTACHMENT_BYTES)
    throw new Error(`${file.name} 超过单个附件 5 MB 限制。`);
  const path = attachmentPath(cwd, file.name, crypto.randomUUID());
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}。`));
    reader.onabort = () => reject(new Error("附件读取已取消。"));
    reader.readAsDataURL(file);
  });
  if (!current()) throw new Error("连接或会话已变化，请重新添加附件。");
  await client.request("fs/createDirectory", {
    path: path.slice(0, path.lastIndexOf("/")),
    recursive: true,
  });
  if (!current()) throw new Error("连接或会话已变化，请重新添加附件。");
  await client.request("fs/writeFile", { path, dataBase64 });
  return path;
}
