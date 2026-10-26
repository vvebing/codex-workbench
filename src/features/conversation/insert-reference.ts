import { t } from "../../lib/i18n";
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
  const text = t("参考资料：{{value0}}\n{{value1}}", {
    value0: name,
    value1: location,
  });
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
