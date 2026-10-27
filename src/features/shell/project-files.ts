import { t } from "../../lib/i18n";
import { MAX_FILE_BYTES, formatFileSize } from "../files/file-limits";
import type { JSONContent } from "@tiptap/core";
import type { DraftsStore } from "../composer/drafts";
import { textDocument } from "../composer/editor-document";

export const MAX_PREVIEW_BYTES = MAX_FILE_BYTES;

export function workspacePath(root: string, relative: string): string {
  const parts = relative.replace(/\\/g, "/").split("/");
  if (
    parts.some((part) => !part || part === "." || part === "..") ||
    relative.startsWith("/") ||
    /^[a-z]:[\\/]/i.test(relative) ||
    (/^[a-z]:[\\/]/i.test(root) && parts.some((part) => part.includes(":")))
  )
    throw new Error(t("无效的项目路径。"));
  return `${root.replace(/[\\/]$/, "")}/${parts.join("/")}`;
}

export function previewText(
  base64: string,
  rawByteLimit = MAX_PREVIEW_BYTES,
): string {
  const limit = Math.min(rawByteLimit, MAX_FILE_BYTES);
  const oversized = () =>
    new Error(
      t("文件超过 {{value0}}，无法在面板中预览。可以引用到输入框。", {
        value0: formatFileSize(limit),
      }),
    );
  if (
    !Number.isSafeInteger(limit) ||
    limit < 0 ||
    base64.length > Math.ceil(limit / 3) * 4
  )
    throw oversized();
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  if (bytes.length > limit) throw oversized();
  if (bytes.includes(0)) throw new Error(t("二进制文件不支持文本预览。"));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(t("该文件不是 UTF-8 文本，无法预览。"));
  }
}

export function referenceProjectFile(
  drafts: DraftsStore,
  threadId: string,
  relative: string,
  absolute: string,
): void {
  const draft = drafts.get(threadId);
  const document = structuredClone(draft.document ?? textDocument(draft.text));
  const value = /\s/.test(absolute) ? JSON.stringify(absolute) : absolute;
  const paragraph: JSONContent = {
    type: "paragraph",
    content: [
      {
        type: "reference",
        attrs: {
          kind: "file",
          label: relative,
          name: relative,
          path: absolute,
          value,
        },
      },
      { type: "text", text: " " },
    ],
  };
  if (
    !draft.text &&
    document.content?.length === 1 &&
    !document.content[0].content?.length
  )
    document.content = [paragraph];
  else document.content = [...(document.content ?? []), paragraph];
  drafts.setDocument(
    threadId,
    document,
    `${draft.text}${draft.text ? "\n" : ""}${value} `,
    draft.skills ?? [],
  );
}
