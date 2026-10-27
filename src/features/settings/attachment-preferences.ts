import { t } from "../../lib/i18n";

export const DEFAULT_ATTACHMENT_DIRECTORY = "~/.codex-workbench/attachments";

/** Paths are filesystem values, never shell expressions. */
export function normalizeAttachmentDirectory(input: string): string {
  let path = input.trim() || DEFAULT_ATTACHMENT_DIRECTORY;
  if (
    path.length > 4096 ||
    Array.from(path).some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error(t("附件保存路径无效，请填写 ~/ 开头的路径或绝对路径。"));
  const windows = /^[a-z]:[\\/]/i.test(path) || /^\\\\[^\\]/.test(path);
  if (windows || path.startsWith("~\\")) path = path.replace(/\\/g, "/");
  if (!(
    path === "~" ||
    path.startsWith("~/") ||
    path.startsWith("/") ||
    /^[a-z]:\//i.test(path)
  ))
    throw new Error(t("附件保存路径无效，请填写 ~/ 开头的路径或绝对路径。"));
  if (path.split("/").some((part) => part === "." || part === ".."))
    throw new Error(t("附件保存路径不能包含 . 或 .. 路径段。"));
  const prefix = path.startsWith("//") ? "//" : "";
  path = prefix + path.slice(prefix.length).replace(/\/{2,}/g, "/");
  return /^[a-z]:\/$/i.test(path) ? path : path.replace(/\/+$/, "") || "/";
}
