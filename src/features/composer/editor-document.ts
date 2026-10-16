import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface Reference {
  kind: "file" | "skill" | "app";
  label: string;
  value: string;
  name: string;
  path: string;
}

export function textDocument(text: string): JSONContent {
  return {
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
}

export function documentText(doc: ProseMirrorNode, to = doc.content.size) {
  return doc.textBetween(0, to, "\n", (node) =>
    node.type.name === "hardBreak" ? "\n" : node.attrs.value || "",
  );
}

export function documentSkills(doc: ProseMirrorNode) {
  const skills = new Map<string, { name: string; path: string }>();
  doc.descendants((node) => {
    if (node.type.name === "reference" && node.attrs.kind === "skill") {
      const { name, path } = node.attrs;
      skills.set(path, { name, path });
    }
  });
  return [...skills.values()];
}

/** Read app identity from atomic nodes, never infer it from typed display text. */
export function documentApps(
  document?: JSONContent,
): { name: string; path: string }[] {
  const apps = new Map<string, { name: string; path: string }>();
  const visit = (node: JSONContent) => {
    if (
      node.type === "reference" &&
      node.attrs?.kind === "app" &&
      typeof node.attrs.name === "string" &&
      typeof node.attrs.path === "string" &&
      node.attrs.path.startsWith("app://") &&
      node.attrs.path.length > 6
    ) {
      apps.set(node.attrs.path, {
        name: node.attrs.name,
        path: node.attrs.path,
      });
    }
    for (const child of node.content ?? []) visit(child);
  };
  if (document) visit(document);
  return [...apps.values()];
}
