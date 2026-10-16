import type { UserInput } from "../../generated/v2/UserInput";
import type { JSONContent } from "@tiptap/core";
import type { Draft } from "./drafts";
import { textDocument } from "./editor-document";
import { hasSkillToken } from "./completion-token";

/** Rebuild editable text, references and browser-readable images from a sent message. */
export function restoredMessage(
  content: UserInput[],
): Omit<Draft, "revision"> & { unavailableAttachments: boolean } {
  let text = content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
  const skills = content
    .filter((part) => part.type === "skill")
    .map(({ name, path }) => ({ name, path }));
  const references = new Map<string, JSONContent>();
  for (const part of content) {
    if (part.type !== "skill" && part.type !== "mention") continue;
    const token = part.type === "skill" ? `$${part.name}` : `@${part.path}`;
    if (
      part.type === "skill"
        ? !hasSkillToken(text, part.name)
        : !text.includes(token)
    )
      text += `${text ? "\n\n" : ""}${token}`;
    references.set(token, {
      type: "reference",
      attrs: {
        kind:
          part.type === "skill"
            ? "skill"
            : part.path.startsWith("app://")
              ? "app"
              : "file",
        label: part.name,
        value: token,
        name: part.name,
        path: part.path,
      },
    });
  }
  const document = textDocument(text);
  if (references.size) {
    const escape = (value: string) =>
      value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `(${[...references.keys()]
        .sort((a, b) => b.length - a.length)
        .map(escape)
        .join("|")})`,
      "g",
    );
    for (const paragraph of document.content || []) {
      paragraph.content = (paragraph.content || []).flatMap((node) =>
        (node.text || "")
          .split(pattern)
          .filter(Boolean)
          .map(
            (value) => references.get(value) || { type: "text", text: value },
          ),
      );
    }
  }
  const images = content.flatMap((part, index) =>
    part.type === "image" && "url" in part
      ? [
          {
            id: crypto.randomUUID(),
            name: `原消息图片 ${index + 1}`,
            url: part.url,
          },
        ]
      : [],
  );
  const unavailableAttachments = content.some(
    (part) =>
      part.type === "localImage" ||
      part.type === "localAudio" ||
      part.type === "audio" ||
      (part.type === "image" && !("url" in part)),
  );
  return { text, document, skills, images, unavailableAttachments };
}
