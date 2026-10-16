import { ReferenceNode } from "../../src/features/composer/reference-node";
import { expect, test } from "vitest";
import { getSchema } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import { DraftsStore } from "../../src/features/composer/drafts";
import { draftInput } from "../../src/features/composer/submission";
import {
  documentText,
  documentSkills,
  textDocument,
} from "../../src/features/composer/editor-document";

const schema = getSchema([Document, Paragraph, Text, HardBreak, ReferenceNode]);

test("inserting an app preserves structured references, skills and images and sends real mention metadata", () => {
  const drafts = new DraftsStore();
  const original = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "请用 " },
          {
            type: "reference",
            attrs: {
              kind: "skill",
              label: "review",
              name: "review",
              path: "/skill/review",
              value: "$review",
            },
          },
          { type: "hardBreak" },
          {
            type: "reference",
            attrs: {
              kind: "file",
              label: "a.ts",
              name: "a.ts",
              path: "/a.ts",
              value: "/a.ts",
            },
          },
        ],
      },
    ],
  };
  const doc = schema.nodeFromJSON(original);
  drafts.setDocument("a", original, documentText(doc), documentSkills(doc));
  drafts.addImage("a", {
    id: "image",
    name: "test.png",
    url: "data:image/png;base64,AA==",
  });
  drafts.addApp("a", { id: "connector_test", name: "测试应用" });
  const draft = drafts.get("a");
  expect(draft.document?.content?.[0]).toEqual(original.content[0]);
  expect(documentText(schema.nodeFromJSON(draft.document!))).toBe(draft.text);
  expect(draftInput(draft)).toEqual([
    {
      type: "text",
      text: "请用 $review\n/a.ts\n@app://connector_test ",
      text_elements: [],
    },
    { type: "skill", name: "review", path: "/skill/review" },
    { type: "mention", name: "测试应用", path: "app://connector_test" },
    { type: "image", url: "data:image/png;base64,AA==" },
  ]);
  const revision = draft.revision;
  drafts.addApp("a", { id: "connector_test", name: "测试应用" });
  expect(drafts.get("a").revision).toBe(revision);
  expect(drafts.get("b").text).toBe("");
});

test("sent app mentions restore as editable atoms and removal removes their metadata", () => {
  const drafts = new DraftsStore();
  drafts.restoreMessage("a", [
    {
      type: "text",
      text: "检查 @app://connector_test 的文档",
      text_elements: [],
    },
    { type: "mention", name: "应用", path: "app://connector_test" },
  ]);
  const draft = drafts.get("a");
  expect(
    draft.document?.content?.[0].content?.find(
      (node) => node.type === "reference",
    )?.attrs,
  ).toMatchObject({ kind: "app", label: "应用", path: "app://connector_test" });
  expect(draftInput(draft)).toContainEqual({
    type: "mention",
    name: "应用",
    path: "app://connector_test",
  });
  drafts.setDocument("a", textDocument("检查文档"), "检查文档", []);
  expect(draftInput(drafts.get("a"))).toEqual([
    { type: "text", text: "检查文档", text_elements: [] },
  ]);
});

test("typed app-looking text never implicitly enables an app and empty drafts accept app atoms", () => {
  const drafts = new DraftsStore();
  drafts.setText("literal", "@app://connector_test");
  expect(draftInput(drafts.get("literal"))).toEqual([
    { type: "text", text: "@app://connector_test", text_elements: [] },
  ]);
  drafts.addApp("empty", { id: "connector_test", name: "应用" });
  const draft = drafts.get("empty");
  expect(documentText(schema.nodeFromJSON(draft.document!))).toBe(draft.text);
  expect(draft.document?.content).toHaveLength(1);
  expect(draftInput(draft)).toContainEqual({
    type: "mention",
    name: "应用",
    path: "app://connector_test",
  });
});
