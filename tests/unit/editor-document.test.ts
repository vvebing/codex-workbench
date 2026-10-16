import { ReferenceNode } from "../../src/features/composer/reference-node";
import { expect, test } from "vitest";
import { getSchema } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import {
  documentText,
  documentSkills,
  textDocument,
} from "../../src/features/composer/editor-document";
import { DraftsStore } from "../../src/features/composer/drafts";

const schema = getSchema([Document, Paragraph, Text, HardBreak, ReferenceNode]);
const skill = {
  type: "reference",
  attrs: {
    kind: "skill",
    label: "review",
    name: "review",
    path: "/skills/review/SKILL.md",
    value: "$review",
  },
};

test("serializes file references with spaces, line breaks and distinct skill paths without display labels leaking", () => {
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "检查 " },
          {
            type: "reference",
            attrs: {
              kind: "file",
              label: "文件.ts",
              path: "/workspace/我的 文件.ts",
              value: '"/workspace/我的 文件.ts"',
            },
          },
          { type: "hardBreak" },
          skill,
          { type: "text", text: " " },
          skill,
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            ...skill,
            attrs: { ...skill.attrs, path: "/other/review/SKILL.md" },
          },
        ],
      },
    ],
  });
  expect(documentText(doc)).toBe(
    '检查 "/workspace/我的 文件.ts"\n$review $review\n$review',
  );
  expect(documentSkills(doc)).toEqual([
    { name: "review", path: "/skills/review/SKILL.md" },
    { name: "review", path: "/other/review/SKILL.md" },
  ]);
});

test("literal mentions stay text and newlines round-trip without adding skill metadata", () => {
  const text = "\n$review\n@file\n\n";
  const doc = schema.nodeFromJSON(textDocument(text));
  expect(documentText(doc)).toBe(text);
  expect(documentSkills(doc)).toEqual([]);
});

test("structured drafts preserve attachment changes and isolation, remove skills and clear the document only at the sent revision", () => {
  const drafts = new DraftsStore();
  drafts.activateScope("local");
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [{ type: "paragraph", content: [skill] }],
  });
  drafts.setDocument("a", doc.toJSON(), documentText(doc), documentSkills(doc));
  const sentRevision = drafts.get("a").revision;
  drafts.addImage("a", {
    id: "image",
    name: "test.png",
    url: "data:image/png;base64,AA==",
  });
  expect(drafts.clearIfRevision("a", sentRevision)).toBe(false);
  expect(drafts.get("a").document).toEqual(doc.toJSON());
  drafts.activateScope("remote");
  expect(drafts.get("a").document).toBeUndefined();
  drafts.activateScope("local");
  expect(drafts.get("a").skills).toHaveLength(1);
  drafts.setDocument("a", textDocument("检查"), "检查", []);
  expect(drafts.get("a").skills).toEqual([]);
  drafts.clearIfRevision("a", drafts.get("a").revision);
  expect(drafts.get("a").document).toBeUndefined();
  expect(drafts.get("a").images).toEqual([]);
});
