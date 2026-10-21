import type { DraftsStore } from "../composer/drafts";
import { textDocument } from "../composer/editor-document";

/** Append a plain reference without rebuilding existing structured mentions or attachments. */
export function insertReference(
  drafts: DraftsStore,
  threadId: string,
  name: string,
  location: string,
) {
  const draft = drafts.get(threadId);
  const text = `参考资料：${name}\n${location}`;
  drafts.setDocument(
    threadId,
    {
      type: "doc",
      content: [
        ...((draft.document ?? textDocument(draft.text)).content ?? []),
        ...(textDocument(text).content ?? []),
      ],
    },
    [draft.text, text].filter(Boolean).join("\n"),
    draft.skills ?? [],
  );
}
