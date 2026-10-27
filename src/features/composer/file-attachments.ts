import { t } from "../../lib/i18n";
import type { CodexClient } from "../../lib/rpc";
import type { CommandExecResponse } from "../../generated/v2/CommandExecResponse";
import { workspacePath } from "../shell/project-files";
import { normalizeAttachmentDirectory } from "../settings/attachment-preferences";

export const PROJECT_FILE_DRAG_TYPE = "application/x-codex-workbench-file";
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export function attachmentPath(directory: string, name: string, id: string) {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    /[\\/:]/.test(name) ||
    Array.from(name).some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error(t("附件文件名无效。"));
  if (
    !/^(\/|[a-z]:[\\/])/i.test(directory) ||
    Array.from(directory).some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error(t("无法确定当前工作环境的用户主目录。"));
  const root =
    /^[a-z]:[\\/]/i.test(directory) || directory.startsWith("\\\\")
      ? directory.replace(/\\/g, "/")
      : directory;
  return workspacePath(root, `${id}/${name}`);
}

export async function resolveAttachmentDirectory(
  client: Pick<CodexClient, "request" | "platformFamily">,
  configured: string,
  current: () => boolean,
) {
  if (!current()) throw new Error(t("连接或会话已变化，请重新添加附件。"));
  const path = normalizeAttachmentDirectory(configured);
  if (path === "~" || path.startsWith("~/")) {
    const home = await resolveAttachmentHome(client, current);
    const root = /^[a-z]:[\\/]/i.test(home) ? home.replace(/\\/g, "/") : home;
    return path === "~" ? root : `${root.replace(/\/+$/, "")}/${path.slice(2)}`;
  }
  const windowsPath = /^[a-z]:\//i.test(path) || path.startsWith("//");
  if (
    (client.platformFamily === "windows" && !windowsPath) ||
    (client.platformFamily === "unix" && /^[a-z]:\//i.test(path))
  )
    throw new Error(t("附件保存路径与当前工作环境不兼容。"));
  return path;
}

/** Resolve on the app-server host; CODEX_HOME may point outside the user home. */
export async function resolveAttachmentHome(
  client: Pick<CodexClient, "request" | "platformFamily">,
  current: () => boolean,
) {
  if (!current()) throw new Error(t("连接或会话已变化，请重新添加附件。"));
  const response = await client.request<CommandExecResponse>("command/exec", {
    command:
      client.platformFamily === "windows"
        ? [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Console]::Out.Write([Environment]::GetFolderPath('UserProfile'))",
          ]
        : ["sh", "-c", 'test -n "$HOME" && printf \'%s\' "$HOME"'],
    timeoutMs: 5000,
    outputBytesCap: 16 * 1024,
    sandboxPolicy: { type: "readOnly", networkAccess: false },
  });
  if (!current()) throw new Error(t("连接或会话已变化，请重新添加附件。"));
  if (response.exitCode !== 0)
    throw new Error(t("无法确定当前工作环境的用户主目录。"));
  const home = response.stdout;
  attachmentPath(home, "validate", "validate");
  return home;
}

export function projectFileDrop(raw: string, cwd: string) {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error(t("文件引用无效。"));
  const item = value as Record<string, unknown>;
  if (item.cwd !== cwd || typeof item.relative !== "string")
    throw new Error(t("只能拖入当前项目的文件引用。"));
  const path = workspacePath(cwd, item.relative);
  if (path !== item.path) throw new Error(t("文件引用路径无效。"));
  return { path, relative: item.relative };
}

export async function saveAttachment(
  client: Pick<CodexClient, "request">,
  directory: string,
  file: File,
  current: () => boolean,
  encoded?: string,
) {
  if (file.size > MAX_ATTACHMENT_BYTES)
    throw new Error(
      t("{{value0}} 超过单个附件 5 MB 限制。", { value0: file.name }),
    );
  const path = attachmentPath(
    directory,
    file.name || "attachment",
    crypto.randomUUID(),
  );
  const dataBase64 =
    encoded ??
    (await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () =>
        reject(new Error(t("无法读取 {{value0}}。", { value0: file.name })));
      reader.onabort = () => reject(new Error(t("附件读取已取消。")));
      reader.readAsDataURL(file);
    }));
  if (!current()) throw new Error(t("连接或会话已变化，请重新添加附件。"));
  await client.request("fs/createDirectory", {
    path: path.slice(0, path.lastIndexOf("/")),
    recursive: true,
  });
  if (!current()) throw new Error(t("连接或会话已变化，请重新添加附件。"));
  await client.request("fs/writeFile", { path, dataBase64 });
  if (!current()) throw new Error(t("连接或会话已变化，请重新添加附件。"));
  return path;
}
