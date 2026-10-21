import { expect, it } from "vitest";
import { DraftsStore } from "../../src/features/composer/drafts";
import { insertReference } from "../../src/features/conversation/insert-reference";
it("appends a reference while preserving rich mentions, skills, images and draft text", () => {
  const drafts = new DraftsStore();
  const mention = {
    type: "reference",
    attrs: {
      kind: "skill",
      name: "existing",
      path: "/skill",
      value: "$existing",
    },
  };
  drafts.setDocument(
    "t",
    { type: "doc", content: [{ type: "paragraph", content: [mention] }] },
    "$existing",
    [{ name: "existing", path: "/skill" }],
  );
  drafts.addImage("t", {
    id: "img",
    name: "image",
    url: "data:image/png;base64,AA",
  });
  insertReference(drafts, "t", "协议", "/docs/protocol.md");
  const draft = drafts.get("t");
  expect(draft.document?.content?.[0].content?.[0]).toEqual(mention);
  expect(draft.text).toBe("$existing\n参考资料：协议\n/docs/protocol.md");
  expect(draft.skills).toEqual([{ name: "existing", path: "/skill" }]);
  expect(draft.images[0].id).toBe("img");
  expect(drafts.get("other").text).toBe("");
});
